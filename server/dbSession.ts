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
