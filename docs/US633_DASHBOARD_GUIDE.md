# US633 차압센서 + Vue 대시보드 — 사용 가이드

본 가이드는 [US633_DASHBOARD_CHANGES.md](./US633_DASHBOARD_CHANGES.md)의 변경 사항이 적용된 시스템의 설치·운영·트러블슈팅 절차를 다룹니다.

---

## 1. 하드웨어 결선

### 1.1 핀맵

| 신호 | ESP32-C3 SuperMini | JSD-BH-312-002 (PM) | US633-F1K-T4 (차압) |
|---|---|---|---|
| 3.3V | 3V3 | – | 7 (VDD) |
| 5V   | 5V  | VCC | – |
| GND  | GND | GND, CTL | 6 (VSS) |
| SDA  | GPIO 8 | SDA | 10 (SDA) |
| SCL  | GPIO 9 | SCL | 11 (SCL) |

- PM 센서는 5V, 차압 센서는 3.0V(허용 1.68~3.6V)로 전원이 다릅니다. 둘을 같은 5V에 묶지 마세요.
- US633은 **SDA/SCL에 4.7~10 kΩ 풀업** 필요. PM2008 모듈이 이미 풀업을 내장하고 있으면 별도 부착 불필요(테스터로 확인).
- PM 센서 CTL핀은 반드시 GND. UART 모드로 빠지면 동작 안 함.

### 1.2 I2C 주소

| 장치 | 7-bit 주소 |
|---|---|
| JSD-BH-312-002 (PM) | `0x28` |
| US633-F1K-T4 (차압) | `0x4C` |

같은 버스에 충돌 없이 공존합니다.

---

## 2. DB 스키마 적용

NAS의 MySQL/MariaDB에 마이그레이션 한 번 실행:

```bash
mysql -h 192.168.0.250 -u <user> -p <database> < sql/migrations/2026_05_add_pressure.sql
```

또는 신규 DB라면 `sql/schema.sql` 전체를 실행하면 `pressure_pa` / `pressure_status` 컬럼이 같이 만들어집니다.

확인:
```sql
DESCRIBE pm_sensor_data;
-- pressure_pa     smallint(6)         YES   NULL
-- pressure_status tinyint(3) unsigned YES   NULL
```

---

## 3. 펌웨어 빌드 / 업로드

### 3.1 `include/config_local.h` 작성 (gitignored)

```c
#pragma once
#define WS_HOST "192.168.0.126"   // Node 서버 실행 PC IP
#define WS_PORT 3400
```

### 3.2 PlatformIO 빌드

```bash
pio run -e smini-esp32c3
pio run -e smini-esp32c3 -t upload
pio device monitor -b 115200
```

### 3.3 시리얼 출력 예시

```
[  10500][SENSOR] 0x80 STABLE  | GRIMM PM1=  3 PM2.5=  6 PM10=  8 µg/m³
[  10515][PRES] raw_status=0x40 pa=-23
[  10519][WS] Sent: {"pm1_grimm":3,"pm25_grimm":6,...,"pressure_pa":-23,"pressure_status":64}
```

차압 입력구에 입김 → 양수/음수로 ±수백 Pa 범위로 변동하면 정상.

### 3.4 WS 경로 변경 주의

펌웨어가 `/ingest`에 접속하므로, 서버를 새 버전으로 동시에 교체해야 합니다. 과도기에 호환이 필요하면 서버 `handleWsHandshake`에서 `path === '/'` 도 ingress로 받도록 한 줄 추가하세요.

---

## 4. 서버 실행

### 4.1 의존성 설치

```bash
cd /home/hajun/dev_ws/esp32-nodejs-websocket
npm install     # mysql2, tsx, typescript만 설치됨
```

### 4.2 환경 변수 (선택)

`.env` 없이 동작합니다. 기본값(0.0.0.0:3400)을 바꾸려면 셸 환경변수로:

```bash
WS_HOST=0.0.0.0 WS_PORT=3400 npm run dev
```

### 4.3 기동

```bash
npm run dev
# → server listening on 0.0.0.0:3400
#     HTTP REST   → /api/db/{connect,status,disconnect}, /api/sensor/{latest,history}, /healthz
#     WebSocket   → /ingest (ESP32), /live (dashboard)
#     DB session  → not connected (will be provisioned by first dashboard)
```

서버는 DB 자격증명을 모르는 상태로 부팅합니다. ESP32 프레임이 도착해도 ringBuffer(cap=500)에 보관만 됩니다. 대시보드가 처음 `POST /api/db/connect`를 호출하면 그제서야 풀이 생성되고 보관분이 일괄 INSERT됩니다.

### 4.4 REST 직접 점검

```bash
curl -s http://localhost:3400/healthz
# {"ok":true}

curl -s http://localhost:3400/api/db/status
# {"connected":false,"host":null,"database":null,"connectedAt":null}

curl -s -X POST http://localhost:3400/api/db/connect \
     -H 'content-type: application/json' \
     -d '{"host":"192.168.0.250","port":3306,"user":"hajun","password":"...","database":"hajun_db"}'
# {"ok":true,"drained":7,"inserted":7,"status":{"connected":true,...}}
```

다른 서브넷의 호스트로 시도하면 403:
```json
{"error":"client 192.168.1.x and DB 192.168.0.x are on different /24 subnets"}
```

---

## 5. 대시보드 실행

### 5.1 의존성 설치 (최초 1회)

```bash
cd web
npm install
```

### 5.2 개발 모드

```bash
npm run dev
# Vite dev server: http://localhost:5173
```

브라우저에서 `http://localhost:5173` → ConnectView 화면.

### 5.3 접속 절차 (HeidiSQL 스타일)

1. **Host**: `192.168.0.250` (NAS DB IP)
2. **Port**: `3306`
3. **User / Password / Database**: 본인 자격증명
4. **WebSocket URL**: 자동 채워짐 (예: `ws://localhost:5173/live` — Vite proxy가 :3400으로 전달)
5. **Remember settings** 체크 (비밀번호는 저장 안 됨)
6. `Connect & Continue` → DashboardView로 이동

### 5.4 대시보드 구성

- **상태 배너**: DB host/db, Live WS 연결 상태
- **통계 타일**: 현재 PM2.5, PM10, 차압
- **TimeRangePicker**: 1h / 3h / 24h / 7d (기본 3h)
- **차트 4개**: PM(GRIMM), PM(TSI), 입자수, 차압(±1000 Pa)
- **Raw frames 로그**: 최근 100개 프레임 텍스트 표시 (접이식)

### 5.5 프로덕션 빌드

```bash
cd web
npm run build
# → web/dist/
```

`web/dist`를 정적 호스팅하거나, 서버 `routes.ts`에 `GET /` 핸들러 추가하여 같은 origin으로 서빙 가능합니다(서브넷 검증의 클라이언트 IP가 의도대로 잡힘).

---

## 6. 트러블슈팅

### 6.1 `connect ECONNREFUSED`

- DB 호스트/포트 오타 → 입력 다시 확인
- NAS MySQL이 외부 접속 차단 → bind-address 0.0.0.0 확인, 사용자 grant `'user'@'192.168.0.%'` 확인

### 6.2 `403 client X.Y.Z.x and DB A.B.C.x are on different /24 subnets`

- 의도된 거부. 같은 LAN의 PC에서 접속하거나, DB가 정말 다른 서브넷이면 검증을 풀어야 함 (`server/subnet.ts`의 prefix24 비교를 `/16`으로 완화).

### 6.3 서버 재시작 후 데이터 빈 구간

- 서버가 죽어있던 시간 동안의 데이터는 ringBuffer(최대 500개, 약 83분 @10초 주기)까지만 보관됩니다. 그 이전 데이터는 silent drop.

### 6.4 차압 값이 항상 0 또는 ±1428

- `0` 부근: 정상 (대기압 차이 거의 없음)
- `±1428` 부근(센서 클리핑): 입력 압력이 ±1000 Pa를 크게 초과한 경우. 입력 호스 확인.
- 시리얼에 `[PRES] Force-mode write failed`: 풀업 부재 또는 결선 문제.

### 6.5 Vite 빌드 시 ECharts 청크 경고

```
(!) Some chunks are larger than 500 kB after minification.
```

ECharts 자체가 큰 라이브러리라 정상. 무시해도 무방. 코드 스플리팅을 적용하려면 `vite.config.ts`에 `manualChunks: { echarts: ['echarts','vue-echarts'] }` 추가.

### 6.6 WSL2 / 미러링 모드

- 서버는 `0.0.0.0:3400`에 bind. Windows portproxy 불필요 (이미 [WS_SERVER_GUIDE.md](./WS_SERVER_GUIDE.md) 트러블슈팅 참고).
- 방화벽이 3400을 막을 수 있음 → Windows Defender Firewall 인바운드 규칙 추가.

---

## 7. 데이터 흐름 요약

```
ESP32 ──/ingest──► Node 서버 ──┬── liveBroadcast ──► 대시보드 (/live WS)
                                │
                                └── INSERT (또는 ringBuffer push)
                                          │
                                          ▼
                                       MySQL (NAS)
                                          ▲
                                          │
                  대시보드 ──/api/sensor/history──► 서버 ── SELECT
```

- **저지연 보장**: ingress → broadcast는 동기, DB INSERT는 await하지 않고 비동기 (실패해도 ringBuffer로 fallback).
- **단일 origin 정합성**: 프로덕션에서 같은 도메인으로 서빙하면 CORS 불필요 + 서브넷 검증이 의도대로 동작.
