import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SensorRow, LiveMessage } from '../types/sensor';
import { sensorApi } from '../api/sensor';

const MAX_HISTORY = 6000;
const MAX_RAW_LOG = 100;

export const useSensorStore = defineStore('sensor', () => {
    const history = ref<SensorRow[]>([]);
    const rawLog  = ref<string[]>([]);
    const liveConnected = ref(false);

    const latest = computed<SensorRow | null>(() =>
        history.value.length > 0 ? history.value[history.value.length - 1] : null,
    );

    async function loadHistory(rangeMs: number): Promise<void> {
        const to = new Date();
        const from = new Date(to.getTime() - rangeMs);
        const rows = await sensorApi.history(from.toISOString(), to.toISOString(), 5000);
        // 서버는 ASC로 반환
        history.value = rows.map(normalizeRow);
    }

    function pushLive(msg: LiveMessage): void {
        if (msg.type !== 'sensor') return;
        const row = normalizeRow(msg.data);
        history.value.push(row);
        if (history.value.length > MAX_HISTORY) {
            history.value.splice(0, history.value.length - MAX_HISTORY);
        }
        const ts = new Date(row.recorded_at).toLocaleTimeString();
        rawLog.value.push(`[${ts}] pm2.5=${row.pm25_grimm} pm10=${row.pm10_grimm} pa=${row.pressure_pa ?? '–'}`);
        if (rawLog.value.length > MAX_RAW_LOG) {
            rawLog.value.splice(0, rawLog.value.length - MAX_RAW_LOG);
        }
    }

    function setLiveConnected(c: boolean): void { liveConnected.value = c; }

    return { history, rawLog, liveConnected, latest, loadHistory, pushLive, setLiveConnected };
});

// MySQL DATETIME 컬럼이 문자열로 오는 경우와 ISO string 모두 처리
function normalizeRow(r: SensorRow | Record<string, unknown>): SensorRow {
    const obj = r as Record<string, unknown>;
    const raw = obj.recorded_at;
    let iso: string;
    if (raw instanceof Date) iso = raw.toISOString();
    else if (typeof raw === 'string') iso = new Date(raw).toISOString();
    else iso = new Date().toISOString();
    return {
        recorded_at: iso,
        pm1_grimm:  Number(obj.pm1_grimm),
        pm25_grimm: Number(obj.pm25_grimm),
        pm10_grimm: Number(obj.pm10_grimm),
        pm1_tsi:    Number(obj.pm1_tsi),
        pm25_tsi:   Number(obj.pm25_tsi),
        pm10_tsi:   Number(obj.pm10_tsi),
        cnt_0p3:    Number(obj.cnt_0p3),
        cnt_0p5:    Number(obj.cnt_0p5),
        cnt_1p0:    Number(obj.cnt_1p0),
        cnt_2p5:    Number(obj.cnt_2p5),
        cnt_5p0:    Number(obj.cnt_5p0),
        cnt_10:     Number(obj.cnt_10),
        pressure_pa:     obj.pressure_pa == null     ? null : Number(obj.pressure_pa),
        pressure_status: obj.pressure_status == null ? null : Number(obj.pressure_status),
    };
}
