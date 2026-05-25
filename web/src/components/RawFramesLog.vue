<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ entries: string[] }>();
const open = ref(false);
</script>

<template>
    <div class="rounded-lg border border-surface-600 bg-surface-800">
        <button
            class="flex w-full items-center justify-between px-4 py-2 text-sm text-slate-300 hover:bg-surface-700"
            @click="open = !open">
            <span>Raw frames ({{ entries.length }})</span>
            <span class="text-slate-500">{{ open ? '▾' : '▸' }}</span>
        </button>
        <div v-if="open" class="max-h-64 overflow-auto border-t border-surface-600 p-3 text-xs font-mono text-slate-300">
            <div v-if="entries.length === 0" class="text-slate-500">아직 수신된 프레임이 없습니다.</div>
            <div v-for="(line, i) in entries.slice().reverse()" :key="i">{{ line }}</div>
        </div>
    </div>
</template>
