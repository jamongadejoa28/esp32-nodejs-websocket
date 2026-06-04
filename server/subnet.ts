/* ── /24 동일 서브넷 검증 ────────────────────────────────────
 * 클라이언트 IP와 DB host IP가 같은 /24(상위 24비트)에 있어야만 허용.
 * DB host가 호스트네임이면 dns.lookup으로 A 레코드 해석 후 비교.
 * ───────────────────────────────────────────────────────── */

import { promises as dns } from 'node:dns';

export interface SubnetCheck {
    ok: boolean;
    reason?: string;
    clientIp?: string;
    dbIp?: string;
}

function prefix24(ip: string): string | null {
    // IPv6-mapped IPv4 정규화 (::ffff:192.168.0.1 → 192.168.0.1)
    const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    for (let i = 1; i <= 4; i++) {
        const n = Number(m[i]);
        if (n < 0 || n > 255) return null;
    }
    return `${m[1]}.${m[2]}.${m[3]}`;
}

function isIpv4Literal(s: string): boolean {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

// 같은 머신(loopback)에서 들어온 요청은 서브넷 검사를 우회.
// Vite dev proxy(브라우저 → :5173 → :3400) 시에도 clientIp가 127.0.0.1로 잡혀
// LAN상의 DB에 붙으려면 어차피 한 번은 우회가 필요. 운영 환경에선 단일 origin
// 정적 서빙으로 전환되면 자연히 실제 LAN IP로 잡히므로 이 우회는 트리거 안 됨.
function isLoopback(ip: string): boolean {
    if (ip === '::1') return true;
    const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    return v4.startsWith('127.');
}

export async function isSameSubnet24(clientIp: string, dbHost: string): Promise<SubnetCheck> {
    if (isLoopback(clientIp)) {
        return { ok: true, clientIp, dbIp: dbHost };
    }

    const cPrefix = prefix24(clientIp);
    if (!cPrefix) {
        return { ok: false, reason: `client IP "${clientIp}" is not IPv4`, clientIp };
    }

    let dbIp = dbHost;
    if (!isIpv4Literal(dbHost)) {
        try {
            const r = await dns.lookup(dbHost, { family: 4 });
            dbIp = r.address;
        } catch {
            return { ok: false, reason: `DNS lookup failed for "${dbHost}"`, clientIp };
        }
    }

    const dPrefix = prefix24(dbIp);
    if (!dPrefix) {
        return { ok: false, reason: `DB IP "${dbIp}" is not IPv4`, clientIp, dbIp };
    }

    if (cPrefix !== dPrefix) {
        return {
            ok: false,
            reason: `client ${cPrefix}.x and DB ${dPrefix}.x are on different /24 subnets`,
            clientIp,
            dbIp,
        };
    }

    return { ok: true, clientIp, dbIp };
}
