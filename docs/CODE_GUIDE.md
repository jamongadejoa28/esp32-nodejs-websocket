# Air Quality Monitor — 코드 구조 및 작성 가이드

이 프로젝트의 코드가 어떤 구조로 작성되었는지, 어떤 문법과 라이브러리를 사용했는지 설명합니다.

---

## 1. 프로젝트 파일 구조

```
esp32-c3-dev-test/
├── include/
│   └── config.h          # 펌웨어 상수 정의 (IP, GPIO 번호 등)
├── src/
│   └── main.cpp          # ESP32 펌웨어 (Arduino C++)
├── server/
│   ├── app.py            # Python FastAPI 서버
│   ├── .env              # DB 접속 정보 (git 제외)
│   └── requirements.txt  # Python 패키지 목록
├── grafana/
│   └── dashboard.json    # Grafana 대시보드 설정
├── sql/
│   └── schema.sql        # MySQL 테이블 생성 스크립트
└── docs/
    ├── SETUP_GUIDE.md    # 설치 가이드
    └── CODE_GUIDE.md     # 이 문서
```

---

## 2. ESP32 펌웨어 (C++ / Arduino)

### 2-1. 빌드 환경

**PlatformIO** + **Arduino 프레임워크**를 사용합니다. `platformio.ini`에 타겟 보드와 라이브러리 의존성을 선언합니다.

```ini
[env:esp32-c3-devkitm-1]
platform = espressif32
board = esp32-c3-devkitm-1
framework = arduino
lib_deps =
    bblanchon/ArduinoJson
```

### 2-2. config.h — 상수 정의

`#define`으로 컴파일 타임 상수를 정의합니다. 헤더 파일에 넣어 `main.cpp`에서 `#include "config.h"`로 불러씁니다.

```cpp
#pragma once          // 이 헤더가 중복 포함되지 않도록 보호

#define API_URL        "http://192.168.0.102:8000/"
#define I2C_SDA        8
#define I2C_SCL        9
#define SENSOR_ADDR    0x28       // 16진수 상수
#define READ_INTERVAL_MS  10000UL // UL = unsigned long 리터럴
#define WIFI_TIMEOUT_MS   20000UL
#define NVS_NS         "wifi"     // NVS 네임스페이스 이름
```

`#pragma once` vs `#ifndef` guard: 둘 다 중복 include 방지용이지만 `#pragma once`가 더 간결합니다.

### 2-3. LOG 매크로

```cpp
#define LOG(tag, fmt, ...) \
    Serial.printf("[%7lu][" tag "] " fmt "\n", millis(), ##__VA_ARGS__)
```

- `##__VA_ARGS__`: 가변 인자 (`...`)를 `printf` 형식으로 전달. `##`는 인자가 없을 때 앞의 쉼표를 제거하는 GCC 확장.
- `%7lu`: 7자리 unsigned long (밀리초 타임스탬프).
- `tag`는 문자열 리터럴이므로 `"[" tag "]"` 형태로 컴파일 타임에 이어붙여짐.

사용 예:
```cpp
LOG("WIFI", "Connected — IP: %s", WiFi.localIP().toString().c_str());
// 출력: [   8200][WIFI] Connected — IP: 192.168.0.42
```

### 2-4. struct — 센서 데이터 묶음

```cpp
struct SensorData {
    uint8_t  status;                          // 1바이트 부호없는 정수
    uint16_t pm1_grimm, pm25_grimm, pm10_grimm; // 2바이트 부호없는 정수
    uint16_t pm1_tsi,   pm25_tsi,   pm10_tsi;
    uint16_t cnt_0p3, cnt_0p5, cnt_1p0;
    uint16_t cnt_2p5, cnt_5p0, cnt_10;
};
```

`uint8_t`, `uint16_t`는 `<stdint.h>` 타입으로 플랫폼 무관하게 크기가 고정됩니다.

### 2-5. NVS (Non-Volatile Storage) — WiFi 자격증명 저장

ESP32의 플래시 메모리에 키-값 데이터를 저장하는 `Preferences` 라이브러리를 사용합니다. 전원이 꺼져도 유지됩니다.

```cpp
#include <Preferences.h>
static Preferences prefs;

// 읽기 (두 번째 인자 true = 읽기 전용 모드)
prefs.begin("wifi", true);
String ssid = prefs.getString("ssid", "");  // 없으면 "" 반환
prefs.end();

// 쓰기 (두 번째 인자 false = 읽쓰기 모드)
prefs.begin("wifi", false);
prefs.putString("ssid", ssid);
prefs.end();
```

### 2-6. WiFi 연결 흐름

```
setup()
  └── connectWiFi()
        ├── loadCreds() → 저장된 SSID/PW 있으면 → tryConnect()
        │     성공 → return
        │     실패 → provisionWiFi()
        └── 없으면 → provisionWiFi()
              ├── scanNetworks()  → WiFi.scanNetworks() 결과 출력
              ├── readSerial()    → Serial.readStringUntil('\n') 로 입력 대기
              └── tryConnect()    → 성공 시 saveCreds() 로 NVS 저장

loop()
  └── ensureWiFi() → 연결 끊겼으면 저장된 정보로 재연결 (프로비저닝 없음)
```

`static` 함수: 파일 스코프로 제한합니다. 다른 .cpp 파일에서 호출되지 않을 함수는 `static`으로 선언하는 것이 좋습니다.

### 2-7. I2C 센서 통신

```cpp
#include <Wire.h>

Wire.begin(I2C_SDA, I2C_SCL);   // SDA=GPIO8, SCL=GPIO9
Wire.setClock(100000);           // 100 kHz

// 명령 전송
Wire.beginTransmission(0x28);    // 슬레이브 주소
Wire.write(cmd, len);
Wire.endTransmission();          // 0이면 성공

// 데이터 수신
uint8_t got = Wire.requestFrom((uint8_t)0x28, (uint8_t)32);
for (int i = 0; i < 32; i++) buf[i] = Wire.read();
```

**32바이트 프레임 파싱:**

```cpp
// 빅엔디언 2바이트 → uint16_t
d.pm1_grimm = ((uint16_t)buf[7] << 8) | buf[8];
//             ↑ MSB를 8비트 왼쪽 시프트    ↑ LSB
```

**XOR 체크섬 검증:**

```cpp
uint8_t xcs = 0;
for (int i = 0; i < 31; i++) xcs ^= buf[i];  // P1~P31 XOR
if (xcs != buf[31]) { /* 체크섬 오류 */ }
```

### 2-8. HTTP POST (ArduinoJson + HTTPClient)

```cpp
#include <ArduinoJson.h>
#include <HTTPClient.h>

JsonDocument doc;             // 동적 JSON 문서
doc["pm1_grimm"] = d.pm1_grimm;
// ... (나머지 필드)

String body;
serializeJson(doc, body);     // JSON 직렬화 → String

HTTPClient http;
http.begin(API_URL);          // URL 설정
http.addHeader("Content-Type", "application/json");
http.setTimeout(5000);        // 5초 타임아웃
int code = http.POST(body);   // POST 전송, HTTP 상태코드 반환
String resp = http.getString(); // 응답 본문
http.end();
```

### 2-9. loop() 주기 제어

`delay()` 대신 타임스탬프 비교를 사용합니다. `delay()`는 그 시간 동안 CPU가 완전히 멈추지만, 아래 방식은 다른 작업을 끼워넣을 수 있습니다.

```cpp
void loop() {
    static unsigned long lastRead = 0;   // static: 함수 호출 사이에도 값 유지
    if (millis() - lastRead < READ_INTERVAL_MS) return;
    lastRead = millis();
    // 실제 작업 ...
}
```

---

## 3. Python API 서버 (FastAPI)

### 3-1. 패키지 구성

```
fastapi       — HTTP 프레임워크
uvicorn       — ASGI 서버 (FastAPI 실행 담당)
pydantic      — 데이터 검증 (FastAPI 내장)
pymysql       — Python → MySQL 드라이버
python-dotenv — .env 파일 로드
```

### 3-2. .env 파일 및 환경변수

민감한 접속 정보는 소스 코드에 직접 쓰지 않고 `.env` 파일에 분리합니다.

```ini
# server/.env
DB_HOST=192.168.0.250
DB_USER=hajun
DB_PASS=hajun3778
DB_NAME=hajun_db
DB_PORT=3306
```

```python
from dotenv import load_dotenv
import os

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

host = os.environ["DB_HOST"]        # 없으면 KeyError 발생 (의도적)
port = int(os.environ.get("DB_PORT", "3306"))  # 없으면 기본값 사용
```

### 3-3. Pydantic 모델 — 요청 검증

```python
from pydantic import BaseModel

class Reading(BaseModel):
    pm1_grimm:  int
    pm25_grimm: int
    # ... 나머지 필드
```

FastAPI는 POST body를 이 모델로 자동 파싱합니다. 타입이 맞지 않으면 422 Unprocessable Entity를 자동으로 반환합니다. 별도 검증 코드를 쓸 필요가 없습니다.

### 3-4. 라우터 데코레이터

```python
app = FastAPI()

@app.post("/")          # POST / 요청을 이 함수가 처리
def ingest(r: Reading): # r: FastAPI가 body를 Reading 모델로 변환해서 넘김
    ...
```

### 3-5. KST 타임존 처리

```python
from datetime import datetime, timezone, timedelta

KST_OFFSET = timezone(timedelta(hours=9))
now_kst = datetime.now(KST_OFFSET).strftime('%Y-%m-%d %H:%M:%S')
```

- `timezone(timedelta(hours=9))`: UTC+9 오프셋 객체 생성.
- `datetime.now(tz)`: 해당 타임존 기준 현재 시각.
- `strftime('%Y-%m-%d %H:%M:%S')`: MySQL DATETIME 형식 문자열로 변환.

> **왜 KST로 저장하는가?**  
> MySQL 5.6은 named timezone(`Asia/Seoul`)을 지원하지 않습니다.  
> Grafana의 MySQL Go 드라이버는 DATETIME을 무조건 UTC로 읽습니다.  
> 따라서 DB에 KST를 저장하고, SQL 쿼리에서 `CONVERT_TZ(recorded_at, '+09:00', '+00:00')`로  
> Grafana에 UTC로 내보내면 타임존이 일치합니다.

### 3-6. pymysql — DB 삽입

```python
import pymysql

conn = pymysql.connect(host=..., user=..., password=..., database=..., port=...)

with conn.cursor() as cur:
    cur.execute(
        "INSERT INTO pm_sensor_data (recorded_at, pm1_grimm, ...) VALUES (%s, %s, ...)",
        (now_kst, r.pm1_grimm, ...)   # 튜플로 파라미터 바인딩 (SQL 인젝션 방지)
    )

conn.commit()   # 트랜잭션 확정
conn.close()
```

`%s` 플레이스홀더에 파라미터를 바인딩하면 pymysql이 이스케이프 처리를 자동으로 합니다. 문자열 포맷팅(f-string 등)으로 SQL을 만들면 SQL 인젝션 취약점이 생기므로 사용하지 않습니다.

---

## 4. Grafana 대시보드 JSON

### 4-1. JSON 구조 개요

```json
{
  "__inputs": [...],    // 임포트 시 사용자가 매핑할 데이터소스 선언
  "__requires": [...],  // 필요한 Grafana 버전, 플러그인 목록
  "title": "...",
  "uid": "...",
  "panels": [...]       // 패널 배열
}
```

### 4-2. 패널 타입

| type | 설명 |
|------|------|
| `timeseries` | 시계열 꺾은선 그래프 |
| `stat` | 단일 수치 표시 (현재값, 경과시간 등) |

### 4-3. rawSql 쿼리

Grafana MySQL 플러그인은 `time`이라는 이름의 컬럼을 타임스탬프로 인식합니다.

```json
{
  "rawSql": "SELECT CONVERT_TZ(recorded_at, '+09:00', '+00:00') AS time, pm1_grimm AS 'PM1.0' FROM pm_sensor_data WHERE $__timeFilter(recorded_at) ORDER BY recorded_at ASC",
  "format": "time_series"
}
```

**`$__timeFilter(recorded_at)`**: Grafana 매크로입니다. 대시보드의 현재 시간 범위를 SQL WHERE 조건으로 자동 변환합니다.
```sql
-- 예시 변환 결과
recorded_at BETWEEN FROM_UNIXTIME(1776448771) AND FROM_UNIXTIME(1776450571)
```
`FROM_UNIXTIME`은 MySQL 서버 타임존(KST)으로 변환하므로 KST로 저장된 `recorded_at`과 올바르게 비교됩니다.

**`CONVERT_TZ(recorded_at, '+09:00', '+00:00')`**: DB의 KST 시간을 UTC로 변환합니다. Grafana의 MySQL Go 드라이버가 DATETIME을 무조건 UTC로 해석하기 때문에, 미리 UTC로 변환해서 넘겨야 화면에 올바른 시간이 표시됩니다.

### 4-4. stat 패널 — 경계값 색상

```json
"thresholds": {
  "mode": "absolute",
  "steps": [
    { "value": null, "color": "green"  },  // 0 이상
    { "value": 35,   "color": "yellow" },  // 35 이상
    { "value": 75,   "color": "orange" },  // 75 이상
    { "value": 150,  "color": "red"    }   // 150 이상
  ]
}
```

### 4-5. 최근 데이터 수신 패널 (dateTimeFromNow)

```json
"fieldConfig": { "defaults": { "unit": "dateTimeFromNow" } }
```

`value`로 Unix 타임스탬프(밀리초)를 넘기면 Grafana가 "3 minutes ago" 형태로 자동 변환합니다.

```sql
SELECT CONVERT_TZ(recorded_at, '+09:00', '+00:00') AS time,
       UNIX_TIMESTAMP(recorded_at)*1000 AS value
FROM pm_sensor_data ORDER BY recorded_at DESC LIMIT 1
```

`UNIX_TIMESTAMP(recorded_at)`: MySQL 서버가 KST이므로 KST DATETIME → UTC Unix 타임스탬프로 올바르게 변환됩니다.

---

## 5. 트러블슈팅 이력

| 문제 | 원인 | 해결 |
|------|------|------|
| 센서 상태가 계속 `0x02 TESTING` | `0x02`가 연속 측정 중의 정상 상태. `0x80`은 거의 나타나지 않음 | `0x01`, `0x07`일 때만 업로드 스킵하도록 조건 수정 |
| ESP32에서 WSL2 IP로 POST 실패 | WSL2는 LAN과 다른 가상 NIC 사용. LAN에서 WSL2 내부 IP 직접 접근 불가 | Windows `netsh portproxy`로 LAN IP → WSL2 IP 포워딩 |
| Grafana `Error 1298: Unknown timezone 'Asia/Seoul'` | MySQL 5.6 timezone 테이블 미설치 | 데이터소스 Session timezone 비워두기 |
| Grafana 시간대가 9시간 틀림 | Grafana MySQL Go 드라이버가 DATETIME을 무조건 UTC로 읽음 | DB에 KST 저장 + SQL에서 `CONVERT_TZ`로 UTC 변환 후 출력 |
| 최근 데이터 수신이 "9 hours ago" | `UNIX_TIMESTAMP`는 서버 타임존(KST) 기준으로 변환함. KST 저장값을 그대로 쓰면 정상 | `UNIX_TIMESTAMP(recorded_at)*1000` 으로 수정 (9시간 빼는 연산 제거) |
