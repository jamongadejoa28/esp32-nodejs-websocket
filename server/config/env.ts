import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const WS_PORT = Number(process.env.WS_PORT!);

export const pool = mysql.createPool({
    host: String(process.env.DB_HOST!),
    port: Number(process.env.DB_PORT!),
    user: String(process.env.DB_USER!),
    password: String(process.env.DB_PASS!),
    database: String(process.env.DB_NAME!),
    waitForConnections: true,
    connectionLimit: 2,
    maxIdle: 2,
    queueLimit: 0,
    idleTimeout: 60000,        // 60초 동안 유휴 상태인 연결은 자동으로 종료
    enableKeepAlive: true,     // stale 연결을 방지하기 위해 keep-alive 활성화
    keepAliveInitialDelay: 0, // 연결이 생성된 후 즉시 keep-alive 패킷을 보내도록 설정
});
