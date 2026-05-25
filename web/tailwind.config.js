/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{vue,ts,js}'],
    theme: {
        extend: {
            colors: {
                // 대시보드 다크 톤
                surface: { 900: '#0e1117', 800: '#161b22', 700: '#21262d', 600: '#30363d' },
                accent: { 400: '#58a6ff', 500: '#388bfd' },
            },
        },
    },
    plugins: [],
};
