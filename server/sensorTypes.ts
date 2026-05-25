/* ── 센서 페이로드 타입 + 검증 ────────────────────────────────────────────
 * ESP32가 보내는 JSON을 안전하게 파싱한다.
 * - PM 12필드(uint16): 기존과 동일
 * - pressure_pa(int16 범위) / pressure_status(uint8): null 허용
 * 검증 실패 시 null 반환 → 해당 프레임은 drop.
 * ───────────────────────────────────────────────────────────────── */

export const PM_FIELDS = [
    'pm1_grimm', 'pm25_grimm', 'pm10_grimm',
    'pm1_tsi',   'pm25_tsi',   'pm10_tsi',
    'cnt_0p3',   'cnt_0p5',    'cnt_1p0',
    'cnt_2p5',   'cnt_5p0',    'cnt_10',
] as const;

export type PmField = typeof PM_FIELDS[number];

export interface SensorPayloadFull {
    pm1_grimm: number; pm25_grimm: number; pm10_grimm: number;
    pm1_tsi: number;   pm25_tsi: number;   pm10_tsi: number;
    cnt_0p3: number;   cnt_0p5: number;    cnt_1p0: number;
    cnt_2p5: number;   cnt_5p0: number;    cnt_10: number;
    pressure_pa: number | null;
    pressure_status: number | null;
}

export function parseSensorPayload(raw: unknown): SensorPayloadFull | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const out = {} as SensorPayloadFull;

    for (const f of PM_FIELDS) {
        const v = Number(obj[f]);
        if (!Number.isInteger(v) || v < 0 || v > 65535) {
            console.warn(`[parse] invalid PM field ${f}=${String(obj[f])}`);
            return null;
        }
        (out as unknown as Record<string, number>)[f] = v;
    }

    // pressure_pa: null 허용, 정수 ±32767 (SMALLINT 범위)
    if (obj.pressure_pa == null) out.pressure_pa = null;
    else {
        const pv = Number(obj.pressure_pa);
        if (!Number.isFinite(pv) || pv < -32768 || pv > 32767) {
            console.warn(`[parse] invalid pressure_pa=${String(obj.pressure_pa)}`);
            return null;
        }
        out.pressure_pa = Math.round(pv);
    }

    // pressure_status: null 허용, uint8
    if (obj.pressure_status == null) out.pressure_status = null;
    else {
        const sv = Number(obj.pressure_status);
        if (!Number.isInteger(sv) || sv < 0 || sv > 255) {
            console.warn(`[parse] invalid pressure_status=${String(obj.pressure_status)}`);
            return null;
        }
        out.pressure_status = sv;
    }

    return out;
}
