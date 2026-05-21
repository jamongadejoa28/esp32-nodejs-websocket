import { createServer, Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { pool, WS_PORT, WS_HOST } from './config/env.js';

console.log('[env] DB_HOST:', process.env.DB_HOST);
console.log('[env] DB_PORT:', process.env.DB_PORT);
console.log('[env] DB_USER:', process.env.DB_USER);
console.log('[env] DB_NAME:', process.env.DB_NAME);
console.log('[env] DB_PASS:', process.env.DB_PASS ? '***' : 'MISSING');
console.log('[env] WS_PORT:', process.env.WS_PORT);
console.log('[env] WS_HOST:', process.env.WS_HOST);

const HOST = "0.0.0.0";
const PORT = WS_PORT;
const clients = new Set<Client>();
const RFC6455_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';


class Client {
    id = randomUUID();
    buf = Buffer.alloc(0);
    upgraded = false;
    socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
        socket.on('data', (chunk) => {
            this.onData(Buffer.from(chunk) as any);
        });
        socket.on('error', () => this.close());
        socket.on('end', () => this.close());
    }

    onData(chunk: Buffer) {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (!this.upgraded) {
            const idx = this.buf.indexOf('\r\n\r\n');
            if (idx < 0) return;
            const headers = this.buf.subarray(0, idx).toString('utf8');
            this.buf = this.buf.subarray(idx + 4);
            this.handleHandshake(headers);
            return;
        }
        this.drainFrames();
    }

    /* ── HTTP/1.1 Upgrade — RFC 6455 §1.3 핸드셰이크 ─────────────────────
   *   accept = base64( SHA1( client_key + GUID ) )
   *   GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
   * ──────────────────────────────────────────────────────────────── */
    private handleHandshake(raw: string) {
        console.log(`[ws] client ${this.id} handshake:\n${raw}`);
        const m = raw.match(/Sec-WebSocket-Key:\s*(.+)/i);
        if (!m) { this.close(); return; }
        const key = m[1].trim();
        const accept = createHash('sha1').update(key + RFC6455_GUID).digest('base64');
        const resp =
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`;
        this.socket.write(resp);
        this.upgraded = true;
        console.log(`[ws] client ${this.id} upgraded`);
    }

    /* ── 프레임 unmask + 페이로드 추출 ──────────────────────────────────
     * 한 TCP 청크에 여러 WebSocket 프레임이 섞여 들어올 수 있으므로 루프.
     * ──────────────────────────────────────────────────────────────── */
    private drainFrames() {
        for (; ;) {
            if (this.buf.length < 2) return;
            const b0 = this.buf[0];
            const b1 = this.buf[1];
            const op = b0 & 0x0F;
            const masked = (b1 & 0x80) !== 0;
            let plen = b1 & 0x7F;
            let off = 2;
            if (plen === 126) {
                if (this.buf.length < 4) return;
                plen = this.buf.readUInt16BE(2);
                off = 4;
            } else if (plen === 127) {
                if (this.buf.length < 10) return;
                /* 64비트 길이지만 우리 페이로드는 항상 256B 이내 (안전 변환) */
                plen = Number(this.buf.readBigUInt64BE(2));
                off = 10;
            }
            let mask: Buffer | null = null;
            if (masked) {
                if (this.buf.length < off + 4) return;
                mask = this.buf.subarray(off, off + 4);
                off += 4;
            }
            if (this.buf.length < off + plen) return;

            const payload = Buffer.alloc(plen);
            for (let i = 0; i < plen; i++) {
                payload[i] = mask ? this.buf[off + i] ^ mask[i & 3] : this.buf[off + i];
            }
            this.buf = this.buf.subarray(off + plen);
            /* 프레임 처리 */
            if (op === 0x01) {
                this.handleTextPayload(payload.toString('utf8'));
            }
            else if (op === 0x08) {
                this.close();
            }
            else if (op === 0x09) {
                this.sendFrame(0x8A, payload); // ping -> pong
            }

        }
    }

    /* ── text 프레임 송신 ──── */
    private handleTextPayload(text: string) {
        let d: Record<string, unknown>;
        try { d = JSON.parse(text); }
        catch {
            console.warn('[ws] JSON parse fail: ', text);
            return;
        }

        const fields = [
            'pm1_grimm', 'pm25_grimm', 'pm10_grimm',
            'pm1_tsi', 'pm25_tsi', 'pm10_tsi',
            'cnt_0p3', 'cnt_0p5', 'cnt_1p0',
            'cnt_2p5', 'cnt_5p0', 'cnt_10'
        ] as const; // 읽기 전용 프레임 데이터

        const values: number[] = [];
        for (const f of fields) {
            const v = Number(d[f]);
            /* 데이터 프레임 유효성 검사
                * - 정수여야 함 (소수점 이하 버림)
                * - 0 이상 65535 이하 (16비트 부호 없는 정수 범위)
            */
            if (!Number.isInteger(v) || v < 0 || v > 65535) {
                console.warn(`[ws] invalid field ${f}=${d[f]}`);
                return;
            }
            values.push(v);    // typescript의 DB insert 기능
        }

        this.insertSensor(values).catch(console.error);
    }



    /* DB Query Function */
    // scheima에서 데이터 타입이 정수인 숫자로만 이루어져 있다.
    private async insertSensor(values: number[]) {
        // const conn = await pool.getConnection();
        try {
            await using conn = await pool.getConnection();
            const sql = `
        INSERT INTO pm_sensor_data
            (recorded_at,
             pm1_grimm, pm25_grimm, pm10_grimm,
             pm1_tsi,   pm25_tsi,   pm10_tsi,
             cnt_0p3,   cnt_0p5,    cnt_1p0,
             cnt_2p5,   cnt_5p0,    cnt_10)
        VALUES (NOW(), ?,?,?,?,?,?,?,?,?,?,?,?)
        `;
            await conn.execute(sql, values);
            console.log(`[db] inserted - pm2.5=${values[1]} ug/m³`);
        } catch (e: any) {
            console.warn(`[db] insert failed: ${e.code ?? e.message}`);
        }
    }

    /* ── 프레임 송신 — RFC 6455 에 따라 서버 측은 마스킹 안 함 ─────────── */
    sendBinary(payload: Uint8Array) { this.sendFrame(0x82, Buffer.from(payload)); }

    private sendFrame(opcode: number, payload: Buffer) {
        if (this.socket.destroyed) return;
        const len = payload.length;
        let header: Buffer;
        if (len < 126) {
            header = Buffer.from([opcode, len]);
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = opcode; header[1] = 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = opcode; header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        this.socket.write(Buffer.concat([header, payload]));
    }

    close() {
        if (this.socket.destroyed) return;
        this.socket.destroy();
        clients.delete(this);
        console.log(`[ws] client ${this.id} closed`);
    }
}

/* ── TCP 서버 ─────────────────────────────────── */
const server = createServer((sock) => {
    console.log(`[ws] connection from ${sock.remoteAddress}:${sock.remotePort}`);
    const c = new Client(sock);
    clients.add(c);
});
server.listen(PORT, HOST, () => {
    console.log(`server running on ws://${HOST}:${PORT}`);
});