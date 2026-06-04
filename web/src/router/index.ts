import { createRouter, createWebHistory } from 'vue-router';
import { useConnectionStore } from '../stores/connection';
import ConnectView from '../views/ConnectView.vue';
import DashboardView from '../views/DashboardView.vue';

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/',          redirect: '/connect' },
        { path: '/connect',   component: ConnectView },
        {
            path: '/dashboard',
            component: DashboardView,
            beforeEnter: async (_to, _from, next) => {
                const conn = useConnectionStore();
                const s = await conn.refreshStatus();
                if (s?.connected) next();
                else next({ path: '/connect' });
            },
        },
    ],
});
