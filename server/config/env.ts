import mysql from 'mysql2/promise';
import path from 'path';                    // 파일 경로 조작을 위한 Node.js 내장 모듈
import { fileURLToPath } from 'url';        // __dirname과 __filename을 ES 모듈에서 사용할 수 있도록 설정
import dotenv from 'dotenv';                // .env 파일에서 환경 변수 로드

// ES 모듈에서 __dirname과 __filename을 사용할 수 있도록 설정
const __filename = fileURLToPath(import.meta.url);    
const __dirname = path.dirname(__filename);

// .env 파일에서 환경 변수 로드 -> pwd server/에서 실행하므로 ../.env 경로 지정
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const WS_PORT = Number(process.env.WS_PORT ?? 8080);
export const WS_HOST = String(process.env.WS_HOST ?? '0.0.0.0');


/* --- 유효성 검사 --- */
// 필수 환경 변수 목록
const requiredEnvVars = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME', 'DB_PASS'];

export function validationEnv() {
    const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error('필수 환경 변수가 누락 되었습니다');
        missingVars.forEach((varName) => {
            console.error(`- ${varName}`);
        });
        process.exit(1); // 누락된 환경 변수가 있을 경우 애플리케이션 종료  
    }

    // 포트 번호가 숫자인지 추가 검사
    if (isNaN(Number(process.env.DB_PORT))) {
        console.error('DB_PORT는 숫자여야 합니다');
        process.exit(1);
    }

    console.log('모든 필수 환경 변수가 설정되었습니다');
}

validationEnv();

// MySQL 연결 풀 생성
/* 
연산자,이름,역할
!,  Non-null assertion, "컴파일러에게 ""무조건 값이 있다""고 강제로 믿게 함 (가장 위험)"
?,  Optional chaining,    값이 없으면 에러를 내는 대신 undefined를 반환하고 멈춤
??, Nullish coalescing, 값이 null이나 undefined면 우측의 기본값을 사용함 (가장 안전)
*/
export const pool = mysql.createPool({
    host: String(process.env.DB_HOST ?? '127.0.0.1'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: String(process.env.DB_USER ?? ''),
    password: String(process.env.DB_PASS ?? ''),
    database: String(process.env.DB_NAME ?? ''),
    waitForConnections: true,
    connectionLimit: 2,
    maxIdle: 2,
    queueLimit: 0,
    idleTimeout: 60000,        // 60초 동안 유휴 상태인 연결은 자동으로 종료
    enableKeepAlive: true,     // stale 연결을 방지하기 위해 keep-alive 활성화
    keepAliveInitialDelay: 0, // 연결이 생성된 후 즉시 keep-alive 패킷을 보내도록 설정
});
