# WebSocket 서버 운영 가이드

ESP32-C3 → Node.js WebSocket 서버 → MariaDB(NAS) 파이프라인의 서버 측 실행/설정 및 NAS IP 자동 차단 이슈 트러블슈팅 기록.

---

## 1. 시스템 구성

```
ESP32-C3 ──WebSocket──→ Node.js TS 서버 (WSL2, :WS_PORT)
                              │
                              │ INSERT
                              ▼
                        MariaDB (iptime NAS, :3306)
                              ▲
                              │ SELECT
                              │
                        Grafana
```

- **서버 위치**: WSL2 (Windows 11 호스트, mirrored networking 모드)
- **서버 bind**: `0.0.0.0:WS_PORT` (모든 인터페이스에서 수신)
- **DB**: iptime NAS의 MariaDB, mysql2 connection pool 사용
- **ESP32 측**: `WS_HOST`/`WS_PORT`를 `include/config_local.h`(gitignored)에서 받아 연결

---

## 2. 설정 파일

### 2-1. `server/.env` (서버 전용, gitignored)

```env
DB_HOST=192.168.0.250
DB_PORT=3306
DB_USER=<your_user>
DB_PASS=<your_password>
DB_NAME=<your_database>

WS_HOST=0.0.0.0
WS_PORT=3400
```

- `.gitignore`에 `.env`가 포함되어 있어 커밋되지 않음.
- `WS_HOST`는 사실상 사용되지 않지만(서버는 `0.0.0.0` 하드코딩), 환경 진단 로그용으로 정의는 남겨둠.

### 2-2. `include/config_local.h` (ESP32 펌웨어 전용, gitignored)

```c
#pragma once

#define WS_HOST "192.168.0.XXX"   // 서버가 도는 PC의 LAN IP
#define WS_PORT 3400
```

- `.gitignore`에 `/include/config_local.h`로 명시되어 커밋되지 않음.
- `include/config.h` 최상단에서 `#include "config_local.h"`로 끌어옴.
- 이렇게 분리하는 이유: ESP32 펌웨어는 WS 접속 정보만 필요하고 **DB 자격증명이 펌웨어 바이너리에 박혀선 안 됨**. (덤프 시 평문 노출)

새로 클론한 환경에서는 이 파일이 없으므로 직접 생성 후 PC IP를 채워야 빌드 가능.

---

## 3. server.ts 실행 방법

### 3-1. 의존성 설치

```bash
cd esp32-c3-dev-test
npm install
```

### 3-2. 실행

**개발 모드 (권장)** — `tsx`로 즉시 실행:
```bash
npm run dev
```

**빌드 후 실행** — TypeScript 컴파일:
```bash
npm run build
npm start
```

**일회성 직접 실행**:
```bash
npx tsx server/server.ts
```

### 3-3. 정상 기동 시 로그

```
[env] DB_HOST: 192.168.0.250
[env] DB_PORT: 3306
[env] DB_USER: <user>
[env] DB_NAME: <db>
[env] DB_PASS: ***
[env] WS_PORT: 3400
[env] WS_HOST: 0.0.0.0
모든 필수 환경 변수가 설정되었습니다
server running on ws://0.0.0.0:3400
```

`DB_PASS: MISSING`이 보이면 `.env` 로드 실패 → 3-4 참고.

### 3-4. .env 로드 실패 시

`env.ts`는 `path.join(__dirname, '..', '.env')`로 `server/.env`를 읽음. 다른 cwd에서 띄우면 못 찾을 수 있음.

대안: package.json scripts에서 `--env-file` 명시.
```json
"dev": "tsx --env-file=server/.env server/server.ts"
```

### 3-5. 동작 확인

서버 띄운 상태에서 WSL2 내에서:
```bash
npx wscat -c ws://localhost:3400
```
연결되면 OK. ESP32가 같은 LAN에서 PC IP:3400으로 붙으면 첫 핸드셰이크 로그가 찍힘.

---

## 4. 트러블슈팅 — NAS IP 자동 차단 (이번 작업)

### 증상

- 서버 기동 직후 NAS DB에 몇 건 정상 INSERT
- 잠시 후부터 모든 INSERT 실패, NAS의 다른 포트(HTTP 등)도 동시 차단
- NAS MySQL의 `mysql.user` 권한이나 `host_cache`에는 별다른 흔적 없음
- PC 재부팅하면 일시 복구, 다시 띄우면 같은 증상 반복

### 근본 원인

**WSL2 mirrored networking 모드에서 서버 소켓을 LAN IP에 직접 bind**한 것이 원인.

```typescript
// 문제가 된 코드 (d823721 이후)
const HOST = WS_HOST;   // '192.168.0.126' 같은 PC의 LAN IP
server.listen(PORT, HOST);
```

mirrored 모드는 WSL2가 Windows 호스트의 네트워크 인터페이스를 그대로 공유하는 방식이다. Windows가 이미 `192.168.0.126`을 자기 NIC에 가지고 있는 상태에서 WSL2 프로세스가 같은 IP에 bind하면, TCP 핸드셰이크 경로 일부가 비정상적으로 RST로 떨어진다. 그 RST/비정상 종료가 누적되어:

1. NAS MySQL의 `Aborted_connects` 카운터 누적 → `max_connect_errors`(기본 100) 임계 도달
2. **iptime NAS의 펌웨어 단 IPS**가 LAN의 한 호스트에서 다수의 비정상 TCP 시도를 감지 → 해당 IP를 전 포트 차단

② 때문에 MySQL 단을 확인해도 차단 흔적이 안 보이는데도 접속이 안 되는 모순적인 상태가 된다.

### 해결

**서버를 `0.0.0.0`에 bind하도록 복구.**

```typescript
// server/server.ts
const HOST = "0.0.0.0";   // WS_HOST 대신 모든 인터페이스
const PORT = WS_PORT;
server.listen(PORT, HOST);
```

`0.0.0.0` bind는 커널이 인터페이스별로 적절히 라우팅하므로 mirrored 모드와 충돌하지 않는다. 차단 트리거가 사라져 정상화됨.

### 차단 발생 시 응급 조치

NAS 텔넷으로 진입 후:

```bash
# MariaDB CLI
mysql -u root -p

# 차단된 호스트 강제 해제
FLUSH HOSTS;

# 누적된 카운터 확인
SHOW STATUS LIKE 'Aborted%';
SELECT IP, COUNT_HANDSHAKE_ERRORS, COUNT_HOST_BLOCKED_ERRORS
  FROM performance_schema.host_cache;
```

`Aborted_connects` 비율이 비정상적으로 높으면 (예: 80%+) 위 패턴 재현 중일 가능성.

iptime 웹 관리자 → 보안설정에서 차단 IP 목록도 별도 확인. 펌웨어 단 차단은 MariaDB의 `FLUSH HOSTS;`로 안 풀린다.

### 진단 체크리스트 (재발 시)

증상 발생 시 WSL2에서 세 명령을 동시에 실행해 어느 단에서 막혔는지 식별:

```bash
# 1) MySQL 단 접속
mysql -h <NAS_IP> -P 3306 -u <USER> -p -e "SELECT 1;"

# 2) 네트워크 단 연결
nc -zv <NAS_IP> 3306

# 3) 핑
ping -c 5 <NAS_IP>
```

| ① mysql | ② nc | ③ ping | 진단 |
|--------|------|--------|------|
| ❌ | ✅ | ✅ | MySQL 단 차단 (`ER_HOST_IS_BLOCKED`) → `FLUSH HOSTS;` |
| ❌ | ❌ | ✅ | NAS 방화벽/IPS 차단 → iptime 관리자에서 해제 |
| ❌ | ❌ | ❌ | NAS 자체 다운 / 네트워크 단절 |
| ✅ | ✅ | ✅ | NAS는 정상, 서버 쪽 pool stale connection → 서버 재기동 |

---

## 5. ESP32 측 보안 분리 작업

### 배경

이전에 `read_env.py` (PlatformIO extra_scripts)로 `server/.env`의 모든 변수를 ESP32 빌드 플래그(`-D`)로 주입하던 구조였다. 빌드는 됐지만:

- `DB_USER`, `DB_PASS`, `DB_HOST` 등 **DB 자격증명이 ESP32 펌웨어 바이너리에 평문 매크로로 박힘**
- 펌웨어 덤프 시 자격증명 노출 위험
- 코드상 ESP32는 `WS_HOST`/`WS_PORT`만 사용하므로 DB 변수는 불필요한 노출

### 조치

1. `platformio.ini`에서 `extra_scripts = pre:read_env.py` **주석 처리** (스크립트 비활성화)
2. `include/config_local.h` 생성, `WS_HOST`/`WS_PORT` 정의
3. `include/config.h` 최상단에서 `#include "config_local.h"`
4. `.gitignore`에 `/include/config_local.h` 추가 — git에 IP 정보 노출 방지

이렇게 하면:
- ESP32 펌웨어에는 `WS_HOST`/`WS_PORT`만 박힘 (DB 정보 일절 없음)
- git 저장소에는 PC LAN IP가 안 올라감
- 빌드 시 Python 스크립트 의존 제거 → 빌드 단순화

`read_env.py` 자체는 참고용으로 저장소에 남아있지만 실행되지 않는다. 향후 다시 쓰려면 **반드시 키 화이트리스트**를 추가해 DB 변수가 새지 않도록 해야 한다.

---

## 6. 관련 커밋

| 커밋 | 변경 |
|------|------|
| `513ee55` fix: bind server to 0.0.0.0 ... | server.ts HOST를 0.0.0.0으로 복구, config_local.h 분리, read_env.py 비활성화 |
| `799846c` fix: gitignore | gitignore 패턴을 `/include/config_local.h`로 정확하게 좁힘 |

---

## 7. 관련 환경

| 항목 | 값 |
|------|----|
| OS | Windows 11 + WSL2 (mirrored networking) |
| Node.js | v24.x |
| TypeScript | ^6 |
| mysql2 | ^3.22 |
| NAS | iptime NAS dual1 |
| MariaDB | 5.6.x |
| ESP32 | ESP32-C3 SuperMini |
| WS lib (ESP32) | links2004/WebSockets@^2.4.1 |

---

## 8. 향후 주의사항

- 서버 `HOST` 값은 `0.0.0.0` 외 값으로 바꾸지 말 것 (WSL2 mirrored 모드 한정 이슈).
- `read_env.py`를 재활성화할 일이 있다면 반드시 ESP_KEYS 화이트리스트 추가.
- PC IP가 바뀌면 `include/config_local.h`의 `WS_HOST` 갱신 후 ESP32 재플래시.
- NAS DB의 `max_connect_errors`는 기본값(100)이 낮으므로, 비정상 종료가 누적되면 쉽게 차단됨. 운영 중 카운터 모니터링 권장.
