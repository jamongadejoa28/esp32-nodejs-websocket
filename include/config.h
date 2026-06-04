#include "config_local.h"

#pragma once

// WiFi credentials are stored in NVS (non-volatile flash).
// On first boot (or when stored creds fail) the firmware will
// scan networks and ask you to type SSID / password via the
// serial monitor.  No need to edit this file for WiFi.

// ── API server ────────────────────────────────────────────────
// FastAPI (server/app.py) 실행 PC의 IP로 변경할 것.
// 실행: uvicorn app:app --host 0.0.0.0 --port 8000

// ── Sensor I2C ────────────────────────────────────────────────
// GPIO8 = SDA, GPIO9 = SCL
// CTL pin of JSD-BH-312-002 MUST be wired to GND (I2C mode)
#define I2C_SDA     8
#define I2C_SCL     9
#define SENSOR_ADDR 0x28

// ── US633-F1K-T4 differential pressure (same I2C bus) ────────
// Sensor pins 10/11 (SDA/SCL) wired to ESP32 GPIO8/9.
// 7-bit slave address; Wire library shifts to 0x98 (write) / 0x99 (read).
#define PRESSURE_ADDR        0x4C
#define PRESSURE_CMD_FORCE   0xAA    // Force Mode trigger (1 byte)
#define PRESSURE_WAIT_MS     12      // datasheet: ADC conversion > 10 ms
#define PRESSURE_FRAME_SIZE  4       // [status, p_hi, p_mid, p_lo]

// ── Timing ────────────────────────────────────────────────────
#define READ_INTERVAL_MS  10000UL       // unsinged long
#define WIFI_TIMEOUT_MS   20000UL

// ── NVS namespace for WiFi credential storage ─────────────────
#define NVS_NS "wifi"
