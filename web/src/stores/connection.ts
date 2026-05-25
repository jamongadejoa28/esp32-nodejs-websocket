import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dbApi, type ConnectRequest } from '../api/db';
import type { ConnectionProfile, DbStatus } from '../types/sensor';
import { defaultLiveUrl } from '../ws/liveClient';

const STORAGE_KEY = 'esp32-dashboard-profile';

function loadProfile(): ConnectionProfile {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw) as Partial<ConnectionProfile>;
            return {
                host: p.host ?? '',
                port: p.port ?? 3306,
                user: p.user ?? '',
                database: p.database ?? '',
                wsUrl: p.wsUrl ?? defaultLiveUrl(),
            };
        }
    } catch { /* ignore */ }
    return { host: '', port: 3306, user: '', database: '', wsUrl: defaultLiveUrl() };
}

export const useConnectionStore = defineStore('connection', () => {
    const profile = ref<ConnectionProfile>(loadProfile());
    const password = ref('');                                  // RAM only
    const status   = ref<'idle' | 'connecting' | 'connected' | 'error'>('idle');
    const error    = ref<string | null>(null);
    const dbStatus = ref<DbStatus | null>(null);
    const remember = ref(true);

    function saveProfile(): void {
        if (!remember.value) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile.value));
    }

    async function connect(): Promise<boolean> {
        status.value = 'connecting';
        error.value = null;
        const body: ConnectRequest = {
            host: profile.value.host,
            port: profile.value.port,
            user: profile.value.user,
            password: password.value,
            database: profile.value.database,
        };
        try {
            const res = await dbApi.connect(body);
            dbStatus.value = res.status;
            status.value = 'connected';
            saveProfile();
            return true;
        } catch (e: unknown) {
            const apiErr = e as { message?: string };
            error.value = apiErr.message ?? String(e);
            status.value = 'error';
            return false;
        }
    }

    async function refreshStatus(): Promise<DbStatus | null> {
        try {
            dbStatus.value = await dbApi.status();
            return dbStatus.value;
        } catch {
            dbStatus.value = null;
            return null;
        }
    }

    async function disconnect(): Promise<void> {
        try { await dbApi.disconnect(); } catch { /* ignore */ }
        dbStatus.value = null;
        status.value = 'idle';
        password.value = '';
    }

    return {
        profile, password, status, error, dbStatus, remember,
        connect, refreshStatus, disconnect, saveProfile,
    };
});
