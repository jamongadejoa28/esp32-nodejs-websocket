/* ── 단일 TCP 리스너에서 HTTP/1.1 REST + WebSocket(/ingest, /live) 다중화 ─
 *
 * 외부 프레임워크(express, ws) 사용 안 함. 임베디드 스타일로 데이터
 * 프로토콜을 엄격히 직접 관리한다.
 *
 *   1. socket 'data' 이벤트 → Buffer 누적
 *   2. WebSocket 업그레이드되지 않은 상태면 HTTP 헤더 파싱 시도
 *      - Upgrade: websocket → RFC6455 핸드셰이크 후 path별 role 부여
 *      - 그 외 → Content-Length 본문 수신 후 routes.dispatch → 응답 + close
 *   3. WebSocket 업그레이드된 후엔 wsFrame.decodeFrames로 프레임 처리
 *      - role='ingest': ESP32 JSON → broadcast + DB INSERT or ringBuffer
 *      - role='live'  : 대시보드 구독자 (서버→클라이언트 broadcast 수신만)
 * ───────────────────────────────────────────────────────────────────── */

import { createServer, type Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';

import { parseRequest } from './httpParser.js';
import {
    sendResponse,
    errorResponse,
    type HttpResponse,
} from './httpResponse.js';
import { decodeFrames, sendText, sendFrame, Opcode } from './wsFrame.js';
import { dispatch } from './routes.js';
import { parseSensorPayload } from './sensorTypes.js';
import { db } from './dbSession.js';
import { insertReading } from './dbQueries.js';
import { pendingFrames } from './ringBuffer.js';

const HOST = process.env.WS_HOST ?? '0.0.0.0';
const PORT = Number(process.env.WS_PORT ?? 3400);

const RFC6455_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

type ClientRole = null | 'ingest' | 'live';

/* /live 구독자 모음 — 새 sensor 프레임 도착 시 모두에게 broadcast */
const liveSubscribers = new Set<Client>();

function liveBroadcast(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const s of liveSubscribers) {
        try { sendText(s.socket, text); }
        catch { /* 개별 실패는 무시 */ }
    }
}

class Client {
    id = randomUUID();
    socket: Socket;
    buf: Buffer = Buffer.alloc(0);
    upgraded = false;
    role: ClientRole = null;

    constructor(socket: Socket) {
        this.socket = socket;
        socket.on('data', (chunk: Buffer) => this.onData(chunk));
        socket.on('error', () => this.close());
        socket.on('end',   () => this.close());
        socket.on('close', () => this.close());
    }

    private onData(chunk: Buffer): void {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (!this.upgraded) this.tryHttp();
        else                this.drainWs();
    }

    /* HTTP 헤더 파싱 → WS 업그레이드 or REST 요청 처리 */
    private tryHttp(): void {
        const r = parseRequest(this.buf);
        if (r.kind === 'need-more') return;
        if (r.kind === 'error') {
            sendResponse(this.socket, errorResponse(r.status, r.reason));
            return;
        }
        const req = r.req;

        const isUpgrade = (req.headers['upgrade'] ?? '').toLowerCase() === 'websocket';
        if (isUpgrade) {
            // 헤더만 소비. WebSocket 프레임은 그 다음 바이트부터.
            this.buf = this.buf.subarray(req.headerByteLen);
            this.handleWsHandshake(req.path, req.headers);
            return;
        }

        // 일반 REST 요청: Content-Length만큼 더 수신해야 함
        if (this.buf.length < req.headerByteLen + req.contentLength) return;

        const body = this.buf.subarray(req.headerByteLen, req.headerByteLen + req.contentLength);
        const reqOrigin = req.headers['origin'];
        // remoteAddress는 IPv6-mapped form일 수 있음. subnet.ts에서 정규화.
        const clientIp = this.socket.remoteAddress ?? '';

        dispatch({ req, body: Buffer.from(body), clientIp })
            .then((res: HttpResponse) => sendResponse(this.socket, res, reqOrigin))
            .catch((e: unknown) => {
                const msg = e instanceof Error ? e.message : String(e);
                sendResponse(this.socket, errorResponse(500, msg), reqOrigin);
            });
    }

    private handleWsHandshake(path: string, headers: Record<string, string>): void {
        const key = headers['sec-websocket-key'];
        if (!key) {
            sendResponse(this.socket, errorResponse(400, 'Missing Sec-WebSocket-Key'));
            return;
        }
        if (path !== '/ingest' && path !== '/live') {
            sendResponse(this.socket, errorResponse(404, `Unknown WS path: ${path}`));
            return;
        }

        const accept = createHash('sha1').update(key + RFC6455_GUID).digest('base64');
        const resp =
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`;
        this.socket.write(resp);
        this.upgraded = true;
        this.role = path === '/ingest' ? 'ingest' : 'live';

        if (this.role === 'live') liveSubscribers.add(this);
        console.log(`[ws] client ${this.id} upgraded as ${this.role} (${this.socket.remoteAddress})`);

        // 핸드셰이크 직후에 이미 도착해 있는 프레임이 있을 수 있음
        if (this.buf.length > 0) this.drainWs();
    }

    /* WebSocket 프레임 처리 */
    private drainWs(): void {
        const { frames, remainder } = decodeFrames(this.buf);
        this.buf = remainder;

        for (const f of frames) {
            switch (f.opcode) {
                case Opcode.Text:
                    if (this.role === 'ingest') this.handleIngestText(f.payload.toString('utf8'));
                    // /live 구독자가 보내는 메시지는 무시 (단방향)
                    break;
                case Opcode.Ping:
                    sendFrame(this.socket, Opcode.Pong, f.payload);
                    break;
                case Opcode.Close:
                    this.close();
                    return;
                default:
                    // Binary 등 미사용
                    break;
            }
        }
    }

    /* ESP32 ingress: JSON → broadcast → DB INSERT or ringBuffer */
    private handleIngestText(text: string): void {
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch {
            console.warn('[ingest] JSON parse fail');
            return;
        }
        const payload = parseSensorPayload(parsed);
        if (!payload) return;
        const ts = new Date();

        // 1) 즉시 broadcast (대시보드는 DB 상태와 무관하게 실시간 데이터 수신)
        liveBroadcast({
            type: 'sensor',
            data: { ...payload, recorded_at: ts.toISOString() },
        });

        // 2) DB 연결되어 있으면 INSERT, 아니면 ringBuffer
        //    await 하지 않음 — TCP 수신 블로킹 방지 (저지연 유지)
        if (db.isReady()) {
            insertReading(payload, ts).catch(e => {
                console.warn('[ingest] insert failed:', e instanceof Error ? e.message : e);
                pendingFrames.push({ ts, payload });   // 실패한 프레임도 다음 재연결 때 재시도
            });
        } else {
            pendingFrames.push({ ts, payload });
        }
    }

    close(): void {
        if (this.role === 'live') liveSubscribers.delete(this);
        if (!this.socket.destroyed) this.socket.destroy();
    }
}

/* ── TCP 서버 부팅 ─────────────────────────────────────────── */
const server = createServer((sock) => {
    new Client(sock);
});

server.listen(PORT, HOST, () => {
    console.log(`server listening on ${HOST}:${PORT}`);
    console.log(`  HTTP REST   → /api/db/{connect,status,disconnect}, /api/sensor/{latest,history}, /healthz`);
    console.log(`  WebSocket   → /ingest (ESP32), /live (dashboard)`);
    console.log(`  DB session  → not connected (will be provisioned by first dashboard)`);
});
