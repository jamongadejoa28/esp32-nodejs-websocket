# ESP32-C3 Super Mini 스펙 및 정보

> 출처: [Mischianti - ESP32-C3 Super Mini: high-resolution pinout, datasheet, and specs](https://mischianti.org/esp32-c3-super-mini-high-resolution-pinout-datasheet-and-specs/)
> 작성자: Renzo Mischianti

---

## 📌 보드 개요 (Board Overview)

ESP32-C3 Super Mini는 Espressif의 **ESP32-C3 FN4 SoC** 기반의 초소형 개발 보드입니다.
단일 코어 32비트 RISC-V 프로세서(최대 160MHz), 2.4GHz Wi-Fi(802.11 b/g/n), Bluetooth 5.0 LE를 내장하고 있으며, 저전력 딥슬립 모드(약 43µA, LED 제거 시)를 지원합니다.

크기는 단 **22.5 × 18 mm**이며, 온보드 3.3V 레귤레이터를 탑재해 공간 제약이 있는 IoT 및 배터리 구동 프로젝트에 적합합니다.

### 핵심 사양
- **SoC**: ESP32-C3 FN4, RISC-V 싱글 코어 @ 160 MHz
- **메모리**: SRAM 400 KB, ROM 384 KB, 온보드 Flash 4 MB
- **무선 통신**: Wi-Fi 802.11 b/g/n, Bluetooth 5.0 LE
- **전원**:
  - 입력: USB-C 또는 외부 5V (3.3–6V)
  - 출력: 3.3V 레귤레이티드, 최대 500 mA
- **I/O 전압**: 3.3V
- **딥슬립 전류**: 약 43µA (POW LED 제거 필요)
- **인터페이스**: ADC, PWM, SPI, I²C, UART, GPIO
- **크기**: 22.5 × 18 mm

---

## 🔧 고급 주변장치 인터페이스 (Advanced Peripheral Interfaces)

### 디지털 인터페이스
- **GPIO**: 프로그래머블 GPIO 22개 또는 16개
- **SPI**: 3개
- **UART**: 2개
- **I²C**: 1개
- **I²S**: 1개
- **Remote Control Peripheral**: 송신 2채널, 수신 2채널
- **LED PWM 컨트롤러**: 최대 6채널
- **Full-speed USB Serial/JTAG 컨트롤러**
- **범용 DMA 컨트롤러(GDMA)**: 송신 3채널, 수신 3채널
- **TWAI® 컨트롤러**: ISO 11898-1 호환 (CAN 2.0 사양)

### 아날로그 인터페이스
- **SAR ADC**: 2개 × 12비트, 최대 6채널
- **온도 센서**: 1개

### 타이머
- **54비트 범용 타이머**: 2개
- **디지털 워치독 타이머**: 3개
- **아날로그 워치독 타이머**: 1개
- **52비트 시스템 타이머**: 1개

---

## 📡 Wi-Fi

- IEEE 802.11 b/g/n 준수
- 2.4 GHz 대역에서 20 MHz, 40 MHz 대역폭 지원
- 1T1R 모드, 최대 150 Mbps 데이터 전송률
- 가상 Wi-Fi 인터페이스 4개
- 802.11mc FTM 지원

---

## 📶 Bluetooth

- **Bluetooth LE**: Bluetooth 5, Bluetooth Mesh
- **고출력 모드**: 21 dBm
- **속도**: 125 Kbps, 500 Kbps, 1 Mbps, 2 Mbps
- Advertising Extensions
- 다중 광고 세트(Multiple advertisement sets)
- 채널 선택 알고리즘
- Wi-Fi와 Bluetooth 간 안테나 공유를 위한 내부 공존 메커니즘

---

## 🔐 보안 (Security)

- Secure Boot
- Flash 암호화
- 4096비트 OTP (최대 1792비트 사용자 영역)
- 하드웨어 암호화 가속:
  - AES-128/256 (FIPS PUB 197)
- 권한 제어 (Permission Control)
- SHA 가속기 (FIPS PUB 180-4)
- RSA 가속기
- 난수 생성기 (RNG)
- HMAC
- 디지털 서명

---

## 📊 기술 사양 요약 (Technical Specifications)

| 카테고리 | 상세 |
| --- | --- |
| **마이크로컨트롤러** | ESP32-C3 FN4 (32비트 RISC-V) @ 160 MHz |
| **Flash** | 4 MB 온보드 |
| **SRAM / ROM** | 400 KB / 384 KB |
| **Wi-Fi** | 2.4 GHz 802.11 b/g/n |
| **Bluetooth** | Bluetooth 5.0 LE |
| **ADC** | ADC1 (6채널), 12비트 해상도 |
| **PWM** | 대부분의 GPIO에서 사용 가능 |
| **SPI** | 하드웨어 SPI 1개, 소프트웨어 핀 재매핑 가능 |
| **I²C** | 소프트웨어 I²C 버스 2개, SDA/SCL 할당 가능 |
| **UART** | UART 인터페이스 2개; USB-serial은 CH340 (USB-C) 경유 |
| **전원 레귤레이터** | 3.3V 출력, 최대 500 mA |
| **크기** | 22.5 × 18 mm |
| **딥슬립 전류** | 약 43µA (POW LED 제거 필요) |

---

## 📍 PIN 정보

### UART (Universal Asynchronous Receiver-Transmitter) 핀
- **U0RXD (GPIO20)**: UART0 수신(RX) 핀, 시리얼 데이터 수신용
- **U0TXD (GPIO21)**: UART0 송신(TX) 핀, 시리얼 데이터 송신용

### I²C (Inter-Integrated Circuit) 핀
ESP32-C3는 전용 I²C 핀이 없습니다. 대신 **소프트웨어 기반 I²C(bit-banging)** 방식으로 사용 가능한 GPIO 핀을 활용할 수 있습니다.
- 예시: **GPIO12 (SPIHD)** 와 **GPIO13 (SPIWP)** 를 I²C SCL(클럭), SDA(데이터)로 사용

---

## 📁 다운로드 자료

- **ESP32-C3 데이터시트**: [esp32-c3_datasheet_en.pdf](https://mischianti.org/wp-content/uploads/2023/05/esp32-c3_datasheet_en.pdf)
- **ESP32-C3 SuperMini 회로도(Schematic)**: [esp32-c3-supermini-schematics.pdf](https://mischianti.org/wp-content/uploads/2025/07/esp32-c3-supermini-schematics.pdf)
- **고해상도 Pinout 이미지**: [ESP32-C3-ZERO-Waveshare-pinout-high.jpg](https://mischianti.org/wp-content/uploads/2025/07/ESP32-C3-ZERO-Waveshare-pinout-high.jpg)

---

## 💡 참고사항

- **소형 폼팩터**로 배터리 구동 IoT 프로젝트에 이상적
- **저전력 딥슬립**(~43µA) 활용 시 POW LED를 제거해야 함
- USB-C 포트와 CH340 USB-Serial 칩을 탑재하여 손쉬운 프로그래밍 가능
- RISC-V 아키텍처 기반으로 Arduino IDE, ESP-IDF, MicroPython 등 다양한 개발 환경 지원

---

*본 문서는 Mischianti.org의 공개 자료를 참고하여 정리한 것입니다. 원문 콘텐츠는 CC BY-NC-ND 4.0 라이선스로 보호됩니다.*
