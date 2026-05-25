/* ── REST 엔드포인트 라우팅 ─────────────────────────────────
 * method+path → handler 디스패치. 비동기 핸들러는 일관된 형태로.
 * 응답은 항상 HttpResponse 객체로 반환 (호출자가 socket에 write).
 * ───────────────────────────────────────────────────────── */

import {
    type HttpResponse,
    jsonResponse,
    errorResponse,
    corsPreflightResponse,
} from './httpResponse.js';
import type { ParsedRequest } from './httpParser.js';
import { db, type DbCreds } from './dbSession.js';
import { isSameSubnet24 } from './subnet.js';
import { pendingFrames } from './ringBuffer.js';
import { insertReading, selectHistory, selectLatest } from './dbQueries.js';

export interface RouteContext {
    req: ParsedRequest;
    body: Buffer;
    clientIp: string;
}

type Handler = (ctx: RouteContext) => Promise<HttpResponse>;

const routes: Array<{ method: string; path: string; handler: Handler }> = [
    { method: 'GET',  path: '/healthz',           handler: healthz },
    { method: 'GET',  path: '/api/db/status',     handler: dbStatus },
    { method: 'POST', path: '/api/db/connect',    handler: dbConnect },
    { method: 'POST', path: '/api/db/disconnect', handler: dbDisconnect },
    { method: 'GET',  path: '/api/sensor/latest',  handler: sensorLatest },
    { method: 'GET',  path: '/api/sensor/history', handler: sensorHistory },
];

export async function dispatch(ctx: RouteContext): Promise<HttpResponse> {
    if (ctx.req.method === 'OPTIONS') return corsPreflightResponse();

    for (const r of routes) {
        if (r.method === ctx.req.method && r.path === ctx.req.path) {
            try { return await r.handler(ctx); }
            catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[route] ${ctx.req.method} ${ctx.req.path} threw:`, msg);
                return errorResponse(500, msg);
            }
        }
    }

    // 메소드 mismatch (path는 있지만 method가 다른 경우 405)
    const samePath = routes.some(r => r.path === ctx.req.path);
    if (samePath) return errorResponse(405, 'Method Not Allowed');
    return errorResponse(404, 'Not Found');
}

// ── handlers ────────────────────────────────────────────────────────────────

async function healthz(): Promise<HttpResponse> {
    return jsonResponse(200, { ok: true });
}

async function dbStatus(): Promise<HttpResponse> {
    return jsonResponse(200, db.status());
}

async function dbConnect(ctx: RouteContext): Promise<HttpResponse> {
    let body: Partial<DbCreds>;
    try { body = JSON.parse(ctx.body.toString('utf8')); }
    catch { return errorResponse(400, 'Invalid JSON body'); }

    if (!body.host || !body.user || body.password === undefined || !body.database || !body.port) {
        return errorResponse(400, 'Missing fields: host, port, user, password, database');
    }
    if (!Number.isInteger(body.port) || body.port <= 0 || body.port > 65535) {
        return errorResponse(400, 'Invalid port');
    }

    // 1) /24 서브넷 검증
    const subnet = await isSameSubnet24(ctx.clientIp, body.host);
    if (!subnet.ok) {
        return errorResponse(403, subnet.reason ?? 'Subnet check failed');
    }

    // 2) DB 풀 생성 + ping
    try { await db.connect(body as DbCreds); }
    catch (e: unknown) {
        const code = (e as { code?: string }).code;
        const msg  = e instanceof Error ? e.message : String(e);
        return errorResponse(502, `DB connect failed: ${code ?? msg}`);
    }

    // 3) 링버퍼 drain → 원래 timestamp로 일괄 INSERT
    const drained = pendingFrames.drain();
    let inserted = 0;
    for (const f of drained) {
        try { await insertReading(f.payload, f.ts); inserted++; }
        catch (e) { console.warn('[drain] insert failed:', e); }
    }

    return jsonResponse(200, {
        ok: true,
        drained: drained.length,
        inserted,
        status: db.status(),
    });
}

async function dbDisconnect(): Promise<HttpResponse> {
    await db.disconnect();
    return jsonResponse(200, { ok: true });
}

async function sensorLatest(): Promise<HttpResponse> {
    if (!db.isReady()) return errorResponse(409, 'DB not connected');
    const row = await selectLatest();
    return jsonResponse(200, row);
}

async function sensorHistory(ctx: RouteContext): Promise<HttpResponse> {
    if (!db.isReady()) return errorResponse(409, 'DB not connected');
    const q = ctx.req.query;
    const now = Date.now();
    const fromStr = q.from ?? new Date(now - 3 * 3600_000).toISOString();
    const toStr   = q.to   ?? new Date(now).toISOString();
    const from = new Date(fromStr);
    const to   = new Date(toStr);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return errorResponse(400, 'Invalid from/to ISO date');
    }
    const limit = Math.max(1, Math.min(Number(q.limit ?? 5000), 50000));
    const rows = await selectHistory(from, to, limit);
    return jsonResponse(200, rows);
}
