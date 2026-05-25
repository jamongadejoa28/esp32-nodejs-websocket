/* 서버 sensorTypes.ts와 동일한 스키마. */

export interface SensorRow {
    recorded_at: string;          // ISO
    pm1_grimm: number; pm25_grimm: number; pm10_grimm: number;
    pm1_tsi: number;   pm25_tsi: number;   pm10_tsi: number;
    cnt_0p3: number;   cnt_0p5: number;    cnt_1p0: number;
    cnt_2p5: number;   cnt_5p0: number;    cnt_10: number;
    pressure_pa: number | null;
    pressure_status: number | null;
}

export type LiveMessage =
    | { type: 'sensor'; data: SensorRow }
    | { type: 'status'; data: { dbConnected: boolean; pendingFrames: number } }
    | { type: 'error';  data: { message: string } };

export interface DbStatus {
    connected: boolean;
    host: string | null;
    database: string | null;
    connectedAt: string | null;
}

export interface ConnectionProfile {
    host: string;
    port: number;
    user: string;
    database: string;
    wsUrl: string;          // 기본 location.origin
}
