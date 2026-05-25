/* ── 고정용량 링버퍼 ─────────────────────────────────────────────
 * DB 미연결 구간 동안 ESP32 프레임을 임시 보관.
 * push가 cap 초과 시 가장 오래된 항목부터 silent drop.
 * drain() 호출로 일괄 회수 + 내부 비움.
 * ───────────────────────────────────────────────────────────── */

import type { SensorPayloadFull } from './sensorTypes.js';

export interface BufferedFrame {
    ts: Date;
    payload: SensorPayloadFull;
}

class RingBuffer<T> {
    private data: T[] = [];
    constructor(private readonly cap: number) {}

    push(x: T): void {
        this.data.push(x);
        if (this.data.length > this.cap) {
            this.data.splice(0, this.data.length - this.cap);
        }
    }

    drain(): T[] {
        const r = this.data;
        this.data = [];
        return r;
    }

    size(): number { return this.data.length; }
    capacity(): number { return this.cap; }
}

export const pendingFrames = new RingBuffer<BufferedFrame>(500);
