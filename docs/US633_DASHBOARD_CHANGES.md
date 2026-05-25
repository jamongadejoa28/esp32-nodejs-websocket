# US633 차압센서 + Vue 대시보드 — 수정 내역

상용 판매 시나리오에 맞춰 차압센서 US633-F1K-T4를 추가하고 Grafana를 자체 Vue 대시보드로 대체하기 위한 변경 사항을 정리합니다. 본 문서는 구현 명세(spec)이자 변경 카탈로그로 사용됩니다.

---

## 1. 변경 요약

| 영역 | 변경 종류 | 파일 |
|---|---|---|
| 펌웨어 | 차압센서 드라이버 추가 | `include/config.h`, `src/main.cpp` |
| DB | 컬럼 2개 추가 | `sql/schema.sql`, `sql/migrations/2026_05_add_pressure.sql` |
| 서버 | 외부 프레임워크 제거, REST + WS 다중화 | `package.json`, `server/.env`, `server/server.ts`, 신규 9개 모듈 |
| 웹 | 신규 Vue 3 대시보드 | `web/` (신규 디렉터리 전체) |

설계 원칙
- 외부 프레임워크(express, ws 라이브러리 등) 사용하지 않음. 임베디드 스타일로 raw `node:net` + 손작성 RFC6455/HTTP를 유지하여 저지연·엄격 프로토콜 제어.
- DB 자격증명은 `.env`가 아닌 **첫 대시보드 접속 시 런타임으로 전달받아 서버 메모리에 보관**. 현업에서 가장 일반적인 "백엔드가 DB 풀을 소유" 패턴.
- 대시보드 → 서버 접속 시 클라이언트 IP와 DB 호스트 IP가 같은 `/24` 서브넷이어야만 진행 (LAN 한정 권한).

---

## 2. 펌웨어 변경

### 2.1 `include/config.h` — 상수 추가

기존 `SENSOR_ADDR 0x28` 블록 바로 아래에 다음을 추가:

```c
// ── US633-F1K-T4 differential pressure (same I2C bus) ────────
// Sensor pins 10/11 (SDA/SCL) wired to ESP32 GPIO8/9.
// 7-bit slave address; Wire library shifts to 0x98 (write) / 0x99 (read).
#define PRESSURE_ADDR        0x4C
#define PRESSURE_CMD_FORCE   0xAA    // Force Mode trigger (1 byte)
#define PRESSURE_WAIT_MS     12      // datasheet: ADC conversion > 10 ms
#define PRESSURE_FRAME_SIZE  4       // [status, p_hi, p_mid, p_lo]
```

### 2.2 `src/main.cpp` — 변경점

1. `SensorData` 구조체에 필드 추가:
   ```cpp
   int32_t  pressure_pa;
   uint8_t  pressure_status;
   bool     pressure_ok;
   ```

2. 새 함수 `readPressure(SensorData &d)` 추가 (기존 `readSensor()` 옆):
   - Force Mode 트리거: `Wire.beginTransmission(0x4C) → Wire.write(0xAA) → Wire.endTransmission()`
   - 변환 대기: `delay(12)`
   - 4바이트 읽기: `Wire.requestFrom(0x4C, 4)` → status, p_hi, p_mid, p_lo
   - 변환식 (datasheet 9페이지):
     ```cpp
     uint32_t raw24    = ((uint32_t)hi << 16) | ((uint32_t)mid << 8) | lo;
     int64_t  centered = (int64_t)raw24 - (int64_t)0x800000;   // midpoint = 0 Pa
     int64_t  pa64     = (centered * 2000LL) / 11744051LL;     // 0x07D0 / 0xB33333
     d.pressure_pa     = (int32_t)pa64;
     ```
   - 곱셈 중간값이 1.6e10 수준이므로 반드시 `int64_t` 사용.

3. `loop()` 안에서 `readSensor()` 성공 후 `readPressure(data)` 호출. 차압 읽기 실패해도 PM 데이터는 그대로 전송.

4. `postData()`의 JSON 직렬화 부분 확장:
   ```cpp
   if (d.pressure_ok) {
       doc["pressure_pa"]     = d.pressure_pa;
       doc["pressure_status"] = d.pressure_status;
   } else {
       doc["pressure_pa"]     = nullptr;
       doc["pressure_status"] = nullptr;
   }
   ```

5. `setup()`의 WebSocket 경로 변경:
   ```cpp
   ws.begin(WS_HOST, WS_PORT, "/ingest");   // 기존: "/"
   ```

### 2.3 하드웨어 주의

- I2C 버스 공유: PM2008(0x28) ↔ US633(0x4C) 주소 충돌 없음. `Wire.begin()` 한 번이면 충분.
- 풀업: SDA/SCL 4.7 kΩ ~ 10 kΩ. PM2008 모듈에 이미 풀업이 있으면 별도 부착 불필요(실측 권장).
- 12 ms 블로킹 delay는 10 초 샘플링 주기 대비 무시 가능.

---

## 3. DB 스키마 변경

`pm_sensor_data` 테이블에 컬럼 2개 추가. 기존 펌웨어와의 호환을 위해 `NULL` 허용.

### 3.1 새 마이그레이션 파일

`sql/migrations/2026_05_add_pressure.sql` 생성:

```sql
-- Migration: 2026-05-25
-- Adds US633-F1K-T4 differential pressure sensor columns to pm_sensor_data.
ALTER TABLE pm_sensor_data
    ADD COLUMN pressure_pa     SMALLINT          NULL DEFAULT NULL
        COMMENT 'US633-F1K-T4 차압, signed Pa (±1000)',
    ADD COLUMN pressure_status TINYINT UNSIGNED  NULL DEFAULT NULL
        COMMENT 'US633 status 바이트 (디버깅용)';
```

### 3.2 `sql/schema.sql` 동등 수정

신규 DB 생성 시에도 동일한 컬럼이 생기도록 `CREATE TABLE` 블록의 `cnt_10` 다음에 추가:

```sql
-- US633-F1K-T4 차압센서 (2026-05-25 추가, NULL 허용으로 기존 펌웨어 호환)
pressure_pa     SMALLINT          NULL DEFAULT NULL,  -- signed Pa (±1000)
pressure_status TINYINT UNSIGNED  NULL DEFAULT NULL,  -- US633 status 바이트
```

### 3.3 타입 선택 근거

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `pressure_pa` | `SMALLINT` (signed) | ±1000 Pa 범위가 SMALLINT 범위(-32768..+32767)에 여유 있게 들어감. 펌웨어가 정수 Pa로 변환해 보냄 |
| `pressure_status` | `TINYINT UNSIGNED` | 1바이트 상태 비트맵 (datasheet 7페이지) |

차후 sub-Pa 해상도가 필요하면 `DECIMAL(7,2)` 또는 milli-Pa `INT`로 마이그레이션.

---

## 4. 서버 변경 — `node:net` 위에 HTTP + WebSocket 다중화

### 4.1 의존성 정리 (`package.json`)

- **제거**: `express`, `@types/express`, `ws`, `@types/ws`, `dotenv`
- **유지**: `mysql2`, `typescript`, `tsx`, `ts-node`, `@types/node`

### 4.2 환경설정 파일 제거

- `server/.env` 삭제 (DB 자격증명을 런타임으로 받음)
- `server/config/env.ts` 삭제
- `WS_HOST`/`WS_PORT`는 `process.env.WS_HOST ?? '0.0.0.0'` / `Number(process.env.WS_PORT ?? 3400)` 형태로 직접 사용 (필요 시 셸 export 또는 inline)

### 4.3 모듈 분리 (모두 신규)

| 파일 | 책임 |
|---|---|
| `server/server.ts` | TCP 리스너 + Client 상태머신 (HTTP/WS 분기) |
| `server/httpParser.ts` | HTTP/1.1 요청 라인 + 헤더 + Content-Length 본문 파서 |
| `server/httpResponse.ts` | 상태코드/헤더/본문 → 바이트열 빌더 (JSON 헬퍼) |
| `server/wsFrame.ts` | RFC6455 frame decode/encode (기존 로직 분리) |
| `server/routes.ts` | method+path → 핸들러 디스패치 |
| `server/dbSession.ts` | DbSession 싱글톤 (런타임 자격증명 보유) |
| `server/dbQueries.ts` | insertReading / selectHistory / selectLatest |
| `server/ringBuffer.ts` | DB 미연결 시 임시 보관 FIFO (cap=500) |
| `server/subnet.ts` | /24 동일 서브넷 검증 (dns.lookup 포함) |
| `server/sensorTypes.ts` | PM_FIELDS, SensorPayloadFull, parseSensorPayload |

### 4.4 동작 흐름

1. TCP 'data' 이벤트 → Buffer 누적
2. WebSocket 업그레이드 전: HTTP 헤더 파싱
   - `Upgrade: websocket` → 핸드셰이크 → path 검사 (`/ingest` 또는 `/live`) → `role` 부여
   - 평범한 HTTP → Content-Length만큼 본문 수신 → `routes.dispatch()` → 응답 + `Connection: close`
3. WebSocket 업그레이드 후: `wsFrame.decodeFrames`로 처리
   - `role='ingest'`: JSON 파싱 → `parseSensorPayload` → **/live 구독자에 즉시 broadcast** → DB 연결되어 있으면 INSERT, 아니면 ringBuffer push (INSERT는 await 안 함, 저지연)
   - `role='live'`: `liveSubscribers.add(client)`만 등록, 외부 메시지는 무시

### 4.5 REST 엔드포인트

| Method | Path | 동작 |
|---|---|---|
| GET | `/healthz` | `{ok:true}` |
| GET | `/api/db/status` | `{connected, host, database, connectedAt}` |
| POST | `/api/db/connect` | 서브넷 검증 → mysql2 pool 생성 + ping → 성공 시 ringBuffer drain → `{ok, drained, inserted, status}` |
| POST | `/api/db/disconnect` | pool 종료 |
| GET | `/api/sensor/latest` | 최신 1행 |
| GET | `/api/sensor/history?from=ISO&to=ISO&limit=N` | 시간 범위 조회 (limit 1..50000, 기본 5000) |
| OPTIONS | `*` | CORS preflight |

CORS: 모든 응답에 `Access-Control-Allow-Origin: <req.origin || '*'>` + 표준 헤더 부착. 프로덕션은 동일 origin 권장(아래 6.3 참고).

### 4.6 서브넷 검증 (`subnet.ts`)

- 클라이언트 IP: `socket.remoteAddress`에서 추출, `::ffff:` 접두사 제거 후 IPv4 검증
- DB 호스트가 호스트네임이면 `dns.promises.lookup(host, {family:4})`로 A 레코드 해석
- 두 주소가 모두 IPv4이고 상위 24비트가 같을 때만 통과; 아니면 사유 문자열 반환:
  - `"client 192.168.1.x and DB 192.168.0.x are on different /24 subnets"`
  - `"DNS lookup failed for \"db.invalid\""`
  - `"client IP \"...\" is not IPv4"`

### 4.7 링버퍼 (`ringBuffer.ts`)

- 고정 cap=500. 초과 push는 가장 오래된 항목부터 silent drop.
- `drain()`: 보관분 전체 반환 + 내부 비움.
- DB 연결 성공 즉시 `drain()` 결과를 원래 timestamp로 일괄 INSERT.

### 4.8 `/live` 메시지 엔벨로프

서버 → 대시보드:
```json
{ "type": "sensor", "data": { ...SensorPayloadFull, "recorded_at": "<ISO>" } }
```
향후 확장: `{type:'status'}`, `{type:'error'}` 등 type 필드로 구분.

---

## 5. 웹 대시보드 — `web/` (신규)

### 5.1 스택

Vue 3 + Vite + TypeScript + TailwindCSS v3 + Pinia + vue-router + vue-echarts(ECharts).

- ECharts 채택 이유: dataZoom·brush 기본 지원, 10k+ 포인트도 부드러움, 상용 룩앤필 정착이 빠름.

### 5.2 디렉터리 구조

```
web/
├── package.json, vite.config.ts, tsconfig.json
├── tailwind.config.js, postcss.config.js, index.html
└── src/
    ├── main.ts, App.vue
    ├── assets/tailwind.css
    ├── router/index.ts                # /connect, /dashboard (가드)
    ├── stores/connection.ts           # Pinia: profile, password(메모리), dbStatus
    ├── stores/sensor.ts               # Pinia: latest, history, rawLog
    ├── api/{http,db,sensor}.ts        # fetch 래퍼 + REST 호출
    ├── ws/liveClient.ts               # 자동 재연결 (지수 백오프 1s→30s)
    ├── types/sensor.ts                # 서버 SensorPayloadFull 미러
    ├── views/ConnectView.vue          # HeidiSQL 스타일 세션 폼
    ├── views/DashboardView.vue        # 통계 타일 + 차트들
    └── components/
        ├── StatTile.vue
        ├── TimeSeriesChart.vue        # ECharts 래퍼 (reactive props)
        ├── TimeRangePicker.vue        # 1h / 3h / 24h / 7d
        └── RawFramesLog.vue
```

### 5.3 화면 흐름

- **/connect**: Host, Port(기본 3306), User, Password, Database, WebSocket URL(`location.origin` 기준 자동) 입력. `Test connection` / `Connect & Continue` 버튼. 에러는 서버 응답 사유 그대로 표시. `Remember settings` 체크 시 비밀번호 제외 localStorage 영속.
- **/dashboard**: 라우터 가드가 `/api/db/status`로 연결 확인, 미연결 시 `/connect`로 리다이렉트. 화면 구성:
  - 상태 배너 (DB host/db, Live WS 상태, Disconnect 버튼)
  - 통계 타일: 현재 PM2.5(GRIMM), PM10(GRIMM), 차압(Pa)
  - TimeRangePicker (1h / 3h / 24h / 7d, 기본 3h)
  - 4개 차트: PM(GRIMM), PM(TSI), 입자수, **차압(±1000 Pa)**
  - 접이식 Raw frames 로그 (최근 100개)
- 라이브 업데이트: `/live` WS 도착 → `sensor.pushLive()` → `history.push()` + 차트 자동 리렌더.

### 5.4 Vite 개발 프록시

`vite.config.ts`:
```ts
server: { proxy: {
  '/api':    { target: 'http://localhost:3400', changeOrigin: true },
  '/live':   { target: 'ws://localhost:3400',   ws: true },
  '/ingest': { target: 'ws://localhost:3400',   ws: true },
}}
```

---

## 6. 트레이드오프 / 주의사항

1. **DB 자격증명 메모리 전용**: 서버 재시작 후 첫 대시보드 접속 전까지 ringBuffer(최대 500프레임 ≈ 83분 @10초 주기)만 보관, 초과분은 silent drop.
2. **단일 active DB 세션**: 두 대시보드가 다른 자격증명을 보내면 후자 승. 다중 사용자 운영 시 정책 필요.
3. **/24 서브넷 검증은 LAN 한정의 약한 authz**: 같은 LAN 사용자라면 누구나 DB 자격증명 제출 가능. 외부 노출 시 별도 토큰/세션 필요.
4. **WS path 변경(`/` → `/ingest`)**: 펌웨어와 서버를 같은 정비창에서 동시 교체해야 함. 과도기엔 `/`도 받도록 라우팅 추가 가능.
5. **HTTP 파서 직접 작성의 위험**: chunked transfer, header folding, pipelining 등 엣지 케이스는 모두 거부(400/501). 클라이언트는 대시보드와 `curl`만 가정.
6. **차압 SMALLINT(정수 Pa)**: sub-Pa 해상도 필요 시 컬럼 타입 마이그레이션 필요.
