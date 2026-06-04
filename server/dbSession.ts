/* ── 런타임 DB 세션 ─────────────────────────────────────────────
 * 대시보드가 POST /api/db/connect로 자격증명을 보내면 풀을 생성한다.
 * 자격증명은 메모리에만 보관 (.env 사용 안 함).
 * 서버 재시작 시 풀은 사라지고 ESP32 ingress는 ringBuffer로 흘러간다.
 * ───────────────────────────────────────────────────────────── */

import mysql from 'mysql2/promise';

export interface DbCreds {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

export interface DbStatus {
    connected: boolean;
    host: string | null;
    database: string | null;
    connectedAt: string | null;
}

// mysql2가 ETIMEDOUT 등 네트워크 단절 시 surface하는 에러 코드들.
// (방화벽 차단, NAT 끊김, DNS 실패 모두 여기로 들어옴)
const NETWORK_ERROR_CODES = new Set([
    'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND',
    'EHOSTUNREACH', 'ECONNRESET', 'EPIPE',
    'PROTOCOL_CONNECTION_LOST',
]);

class DbSession {
    private pool: mysql.Pool | null = null;
    private meta: { host: string; database: string; connectedAt: Date } | null = null;

    async connect(c: DbCreds): Promise<void> {
        await this.disconnect();
        const p = mysql.createPool({
            host: c.host,
            port: c.port,
            user: c.user,
            password: c.password,
            database: c.database,
            waitForConnections: true,
            connectionLimit: 4,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,
            // 방화벽이 SYN을 drop하는 경우 mysql2 기본값(~75s) 대신 5s에 surface.
            // 클라이언트가 hang하지 않도록 빠르게 실패 → markDeadIfNetworkError 트리거.
            connectTimeout: 5000,
        });

        // ping으로 즉시 검증 — 실패 시 throw
        try {
            const conn = await p.getConnection();
            try { await conn.ping(); }
            finally { conn.release(); }
        } catch (e) {
            await p.end().catch(() => {});
            throw e;
        }

        this.pool = p;
        this.meta = { host: c.host, database: c.database, connectedAt: new Date() };
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end().catch(() => {});
            this.pool = null;
        }
        this.meta = null;
    }

    isReady(): boolean { return this.pool !== null; }

    getPool(): mysql.Pool | null { return this.pool; }

    /* 쿼리 도중 네트워크 단절 에러를 만나면 풀을 죽은 상태로 표시.
     * isReady()가 즉시 false가 되어 후속 ingest는 ringBuffer로 직행,
     * 후속 REST 호출은 409("DB not connected")로 떨어진다.
     * 실제 pool.end() 정리는 백그라운드에서 진행. */
    markDeadIfNetworkError(e: unknown): void {
        const code = (e as { code?: string } | null)?.code;
        if (!code || !NETWORK_ERROR_CODES.has(code)) return;
        if (!this.pool) return;
        console.warn(`[db] network error ${code} — marking session dead`);
        const dead = this.pool;
        this.pool = null;
        this.meta = null;
        dead.end().catch(() => {});
    }

    status(): DbStatus {
        return {
            connected: this.isReady(),
            host: this.meta?.host ?? null,
            database: this.meta?.database ?? null,
            connectedAt: this.meta?.connectedAt.toISOString() ?? null,
        };
    }
}

export const db = new DbSession();
