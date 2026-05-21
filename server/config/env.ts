import mysql from 'mysql2/promise';
import path from 'path';                    // 파일 경로 조작을 위한 Node.js 내장 모듈
import { fileURLToPath } from 'url';        // __dirname과 __filename을 ES 모듈에서 사용할 수 있도록 설정
import dotenv from 'dotenv';                // .env 파일에서 환경 변수 로드

// ES 모듈에서 __dirname과 __filename을 사용할 수 있도록 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 파일에서 환경 변수 로드 -> pwd server/에서 실행하므로 ../.env 경로 지정
dotenv.config({ path: path.join(__dirname, '..', '.env') });


/* --- 유효성 검사 (필수 환경 변수 누락 시 즉시 종료) --- */

// 문자열 필수 변수: 비어있거나 미정의면 process.exit
function required(key: string): string {
    const v = process.env[key];
    if (v === undefined || v === '') {
        console.error(`필수 환경 변수가 누락되었습니다: ${key}`);
        process.exit(1);
    }
    return v;
}

// 숫자 필수 변수: required + 숫자 파싱 검증
function requiredNumber(key: string): number {
    const raw = required(key);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        console.error(`${key}는 숫자여야 합니다 (받은 값: "${raw}")`);
        process.exit(1);
    }
    return n;
}


/* --- 타입 보장된 환경 변수 객체 ---
 * required/requiredNumber를 통과한 시점에서 각 필드는 string/number 보장.
 * 이후 코드에서는 process.env를 직접 만지지 말고 env.* 로 참조.
 */
export const env = {
    DB_HOST: required('DB_HOST'),
    DB_PORT: requiredNumber('DB_PORT'),
    DB_USER: required('DB_USER'),
    DB_PASS: required('DB_PASS'),
    DB_NAME: required('DB_NAME'),
    WS_HOST: process.env.WS_HOST ?? '0.0.0.0',   // ws는 선택적 — 미지정 시 모든 인터페이스
    WS_PORT: Number(process.env.WS_PORT ?? 8080),
} as const;

console.log('모든 필수 환경 변수가 설정되었습니다');

// 하위 호환: 기존 import { WS_PORT, WS_HOST } 형태도 계속 동작
export const WS_HOST = env.WS_HOST;
export const WS_PORT = env.WS_PORT;


// MySQL 연결 풀 생성
/*
연산자,이름,역할
!,  Non-null assertion, "컴파일러에게 ""무조건 값이 있다""고 강제로 믿게 함 (가장 위험)"
?,  Optional chaining,    값이 없으면 에러를 내는 대신 undefined를 반환하고 멈춤
??, Nullish coalescing, 값이 null이나 undefined면 우측의 기본값을 사용함 (가장 안전)
*/
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
    idleTimeout: 60000,        // 60초 동안 유휴 상태인 연결은 자동으로 종료
    enableKeepAlive: true,     // stale 연결을 방지하기 위해 keep-alive 활성화
    keepAliveInitialDelay: 0,  // 연결이 생성된 후 즉시 keep-alive 패킷을 보내도록 설정
});
