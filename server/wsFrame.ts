/* ── RFC 6455 WebSocket 프레임 인/디코딩 (외부 라이브러리 없음) ───────
 * 기존 server.ts에 있던 drainFrames/sendFrame 로직을 모듈로 분리.
 * - 디코딩: masked client→server 프레임 unmask 후 payload Buffer 추출
 * - 인코딩: server→client 프레임 (마스킹 없음, FIN=1)
 * ───────────────────────────────────────────────────────────── */

import type { Socket } from 'node:net';

export const Opcode = {
    Continuation: 0x00,
    Text:   0x01,
    Binary: 0x02,
    Close:  0x08,
    Ping:   0x09,
    Pong:   0x0A,
} as const;
export type OpcodeValue = typeof Opcode[keyof typeof Opcode];

export interface DecodedFrame {
    opcode: OpcodeValue;
    payload: Buffer;
}

/**
 * 입력 buf에서 가능한 만큼 프레임을 모두 꺼낸다.
 * 남은(불완전한) 바이트는 새 Buffer로 반환.
 */
export function decodeFrames(buf: Buffer): { frames: DecodedFrame[]; remainder: Buffer } {
    const frames: DecodedFrame[] = [];
    let cur = buf;

    for (;;) {
        if (cur.length < 2) break;
        const b0 = cur[0];
        const b1 = cur[1];
        const opcode = (b0 & 0x0F) as OpcodeValue;
        const masked = (b1 & 0x80) !== 0;
        let plen = b1 & 0x7F;
        let off = 2;

        if (plen === 126) {
            if (cur.length < 4) break;
            plen = cur.readUInt16BE(2);
            off = 4;
        } else if (plen === 127) {
            if (cur.length < 10) break;
            const big = cur.readBigUInt64BE(2);
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
                // 비현실적으로 큰 프레임 → 연결 종료 의도로 빈 결과
                return { frames, remainder: Buffer.alloc(0) };
            }
            plen = Number(big);
            off = 10;
        }

        let mask: Buffer | null = null;
        if (masked) {
            if (cur.length < off + 4) break;
            mask = cur.subarray(off, off + 4);
            off += 4;
        }
        if (cur.length < off + plen) break;

        const payload = Buffer.alloc(plen);
        for (let i = 0; i < plen; i++) {
            payload[i] = mask ? cur[off + i] ^ mask[i & 3] : cur[off + i];
        }
        cur = cur.subarray(off + plen);
        frames.push({ opcode, payload });
    }

    return { frames, remainder: cur };
}

/** server→client 프레임 인코딩 후 즉시 전송. */
export function sendFrame(socket: Socket, opcode: OpcodeValue, payload: Buffer): void {
    if (socket.destroyed) return;
    const len = payload.length;
    const finOp = 0x80 | opcode;
    let header: Buffer;
    if (len < 126) {
        header = Buffer.from([finOp, len]);
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = finOp;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = finOp;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, payload]));
}

export function sendText(socket: Socket, text: string): void {
    sendFrame(socket, Opcode.Text, Buffer.from(text, 'utf8'));
}
