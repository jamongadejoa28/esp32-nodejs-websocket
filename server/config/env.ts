import mysql from 'mysql2/promise';

export const WS_PORT = Number(process.env.WS_PORT ?? 3400);

export const pool = mysql.createPool({
    host: process.env.DB_HOST ?? '192.168.0.250',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'hajun',
    password: process.env.DB_PASS ?? 'hajun3778',
    database: process.env.DB_NAME ?? 'hajun_db',
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    idleTimeout: 30000,        // 30초 동안 유휴 상태인 연결은 자동으로 종료
    enableKeepAlive: false     // keep-alive 비활성화 (MySQL 서버가 연결을 끊는 것을 방지)
});
