<script setup lang="ts">
/* ECharts 시계열 차트 래퍼.
 * - data: SensorRow[]을 받아 timestamp + 시리즈별 값으로 변환
 * - series: { name, key, color? } 배열
 * - yUnit: y축 단위 라벨 (μg/m³, Pa, count 등)
 */

import { computed, defineAsyncComponent } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
    GridComponent, TooltipComponent, LegendComponent,
    DataZoomComponent, TitleComponent,
} from 'echarts/components';
import type { EChartsOption } from 'echarts';
import type { SensorRow } from '../types/sensor';

use([
    CanvasRenderer, LineChart,
    GridComponent, TooltipComponent, LegendComponent,
    DataZoomComponent, TitleComponent,
]);

// vue-echarts는 동적 import로 분리 (초기 번들 축소)
const VChart = defineAsyncComponent(() => import('vue-echarts'));

interface SeriesSpec {
    name: string;
    key: keyof SensorRow;
    color?: string;
}

const props = defineProps<{
    title: string;
    data: SensorRow[];
    series: SeriesSpec[];
    yUnit?: string;
    yMin?: number;
    yMax?: number;
}>();

const option = computed<EChartsOption>(() => {
    const ts = props.data.map(r => r.recorded_at);
    return {
        backgroundColor: 'transparent',
        textStyle: { color: '#cbd5e1' },
        title: {
            text: props.title,
            left: 8,
            textStyle: { color: '#e2e8f0', fontSize: 14, fontWeight: 'normal' },
        },
        tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
        legend: {
            top: 6, right: 10, textStyle: { color: '#cbd5e1' },
            data: props.series.map(s => s.name),
        },
        grid: { left: 50, right: 18, top: 50, bottom: 40 },
        xAxis: {
            type: 'time',
            data: ts,
            axisLine: { lineStyle: { color: '#475569' } },
            axisLabel: { color: '#94a3b8' },
        },
        yAxis: {
            type: 'value',
            name: props.yUnit ?? '',
            nameTextStyle: { color: '#94a3b8' },
            ...(props.yMin !== undefined ? { min: props.yMin } : {}),
            ...(props.yMax !== undefined ? { max: props.yMax } : {}),
            axisLine: { lineStyle: { color: '#475569' } },
            splitLine: { lineStyle: { color: '#21262d' } },
            axisLabel: { color: '#94a3b8' },
        },
        dataZoom: [
            { type: 'inside', throttle: 50 },
        ],
        series: props.series.map(s => ({
            name: s.name,
            type: 'line',
            showSymbol: false,
            smooth: false,
            lineStyle: { width: 1.5, ...(s.color ? { color: s.color } : {}) },
            ...(s.color ? { itemStyle: { color: s.color } } : {}),
            data: props.data.map(r => {
                const v = r[s.key];
                return [r.recorded_at, typeof v === 'number' ? v : null];
            }),
        })),
    };
});
</script>

<template>
    <div class="rounded-lg border border-surface-600 bg-surface-800 p-2">
        <VChart class="h-72 w-full" :option="option" autoresize />
    </div>
</template>
