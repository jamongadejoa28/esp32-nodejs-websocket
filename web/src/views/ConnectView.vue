<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useConnectionStore } from '../stores/connection';

const conn = useConnectionStore();
const router = useRouter();
const testing = ref(false);

async function onConnect() {
    const ok = await conn.connect();
    if (ok) router.push('/dashboard');
}

async function onTest() {
    testing.value = true;
    try { await conn.connect(); }
    finally { testing.value = false; }
}
</script>

<template>
    <div class="flex min-h-full items-center justify-center p-4">
        <div class="w-full max-w-md rounded-xl border border-surface-600 bg-surface-800 p-6 shadow-lg">
            <h1 class="text-xl font-semibold text-slate-100">DB 접속 설정</h1>
            <p class="mt-1 text-xs text-slate-400">
                같은 /24 서브넷의 MySQL에만 접속할 수 있습니다.
                자격증명은 메모리에만 보관됩니다.
            </p>

            <form class="mt-5 space-y-3" @submit.prevent="onConnect">
                <div class="grid grid-cols-3 gap-2">
                    <label class="col-span-2 text-sm text-slate-300">
                        Host
                        <input v-model="conn.profile.host" type="text" required
                            placeholder="192.168.0.250"
                            class="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-2 py-1.5 text-slate-100 focus:border-accent-400 focus:outline-none" />
                    </label>
                    <label class="text-sm text-slate-300">
                        Port
                        <input v-model.number="conn.profile.port" type="number" min="1" max="65535" required
                            class="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-2 py-1.5 text-slate-100 focus:border-accent-400 focus:outline-none" />
                    </label>
                </div>

                <label class="block text-sm text-slate-300">
                    User
                    <input v-model="conn.profile.user" type="text" required autocomplete="username"
                        class="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-2 py-1.5 text-slate-100 focus:border-accent-400 focus:outline-none" />
                </label>

                <label class="block text-sm text-slate-300">
                    Password
                    <input v-model="conn.password" type="password" required autocomplete="current-password"
                        class="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-2 py-1.5 text-slate-100 focus:border-accent-400 focus:outline-none" />
                </label>

                <label class="block text-sm text-slate-300">
                    Database
                    <input v-model="conn.profile.database" type="text" required
                        class="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-2 py-1.5 text-slate-100 focus:border-accent-400 focus:outline-none" />
                </label>

                <label class="block text-sm text-slate-300">
                    WebSocket URL
                    <input v-model="conn.profile.wsUrl" type="text"
                        class="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-2 py-1.5 text-slate-100 focus:border-accent-400 focus:outline-none" />
                    <span class="mt-1 block text-xs text-slate-500">실시간 데이터 수신 채널 (/live)</span>
                </label>

                <label class="flex items-center gap-2 text-sm text-slate-300">
                    <input v-model="conn.remember" type="checkbox" class="rounded border-surface-600 bg-surface-900" />
                    설정 기억 (비밀번호 제외)
                </label>

                <div v-if="conn.error"
                     class="rounded border border-rose-700 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                    {{ conn.error }}
                </div>

                <div class="flex gap-2 pt-2">
                    <button type="button" :disabled="testing || conn.status === 'connecting'"
                        class="flex-1 rounded border border-surface-600 px-3 py-2 text-sm text-slate-200 hover:bg-surface-700 disabled:opacity-50"
                        @click="onTest">
                        Test connection
                    </button>
                    <button type="submit" :disabled="conn.status === 'connecting'"
                        class="flex-1 rounded bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-400 disabled:opacity-50">
                        {{ conn.status === 'connecting' ? '연결 중...' : 'Connect & Continue' }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>
