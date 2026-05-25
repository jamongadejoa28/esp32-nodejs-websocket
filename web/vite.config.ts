import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 개발 시 Vite(:5173)에서 들어오는 /api, /live 요청을 Node 서버(:3400)로 프록시.
// 같은 origin을 유지해 서브넷 검증 시 client IP가 의도대로 잡히도록 한다.
export default defineConfig({
    plugins: [vue()],
    server: {
        host: true,
        port: 5173,
        proxy: {
            '/api':    { target: 'http://localhost:3400', changeOrigin: true },
            '/live':   { target: 'ws://localhost:3400',   ws: true },
            '/ingest': { target: 'ws://localhost:3400',   ws: true },
        },
    },
});
