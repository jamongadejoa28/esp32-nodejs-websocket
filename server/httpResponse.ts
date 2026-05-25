/* ── HTTP/1.1 응답 빌더 ─────────────────────────────────────
 * 단일 요청-응답 사이클(Connection: close)만 다룬다.
 * JSON / 텍스트 / 바이너리 본문 헬퍼 제공.
 * 모든 응답에 CORS 헤더 부착(개발 시 Vite dev server에서 접근 가능하도록).
 * ───────────────────────────────────────────────────────── */

import type { Socket } from 'node:net';

export interface HttpResponse {
    status: number;
    contentType: string;
    body: Buffer;
    extraHeaders?: Record<string, string>;
}

const STATUS_TEXT: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type',
    431: 'Request Header Fields Too Large',
    500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
};

// 개발 편의: 모든 origin 허용 (LAN 한정 사용 가정).
// 프로덕션에서 별도 origin 제한 필요시 reqOrigin 인자로 좁힐 수 있게 분리.
function corsHeaders(reqOrigin: string | undefined): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': reqOrigin ?? '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
    };
}

export function sendResponse(socket: Socket, res: HttpResponse, reqOrigin?: string): void {
    if (socket.destroyed) return;
    const statusText = STATUS_TEXT[res.status] ?? '';
    const headers: Record<string, string> = {
        'Content-Type': res.contentType,
        'Content-Length': String(res.body.length),
        'Connection': 'close',
        ...corsHeaders(reqOrigin),
        ...(res.extraHeaders ?? {}),
    };
    let head = `HTTP/1.1 ${res.status} ${statusText}\r\n`;
    for (const [k, v] of Object.entries(headers)) head += `${k}: ${v}\r\n`;
    head += '\r\n';
    socket.write(head);
    if (res.body.length > 0) socket.write(res.body);
    socket.end();
}

export function jsonResponse(status: number, body: unknown): HttpResponse {
    return {
        status,
        contentType: 'application/json; charset=utf-8',
        body: Buffer.from(JSON.stringify(body), 'utf8'),
    };
}

export function textResponse(status: number, body: string): HttpResponse {
    return {
        status,
        contentType: 'text/plain; charset=utf-8',
        body: Buffer.from(body, 'utf8'),
    };
}

export function errorResponse(status: number, reason: string): HttpResponse {
    return jsonResponse(status, { error: reason });
}

export function corsPreflightResponse(): HttpResponse {
    return { status: 204, contentType: 'text/plain', body: Buffer.alloc(0) };
}
