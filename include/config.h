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

// ── Timing ────────────────────────────────────────────────────
#define READ_INTERVAL_MS  10000UL
#define WIFI_TIMEOUT_MS   20000UL

// ── NVS namespace for WiFi credential storage ─────────────────
#define NVS_NS "wifi"
