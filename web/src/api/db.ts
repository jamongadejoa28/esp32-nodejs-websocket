import { getJson, postJson } from './http';
import type { DbStatus } from '../types/sensor';

export interface ConnectRequest {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

export interface ConnectResponse {
    ok: boolean;
    drained: number;
    inserted: number;
    status: DbStatus;
}

export const dbApi = {
    status:     () => getJson<DbStatus>('/api/db/status'),
    connect:    (body: ConnectRequest) => postJson<ConnectResponse>('/api/db/connect', body),
    disconnect: () => postJson<{ ok: boolean }>('/api/db/disconnect', {}),
};
