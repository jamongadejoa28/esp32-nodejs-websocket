# Air Quality Monitor — 설치 가이드

ESP32-C3 SuperMini + JSD-BH-312-002 → MySQL(NAS) → Grafana 파이프라인 설치 절차입니다.

---

## 1. 하드웨어 연결

| 센서 핀 | ESP32-C3 |
|---------|----------|
| VCC     | 5V       |
| GND     | GND      |
| SDA     | GPIO 8   |
| SCL     | GPIO 9   |
| CTL     | GND (중요: GND로 연결해야 I2C 모드) |

- SDA / SCL 라인에 4.7 kΩ 풀업 저항(to 3.3V)을 달아주세요.  
  ESP32 내부 풀업만으로는 불안정할 수 있습니다.
- 센서는 5V 전원이 필요합니다. ESP32의 3.3V 핀은 사용하지 마세요.

---

## 2. 펌웨어 빌드 및 업로드

### 2-1. config.h 수정

`include/config.h` 에서 API URL만 수정합니다.  
**PC의 IP**를 사용합니다 (NAS IP가 아님).

```bash
hostname -I   # PC IP 확인 (첫 번째 주소 사용)
```

```c
#define API_URL "http://192.168.0.YYY:8000/"
//                         ↑ PC의 실제 IP, NAS IP(192.168.0.250)가 아님
```

WiFi 정보는 소스 코드에 없습니다. 첫 부팅 시 시리얼 모니터에서 입력합니다.

### 2-2. 빌드 & 업로드

```bash
cd esp32-c3-dev-test

# 빌드만
pio run

# 업로드
pio run -t upload

# 시리얼 모니터 (Ctrl+C 로 종료)
pio device monitor
```

### 2-3. 첫 부팅 — WiFi 설정

저장된 WiFi 정보가 없으면 자동으로 설정 모드로 진입합니다.

```
============================================================
  Air Quality Monitor — JSD-BH-312-002 / ESP32-C3
============================================================
[    100][WIFI] No stored credentials — starting provisioning
[  WIFI] Found 3 network(s):
          1. MyHomeNetwork                    -45 dBm  Encrypted
          2. ...

>>> SSID     : MyHomeNetwork
>>> Password : ********
[   3200][WIFI] Connecting to 'MyHomeNetwork'........
[   7800][WIFI] Connected — IP: 192.168.0.42
[   7810][WIFI] Credentials saved to NVS
```

> **시리얼 모니터 설정**: `pio device monitor` 실행 후 입력이 안 보이면  
> `pio device monitor --filter=direct` 옵션을 추가하세요.

이후 재부팅 시에는 저장된 정보로 자동 연결됩니다.

### 2-4. WiFi 정보 초기화 (재설정 필요 시)

```bash
pio run -t erase   # 전체 플래시 초기화 후 다시 업로드
```

또는 NVS만 지우려면:

```cpp
// 임시로 setup() 맨 앞에 추가 후 업로드, 그 다음 삭제
Preferences p; p.begin("wifi"); p.clear(); p.end();
```

---

## 3. MySQL 테이블 생성

NAS MySQL에 접속해서 `sql/schema.sql` 내용을 실행합니다.

**방법 A — phpMyAdmin (NAS 웹 UI)**

1. phpMyAdmin 접속 → 대상 DB 선택 → SQL 탭
2. `sql/schema.sql` 내용 붙여넣기 → 실행

**방법 B — SSH CLI**

```bash
mysql -u hajun -p hajun_db < sql/schema.sql
```

**생성되는 테이블**

```
pm_sensor_data
  id           INT UNSIGNED AUTO_INCREMENT PK
  recorded_at  DATETIME   (인덱스 있음)
  pm1_grimm    INT UNSIGNED   (μg/m³ GRIMM 보정)
  pm25_grimm   INT UNSIGNED
  pm10_grimm   INT UNSIGNED
  pm1_tsi      INT UNSIGNED   (μg/m³ TSI 보정)
  pm25_tsi     INT UNSIGNED
  pm10_tsi     INT UNSIGNED
  cnt_0p3 ~ cnt_10  INT UNSIGNED  (입자 수, pcs/0.1L)
```

---

## 4. Python API 서버 실행 (PC)

ESP32에서 받은 데이터를 NAS MySQL에 넣어주는 중간 서버입니다.  
PC에서 실행하며, NAS MySQL(192.168.0.250:3306)에 원격 접속합니다.

### 4-1. 가상환경 및 패키지 (최초 1회)

```bash
cd esp32-c3-dev-test/server
uv venv grafana
source grafana/bin/activate
uv pip install -r requirements.txt
```

### 4-2. 서버 실행

```bash
cd esp32-c3-dev-test/server
source grafana/bin/activate
uvicorn app:app --host 0.0.0.0 --port 8000
```

정상 기동 시:
```
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### 4-3. 동작 테스트

별도 터미널에서 curl로 확인합니다.

```bash
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{"pm1_grimm":5,"pm25_grimm":10,"pm10_grimm":12,
       "pm1_tsi":4,"pm25_tsi":9,"pm10_tsi":11,
       "cnt_0p3":1200,"cnt_0p5":800,"cnt_1p0":300,
       "cnt_2p5":50,"cnt_5p0":10,"cnt_10":2}'
# 응답: {"status":"ok","rows":1}
```

### 4-4. MySQL 원격 접속 허용 (오류 시)

NAS MySQL이 외부 접속을 막고 있으면 아래 쿼리를 NAS phpMyAdmin에서 실행합니다.

```sql
GRANT ALL ON hajun_db.* TO 'hajun'@'%' IDENTIFIED BY 'hajun3778';
FLUSH PRIVILEGES;
```

---

## 5. Grafana 설정

Grafana는 NAS MySQL에 직접 접속합니다. Python API 서버와 무관합니다.

### 5-1. MySQL 데이터 소스 추가

1. Grafana 좌측 메뉴 → **Connections → Data sources → Add new data source**
2. 검색창에 **MySQL** 입력 후 선택
3. 아래 항목 입력:

| 항목 | 입력값 |
|------|--------|
| Name | `MySQL (NAS)` (임의) |
| Host URL | `192.168.0.250:3306` |
| Database name | `hajun_db` |
| Username | `hajun` |
| Password | (NAS MySQL 비밀번호) |
| Session timezone | **(비워두기)** |

4. 하단 **Save & test** 클릭 → **"Database Connection OK"** 초록 메시지 확인

> **Session timezone은 반드시 비워두세요.**  
> `Asia/Seoul`을 입력하면 MySQL 5.6 timezone 테이블 미설치로 Error 1298이 발생합니다.  
> 타임존은 SQL 쿼리 내 `CONVERT_TZ`로 처리합니다 (5-5 참고).

> 연결 오류가 나면 4-4번 MySQL 원격 접속 허용 쿼리를 먼저 실행하세요.

### 5-2. 대시보드 Import

1. 좌측 메뉴 (4번 격자 아이콘) → **Dashboards → New → Import**
2. **Upload dashboard JSON file** 클릭
3. 프로젝트의 `grafana/dashboard.json` 파일 선택
4. **MySQL (NAS)** 드롭다운에서 5-1에서 추가한 데이터 소스 선택
5. **Import** 클릭

### 5-3. 대시보드 패널 구성

| 패널 | 위치 | 내용 |
|------|------|------|
| PM 농도 (GRIMM) | 좌상단 | PM1.0 / PM2.5 / PM10 시계열, GRIMM 보정 μg/m³ |
| PM 농도 (TSI)   | 우상단 | PM1.0 / PM2.5 / PM10 시계열, TSI 보정 μg/m³ |
| 입자 수          | 중단 전체 | 0.3~10μm 6개 크기별 입자 수 시계열 (pcs/0.1L) |
| 현재 PM2.5      | 하단 Stat | 녹색(양호)<35 / 노랑<75 / 주황<150 / 빨강 |
| 현재 PM10       | 하단 Stat | 녹색(양호)<80 / 노랑<150 / 주황<300 / 빨강 |
| 현재 PM1.0      | 하단 Stat | 최신 수치 표시 |
| 최근 수신        | 하단 Stat | 마지막 데이터 수신 후 경과 시간 |

기본 시간 범위: 최근 3시간 / 30초 자동 새로고침

### 5-4. 데이터가 안 보일 때

- 우상단 시간 범위를 **Last 1 hour** 또는 **Last 15 minutes**으로 줄여보세요.
- 패널 클릭 → **Edit** → **Query Inspector** → SQL 실행 결과 확인

### 5-5. 타임존 구조 (중요)

이 프로젝트는 다음 구조로 타임존 문제를 해결합니다.

```
[ESP32] → POST → [Python 서버] → INSERT KST 시간 → [MySQL DB]
                                                        ↓
                                    CONVERT_TZ(recorded_at, '+09:00', '+00:00')
                                                        ↓
                                    [Grafana] UTC 타임스탬프로 표시 → browser timezone(KST) 변환
```

**핵심 규칙:**

| 구성 요소 | 설정 | 이유 |
|----------|------|------|
| `app.py` | `datetime.now(timezone(timedelta(hours=9)))` | KST로 저장 |
| DB `recorded_at` 컬럼 | KST 시간 (예: 18:49) | 그대로 읽으면 사람이 알아볼 수 있는 KST |
| Grafana 데이터소스 Session timezone | 비워두기 | MySQL 5.6 named timezone 미지원 |
| Grafana 대시보드 timezone | `browser` | 브라우저(KST) 기준으로 표시 |
| SQL `time` 컬럼 | `CONVERT_TZ(recorded_at, '+09:00', '+00:00')` | Grafana Go 드라이버가 DATETIME을 UTC로 읽기 때문에 미리 UTC로 변환해서 넘김 |

**대시보드 재임포트가 필요한 경우**  
(대시보드 JSON 수정 후 적용하려면)

1. Grafana → Dashboards → 기존 "Air Quality" 대시보드 삭제
2. New → Import → `grafana/dashboard.json` 업로드
3. MySQL (NAS) 선택 → Import

**기존 데이터 초기화 (타임존 변경 후)**

```sql
TRUNCATE TABLE pm_sensor_data;
```

이후 `uvicorn` 재시작하면 새 데이터가 KST로 쌓입니다.

---

## 6. 시리얼 모니터 로그 해석

```
[    100][SENSOR] I2C init  SDA=GPIO8  SCL=GPIO9  addr=0x28
[    120][SENSOR] Continuous mode command sent OK
[   8200][WIFI]   Connected — IP: 192.168.0.42
[  10000][SENSOR] 0x80 STABLE  | GRIMM PM1=  5 PM2.5= 10 PM10= 12 µg/m³
[  10001][HTTP]   POST → http://192.168.0.YYY:8000/
[  10240][HTTP]   OK (200) — {"status":"ok","rows":1}
```

| 태그 | 의미 |
|------|------|
| `[SENSOR]` | I2C 센서 통신 |
| `[WIFI]`   | WiFi 상태 |
| `[HTTP]`   | API POST 결과 |
| `[SYS]`    | 시스템 이벤트 |

**자주 보이는 오류**

| 메시지 | 원인 | 조치 |
|--------|------|------|
| `Command FAILED` | CTL 핀이 GND 미연결 | CTL → GND 확인 |
| `Short read: 0/32` | I2C 연결 불량 | SDA/SCL 배선, 풀업 저항 확인 |
| `Header mismatch` | 센서 응답 불량 | 전원(5V) 확인 |
| `HTTP Failed: -1` | API URL 오류 또는 NAS 미응답 | `API_URL` 확인, NAS 웹서버 상태 확인 |

---

## 7. 센서 프로토콜 메모

- **I2C 주소**: 0x28
- **CTL 핀**: GND = I2C 모드, HIGH = UART 모드
- **상태 코드**:
  - `0x01` (CLOSE): 대기 중 → 업로드 스킵
  - `0x02` (TESTING): **연속 측정 중 — 정상 동작 상태, DB 저장함**
  - `0x07` (ALARM): 알람 → 업로드 스킵
  - `0x80` (STABLE): 안정화 완료 → DB 저장함
  - 실제로 `0x80`은 거의 나타나지 않고 `0x02`가 지속됨. `0x02`도 유효한 데이터임.
- **응답 프레임**: 32바이트, 헤더=0x16, 체크섬=P1~P31 XOR
- **측정 주기**: 연속 모드 시 약 1초 간격으로 갱신

---

## 8. WSL2 네트워킹 (Windows에서 실행 시)

WSL2는 Windows LAN과 별도 가상 네트워크를 사용합니다.  
ESP32(LAN 192.168.0.x)에서 WSL2 내부 IP로는 직접 접속이 불가합니다.

**Windows 포트 포워딩 설정 (관리자 PowerShell에서 1회 실행)**

```powershell
# WSL2 IP 확인
wsl hostname -I

# 포트 포워딩 추가 (WSL_IP를 위에서 확인한 IP로 교체)
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=<WSL_IP>

# 방화벽 허용
netsh advfirewall firewall add rule name="uvicorn 8000" dir=in action=allow protocol=TCP localport=8000

# 설정 확인
netsh interface portproxy show all
```

이후 `config.h`의 `API_URL`을 Windows LAN IP(예: `192.168.0.102:8000`)로 설정합니다.

> WSL2를 재시작하면 내부 IP가 바뀝니다. IP가 바뀌었을 때는 portproxy를 삭제하고 재등록해야 합니다.
>
> ```powershell
> netsh interface portproxy delete v4tov4 listenport=8000 listenaddress=0.0.0.0
> ```
