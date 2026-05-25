<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useConnectionStore } from '../stores/connection';
import { useSensorStore } from '../stores/sensor';
import { LiveClient } from '../ws/liveClient';
import StatTile from '../components/StatTile.vue';
import TimeSeriesChart from '../components/TimeSeriesChart.vue';
import TimeRangePicker from '../components/TimeRangePicker.vue';
import RawFramesLog from '../components/RawFramesLog.vue';

const conn = useConnectionStore();
const sensor = useSensorStore();
const router = useRouter();

const { dbStatus } = storeToRefs(conn);
const { history, rawLog, latest, liveConnected } = storeToRefs(sensor);

const rangeMs = ref(3 * 3600_000);
const loading = ref(false);
const loadError = ref<string | null>(null);

let live: LiveClient | null = null;

async function reloadHistory() {
    loading.value = true;
    loadError.value = null;
    try { await sensor.loadHistory(rangeMs.value); }
    catch (e: unknown) {
        const m = (e as { message?: string }).message ?? String(e);
        loadError.value = m;
    } finally { loading.value = false; }
}

watch(rangeMs, () => { reloadHistory(); });

async function onDisconnect() {
    if (live) { live.stop(); live = null; }
    await conn.disconnect();
    router.push('/connect');
}

onMounted(() => {
    reloadHistory();
    live = new LiveClient(
        conn.profile.wsUrl,
        (msg) => sensor.pushLive(msg),
        (c) => sensor.setLiveConnected(c),
    );
    live.start();
});

onUnmounted(() => {
    if (live) { live.stop(); live = null; }
});

const grimmSeries = [
    { name: 'PM1.0',  key: 'pm1_grimm'  as const, color: '#58a6ff' },
    { name: 'PM2.5',  key: 'pm25_grimm' as const, color: '#f59e0b' },
    { name: 'PM10',   key: 'pm10_grimm' as const, color: '#ef4444' },
];
const tsiSeries = [
    { name: 'PM1.0',  key: 'pm1_tsi'  as const, color: '#58a6ff' },
    { name: 'PM2.5',  key: 'pm25_tsi' as const, color: '#f59e0b' },
    { name: 'PM10',   key: 'pm10_tsi' as const, color: '#ef4444' },
];
const cntSeries = [
    { name: '>0.3μm', key: 'cnt_0p3' as const, color: '#22d3ee' },
    { name: '>0.5μm', key: 'cnt_0p5' as const, color: '#60a5fa' },
    { name: '>1.0μm', key: 'cnt_1p0' as const, color: '#a78bfa' },
    { name: '>2.5μm', key: 'cnt_2p5' as const, color: '#f472b6' },
    { name: '>5.0μm', key: 'cnt_5p0' as const, color: '#f59e0b' },
    { name: '>10μm',  key: 'cnt_10'  as const, color: '#ef4444' },
];
const presSeries = [
    { name: '차압', key: 'pressure_pa' as const, color: '#34d399' },
];
</script>

<template>
    <div class="mx-auto max-w-7xl space-y-4 p-4">
        <!-- 상단 상태 배너 -->
        <header class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-600 bg-surface-800 px-4 py-3">
            <div class="flex items-center gap-3 text-sm">
                <span class="inline-flex items-center gap-1.5">
                    <span class="h-2 w-2 rounded-full" :class="dbStatus?.connected ? 'bg-emerald-400' : 'bg-rose-400'"></span>
                    DB
                    <span class="text-slate-400">
                        {{ dbStatus?.connected ? `${dbStatus.host} · ${dbStatus.database}` : '미연결' }}
                    </span>
                </span>
                <span class="inline-flex items-center gap-1.5">
                    <span class="h-2 w-2 rounded-full" :class="liveConnected ? 'bg-emerald-400' : 'bg-amber-400'"></span>
                    Live
                    <span class="text-slate-400">{{ liveConnected ? '실시간 수신 중' : '연결 중...' }}</span>
                </span>
            </div>
            <div class="flex items-center gap-3">
                <TimeRangePicker v-model="rangeMs" />
                <button class="rounded border border-surface-600 px-3 py-1 text-sm text-slate-200 hover:bg-surface-700"
                    @click="reloadHistory">새로고침</button>
                <button class="rounded border border-rose-700 px-3 py-1 text-sm text-rose-300 hover:bg-rose-900/40"
                    @click="onDisconnect">Disconnect</button>
            </div>
        </header>

        <!-- 통계 타일 -->
        <section class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatTile label="PM2.5 (GRIMM)" :value="latest?.pm25_grimm ?? null" unit="μg/m³" accent="amber" />
            <StatTile label="PM10 (GRIMM)"  :value="latest?.pm10_grimm ?? null" unit="μg/m³" accent="rose" />
            <StatTile label="차압"           :value="latest?.pressure_pa ?? null" unit="Pa"   accent="green" />
        </section>

        <div v-if="loadError"
             class="rounded border border-rose-700 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            히스토리 로드 실패: {{ loadError }}
        </div>

        <!-- 차트 -->
        <section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TimeSeriesChart title="PM 농도 (GRIMM)" :data="history" :series="grimmSeries" yUnit="μg/m³" />
            <TimeSeriesChart title="PM 농도 (TSI)"   :data="history" :series="tsiSeries"   yUnit="μg/m³" />
            <TimeSeriesChart title="입자수 분포"      :data="history" :series="cntSeries"   yUnit="pcs/0.1L" />
            <TimeSeriesChart title="차압 (US633)"    :data="history" :series="presSeries"  yUnit="Pa"
                             :y-min="-1000" :y-max="1000" />
        </section>

        <RawFramesLog :entries="rawLog" />
    </div>
</template>
