<script setup lang="ts">
defineProps<{
    label: string;
    value: string | number | null;
    unit?: string;
    accent?: 'blue' | 'green' | 'amber' | 'rose';
}>();
</script>

<template>
    <div class="rounded-lg border border-surface-600 bg-surface-800 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">{{ label }}</div>
        <div class="mt-1 flex items-baseline gap-1">
            <span class="text-3xl font-semibold tabular-nums" :class="{
                'text-accent-400': accent === 'blue' || !accent,
                'text-emerald-400': accent === 'green',
                'text-amber-400':   accent === 'amber',
                'text-rose-400':    accent === 'rose',
            }">{{ value ?? '–' }}</span>
            <span v-if="unit" class="text-sm text-slate-400">{{ unit }}</span>
        </div>
    </div>
</template>
