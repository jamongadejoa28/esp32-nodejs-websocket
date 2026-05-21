import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function required(key: string): string {
    const v = process.env[key];
    if (v === undefined || v === '') {
        console.error(`필수 환경 변수가 누락되었습니다: ${key}`);
        process.exit(1);
    }
    return v;
}

function requiredNumber(key: string): number {
    const raw = required(key);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        console.error(`${key}는 숫자여야 합니다 (받은 값: "${raw}")`);
        process.exit(1);
    }
    return n;
}

export const env = {
    DB_HOST: required('DB_HOST'),
    DB_PORT: requiredNumber('DB_PORT'),
    DB_USER: required('DB_USER'),
    DB_PASS: required('DB_PASS'),
    DB_NAME: required('DB_NAME'),
    WS_HOST: process.env.WS_HOST ?? '0.0.0.0',
    WS_PORT: Number(process.env.WS_PORT ?? 8080),
} as const;

console.log('모든 필수 환경 변수가 설정되었습니다');

export const WS_HOST = env.WS_HOST;
export const WS_PORT = env.WS_PORT;

export const pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2,
    maxIdle: 2,
    queueLimit: 0,
    idleTimeout: 60000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});
