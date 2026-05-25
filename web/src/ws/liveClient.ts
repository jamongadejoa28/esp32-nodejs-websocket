/* /live WebSocket 클라이언트 — 자동 재연결 (1s → 30s 지수 백오프). */

import type { LiveMessage } from '../types/sensor';

type Handler = (msg: LiveMessage) => void;

export class LiveClient {
    private ws: WebSocket | null = null;
    private url: string;
    private handler: Handler;
    private statusHandler: (connected: boolean) => void;
    private backoffMs = 1000;
    private closed = false;
    private timer: number | null = null;

    constructor(url: string, handler: Handler, statusHandler: (c: boolean) => void) {
        this.url = url;
        this.handler = handler;
        this.statusHandler = statusHandler;
    }

    start(): void {
        this.closed = false;
        this.connect();
    }

    stop(): void {
        this.closed = true;
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.statusHandler(false);
    }

    private connect(): void {
        try {
            this.ws = new WebSocket(this.url);
        } catch (e) {
            this.scheduleReconnect();
            return;
        }
        this.ws.onopen = () => {
            this.backoffMs = 1000;
            this.statusHandler(true);
        };
        this.ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data as string) as LiveMessage;
                this.handler(msg);
            } catch { /* drop malformed */ }
        };
        this.ws.onclose = () => {
            this.statusHandler(false);
            this.ws = null;
            if (!this.closed) this.scheduleReconnect();
        };
        this.ws.onerror = () => {
            // onclose가 뒤이어 호출됨
        };
    }

    private scheduleReconnect(): void {
        if (this.closed) return;
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
        this.timer = window.setTimeout(() => { this.timer = null; this.connect(); }, delay);
    }
}

/** 기본 /live URL: 현재 location 기준 ws:// or wss:// */
export function defaultLiveUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/live`;
}
