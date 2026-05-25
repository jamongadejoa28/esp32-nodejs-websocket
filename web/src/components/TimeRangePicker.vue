<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ modelValue: number }>();
const emit  = defineEmits<{ (e: 'update:modelValue', v: number): void }>();

const options = [
    { label: '1h',  ms: 1 * 3600_000 },
    { label: '3h',  ms: 3 * 3600_000 },
    { label: '24h', ms: 24 * 3600_000 },
    { label: '7d',  ms: 7 * 24 * 3600_000 },
];

const current = computed(() => props.modelValue);
</script>

<template>
    <div class="inline-flex rounded-md border border-surface-600 bg-surface-800 p-1">
        <button
            v-for="o in options"
            :key="o.ms"
            type="button"
            class="px-3 py-1 text-sm rounded transition"
            :class="current === o.ms
                ? 'bg-accent-500 text-white'
                : 'text-slate-300 hover:bg-surface-700'"
            @click="emit('update:modelValue', o.ms)">
            {{ o.label }}
        </button>
    </div>
</template>
