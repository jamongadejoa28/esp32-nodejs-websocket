/* ── HTTP/1.1 요청 파서 (외부 라이브러리 없음) ────────────────────
 * 지원: 단일 요청-응답 (Connection: close), Content-Length 본문.
 * 미지원: chunked transfer, header folding, pipelining → 400/501.
 * 임베디드/대시보드 전용 단순화된 파서.
 * ───────────────────────────────────────────────────────────── */

export interface ParsedRequest {
    method: string;
    path: string;                      // 쿼리 제외 경로
    query: Record<string, string>;
    headers: Record<string, string>;   // 모두 lowercase key
    headerByteLen: number;             // \r\n\r\n까지 포함 길이
    contentLength: number;             // 없으면 0
}

export type ParseResult =
    | { kind: 'need-more' }
    | { kind: 'ok'; req: ParsedRequest }
    | { kind: 'error'; status: number; reason: string };

const MAX_HEADER_BYTES = 16 * 1024;

export function parseRequest(buf: Buffer): ParseResult {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx < 0) {
        if (buf.length > MAX_HEADER_BYTES) {
            return { kind: 'error', status: 431, reason: 'Request header too large' };
        }
        return { kind: 'need-more' };
    }

    const headerByteLen = idx + 4;
    const text = buf.subarray(0, idx).toString('utf8');
    const lines = text.split('\r\n');
    if (lines.length === 0) return { kind: 'error', status: 400, reason: 'Empty request' };

    // 요청 라인: "METHOD PATH HTTP/1.1"
    const startLine = lines[0];
    const sm = startLine.match(/^([A-Z]+) (\S+) HTTP\/1\.[01]$/);
    if (!sm) return { kind: 'error', status: 400, reason: 'Malformed request line' };

    const method = sm[1];
    const rawPath = sm[2];
    const qIdx = rawPath.indexOf('?');
    const path = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
    const queryStr = qIdx >= 0 ? rawPath.slice(qIdx + 1) : '';
    const query: Record<string, string> = {};
    if (queryStr) {
        for (const kv of queryStr.split('&')) {
            if (!kv) continue;
            const eq = kv.indexOf('=');
            const k = decodeURIComponent(eq >= 0 ? kv.slice(0, eq) : kv);
            const v = decodeURIComponent(eq >= 0 ? kv.slice(eq + 1) : '');
            query[k] = v;
        }
    }

    // 헤더
    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln) continue;
        // header folding (line 시작이 공백)은 미지원
        if (ln.startsWith(' ') || ln.startsWith('\t')) {
            return { kind: 'error', status: 400, reason: 'Folded headers not supported' };
        }
        const colon = ln.indexOf(':');
        if (colon < 0) return { kind: 'error', status: 400, reason: 'Malformed header' };
        const k = ln.slice(0, colon).trim().toLowerCase();
        const v = ln.slice(colon + 1).trim();
        headers[k] = v;
    }

    // chunked 거부
    const te = headers['transfer-encoding'];
    if (te && te.toLowerCase() !== 'identity') {
        return { kind: 'error', status: 501, reason: 'Transfer-Encoding not supported' };
    }

    const clRaw = headers['content-length'];
    let contentLength = 0;
    if (clRaw !== undefined) {
        const n = Number(clRaw);
        if (!Number.isInteger(n) || n < 0) {
            return { kind: 'error', status: 400, reason: 'Invalid Content-Length' };
        }
        contentLength = n;
    }

    return {
        kind: 'ok',
        req: { method, path, query, headers, headerByteLen, contentLength },
    };
}
