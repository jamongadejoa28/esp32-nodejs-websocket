import { getJson } from './http';
import type { SensorRow } from '../types/sensor';

export const sensorApi = {
    latest:  () => getJson<SensorRow | null>('/api/sensor/latest'),
    history: (fromISO: string, toISO: string, limit = 5000) => {
        const q = new URLSearchParams({ from: fromISO, to: toISO, limit: String(limit) });
        return getJson<SensorRow[]>(`/api/sensor/history?${q.toString()}`);
    },
};
