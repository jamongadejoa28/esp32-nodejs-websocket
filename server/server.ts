import { createServer, Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { pool, env } from './config/env.js';

const HOST = '0.0.0.0';
const PORT = env.WS_PORT;
const clients = new Set<Client>();
const RFC6455_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ── RFC 6455 opcode (수신 시 b0 & 0x0F, 송신 시 0x80 | code) ───────── */
const Opcode = {
    Text:   0x01,
    Binary: 0x02,
    Close:  0x08,
    Ping:   0x09,
    Pong:   0x0A,
} as const;
type Opcode = typeof Opcode[keyof typeof Opcode];

/* ── 도메인 모델: 센서 한 프레임 (모두 uint16) ───────────────────── */
const SENSOR_FIELDS = [
    'pm1_grimm', 'pm25_grimm', 'pm10_grimm',
    'pm1_tsi',   'pm25_tsi',   'pm10_tsi',
    'cnt_0p3',   'cnt_0p5',    'cnt_1p0',
    'cnt_2p5',   'cnt_5p0',    'cnt_10',
] as const;

type SensorField = typeof SENSOR_FIELDS[number];
type SensorPayload = Record<SensorField, number>;
/* INSERT 컬럼 순서와 동일한 12-튜플 (컴파일러가 길이 보장) */
type SensorValues = [
    number, number, number, number, number, number,
    number, number, number, number, number, number
];

function parseSensorPayload(raw: unknown): SensorPayload | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const out = {} as SensorPayload;
    for (const f of SENSOR_FIELDS) {
        const v = Number(obj[f]);
        if (!Number.isInteger(v) || v < 0 || v > 65535) {
            console.warn(`[ws] invalid field ${f}=${String(obj[f])}`);
            return null;
        }
        out[f] = v;
    }
    return out;
}

function toSensorValues(p: SensorPayload): SensorValues {
    return SENSOR_FIELDS.map((f) => p[f]) as SensorValues;
}


class Client {
    id = randomUUID();
    buf = Buffer.alloc(0);
    upgraded = false;
    socket: Socket;

    constructor(socket: Socket) {
        this.socket = socket;
        socket.on('data', (chunk: Buffer) => this.onData(chunk));
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
            const op = (b0 & 0x0F) as Opcode;
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

            switch (op) {
                case Opcode.Text:
                    this.handleTextPayload(payload.toString('utf8'));
                    break;
                case Opcode.Close:
                    this.close();
                    break;
                case Opcode.Ping:
                    this.sendFrame(0x80 | Opcode.Pong, payload);
                    break;
            }
        }
    }

    /* ── text 프레임 처리: JSON → 타입 검증 → DB INSERT ───────── */
    private handleTextPayload(text: string) {
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch {
            console.warn('[ws] JSON parse fail:', text);
            return;
        }

        const payload = parseSensorPayload(parsed);
        if (payload === null) return;

        this.insertSensor(toSensorValues(payload)).catch(console.error);
    }


    /* DB Query Function — 스키마 12 컬럼 (모두 uint16) */
    private async insertSensor(values: SensorValues) {
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
        } catch (e: unknown) {
            const err = e as NodeJS.ErrnoException;
            console.warn(`[db] insert failed: ${err.code ?? err.message ?? String(e)}`);
        }
    }

    /* ── 프레임 송신 — RFC 6455 에 따라 서버 측은 마스킹 안 함 ─────────── */
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
