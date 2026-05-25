/* fetch 얇은 래퍼. 서버는 error 시 { error: string } 형태로 응답. */

export interface ApiError {
    status: number;
    message: string;
}

async function parseError(res: Response): Promise<ApiError> {
    let msg = `HTTP ${res.status}`;
    try {
        const body = await res.json() as { error?: string };
        if (body?.error) msg = body.error;
    } catch { /* 본문 없음/JSON 아님 */ }
    return { status: res.status, message: msg };
}

export async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(path, { method: 'GET' });
    if (!res.ok) throw await parseError(res);
    return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw await parseError(res);
    return res.json() as Promise<T>;
}
