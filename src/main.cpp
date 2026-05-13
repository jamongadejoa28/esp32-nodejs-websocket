#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
// #include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"

static WebSocketsClient ws;
static bool wsconnectd = false;

// ── Logging ───────────────────────────────────────────────────────────────────
// Format: [  12345][TAG] message
#define LOG(tag, fmt, ...) Serial.printf("[%7lu][" tag "] " fmt "\n", millis(), ##__VA_ARGS__)

// ── JSD-BH-312-002 / PM2008 I2C protocol constants ───────────────────────────
#define FRAME_SIZE   32
#define FRAME_HEADER 0x16

// "Setup continuous measurement" command [P1..P7]
// P7 = 0x16^0x07^0x03^0xFF^0xFF^0x00 = 0x12
static const uint8_t CMD_START_CONT[] = {0x16, 0x07, 0x03, 0xFF, 0xFF, 0x00, 0x12};

#define STATUS_CLOSE    0x01
#define STATUS_TESTING  0x02
#define STATUS_ALARM    0x07
#define STATUS_STABLE   0x80

struct SensorData {
    uint8_t  status;
    uint16_t pm1_grimm, pm25_grimm, pm10_grimm;
    uint16_t pm1_tsi,   pm25_tsi,   pm10_tsi;
    uint16_t cnt_0p3, cnt_0p5, cnt_1p0;
    uint16_t cnt_2p5, cnt_5p0, cnt_10;
};

// ── WiFi / NVS ────────────────────────────────────────────────────────────────
static Preferences prefs;

static bool loadCreds(String &ssid, String &pass) {
    prefs.begin(NVS_NS, true);
    ssid = prefs.getString("ssid", "");
    pass = prefs.getString("pass", "");
    prefs.end();
    return ssid.length() > 0;
}

static void saveCreds(const String &ssid, const String &pass) {
    prefs.begin(NVS_NS, false);
    prefs.putString("ssid", ssid);
    prefs.putString("pass", pass);
    prefs.end();
    LOG("WIFI", "Credentials saved to NVS");
}

static bool tryConnect(const String &ssid, const String &pass) {
    WiFi.begin(ssid.c_str(), pass.c_str());
    unsigned long t = millis();
    Serial.printf("[%7lu][WIFI] Connecting to '%s'", millis(), ssid.c_str());
    while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT_MS) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
        LOG("WIFI", "Connected — IP: %s", WiFi.localIP().toString().c_str());
        return true;
    }
    LOG("WIFI", "Connection timed out");
    WiFi.disconnect();
    return false;
}

static void scanNetworks() {
    LOG("WIFI", "Scanning for networks...");
    int n = WiFi.scanNetworks();
    if (n <= 0) {
        LOG("WIFI", "No networks found");
        return;
    }
    Serial.printf("[  WIFI] Found %d network(s):\n", n);
    for (int i = 0; i < n; i++) {
        Serial.printf("         %2d. %-32s  %4d dBm  %s\n",
            i + 1,
            WiFi.SSID(i).c_str(),
            WiFi.RSSI(i),
            WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "Open" : "Encrypted");
    }
    WiFi.scanDelete();
}

// Waits for serial input and returns trimmed string.
// Timeout: 120 seconds. Password not echoed for security.
static String readSerial(const char *prompt, bool echo = true) {
    Serial.print(prompt);
    Serial.flush();
    Serial.setTimeout(120000);
    String s = Serial.readStringUntil('\n');
    s.trim();
    if (echo) {
        Serial.println(s);
    } else {
        Serial.println("********");
    }
    Serial.setTimeout(1000);
    return s;
}

static void provisionWiFi() {
    Serial.println();
    Serial.println("============================================================");
    Serial.println("  WiFi Setup");
    Serial.println("  - Make sure [No line ending] or [Newline] is selected");
    Serial.println("    in the serial monitor line-ending option.");
    Serial.println("============================================================");
    scanNetworks();

    String ssid = readSerial("\n>>> SSID     : ");
    String pass = readSerial(">>> Password : ", false);

    LOG("WIFI", "Attempting connection with entered credentials...");
    if (tryConnect(ssid, pass)) {
        saveCreds(ssid, pass);
        Serial.println("============================================================");
    } else {
        LOG("WIFI", "Provisioning failed — will retry stored creds on next boot");
    }
}

static void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    String ssid, pass;
    if (loadCreds(ssid, pass)) {
        LOG("WIFI", "Trying stored credentials for '%s'", ssid.c_str());
        if (tryConnect(ssid, pass)) return;
        LOG("WIFI", "Stored credentials failed — starting provisioning");
        WiFi.disconnect(true);
        delay(100);
    } else {
        LOG("WIFI", "No stored credentials — starting provisioning");
    }
    provisionWiFi();
}

// Called from loop() — silent reconnect only, no re-provisioning.
static void ensureWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    String ssid, pass;
    if (!loadCreds(ssid, pass)) return;
    LOG("WIFI", "Connection lost — reconnecting to '%s'", ssid.c_str());
    tryConnect(ssid, pass);
}

// ── Sensor ───────────────────────────────────────────────────────────────────
static bool sendCommand(const uint8_t *cmd, size_t len) {
    Wire.beginTransmission(SENSOR_ADDR);
    Wire.write(cmd, len);
    return Wire.endTransmission() == 0;
}

static bool readSensor(SensorData &d) {
    uint8_t buf[FRAME_SIZE] = {0};

    uint8_t got = Wire.requestFrom((uint8_t)SENSOR_ADDR, (uint8_t)FRAME_SIZE);
    if (got < FRAME_SIZE) {
        LOG("SENSOR", "Short read: %u/%u bytes", got, FRAME_SIZE);
        return false;
    }
    for (int i = 0; i < FRAME_SIZE; i++) buf[i] = Wire.read();

    if (buf[0] != FRAME_HEADER) {
        LOG("SENSOR", "Header mismatch: 0x%02X (expected 0x%02X)", buf[0], FRAME_HEADER);
        return false;
    }

    uint8_t xcs = 0;
    for (int i = 0; i < FRAME_SIZE - 1; i++) xcs ^= buf[i];
    if (xcs != buf[31]) {
        LOG("SENSOR", "Checksum error: calc=0x%02X recv=0x%02X", xcs, buf[31]);
        return false;
    }

    d.status     = buf[2];
    d.pm1_grimm  = ((uint16_t)buf[7]  << 8) | buf[8];
    d.pm25_grimm = ((uint16_t)buf[9]  << 8) | buf[10];
    d.pm10_grimm = ((uint16_t)buf[11] << 8) | buf[12];
    d.pm1_tsi    = ((uint16_t)buf[13] << 8) | buf[14];
    d.pm25_tsi   = ((uint16_t)buf[15] << 8) | buf[16];
    d.pm10_tsi   = ((uint16_t)buf[17] << 8) | buf[18];
    d.cnt_0p3    = ((uint16_t)buf[19] << 8) | buf[20];
    d.cnt_0p5    = ((uint16_t)buf[21] << 8) | buf[22];
    d.cnt_1p0    = ((uint16_t)buf[23] << 8) | buf[24];
    d.cnt_2p5    = ((uint16_t)buf[25] << 8) | buf[26];
    d.cnt_5p0    = ((uint16_t)buf[27] << 8) | buf[28];
    d.cnt_10     = ((uint16_t)buf[29] << 8) | buf[30];
    return true;
}

// ── HTTP POST ─────────────────────────────────────────────────────────────────
static bool postData(const SensorData &d) {
    // ensureWiFi();
    // if (WiFi.status() != WL_CONNECTED) {
    //     LOG("HTTP", "No WiFi — skipping POST");
    //     return false;
    // }

    if (!wsconnectd) {
        LOG("WS", "Not connected - skip");
        return false;
    }

    JsonDocument doc;
    doc["pm1_grimm"]  = d.pm1_grimm;
    doc["pm25_grimm"] = d.pm25_grimm;
    doc["pm10_grimm"] = d.pm10_grimm;
    doc["pm1_tsi"]    = d.pm1_tsi;
    doc["pm25_tsi"]   = d.pm25_tsi;
    doc["pm10_tsi"]   = d.pm10_tsi;
    doc["cnt_0p3"]    = d.cnt_0p3;
    doc["cnt_0p5"]    = d.cnt_0p5;
    doc["cnt_1p0"]    = d.cnt_1p0;
    doc["cnt_2p5"]    = d.cnt_2p5;
    doc["cnt_5p0"]    = d.cnt_5p0;
    doc["cnt_10"]     = d.cnt_10;

    String body;
    serializeJson(doc, body);
    ws.sendTXT(body);
    LOG("WS", "Sent: %s", body.c_str());
    return true;
}

//     HTTPClient http;
//     http.begin(API_URL);
//     http.addHeader("Content-Type", "application/json");
//     http.setTimeout(5000);
//     LOG("HTTP", "POST → %s", API_URL);
//     int code = http.POST(body);
//     String resp = http.getString();
//     http.end();

//     if (code == 200) {
//         LOG("HTTP", "OK (200) — %s", resp.c_str());
//         return true;
//     }
//     LOG("HTTP", "Failed: HTTP %d — %s", code, resp.c_str());
//     return false;
// }

void wsEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            LOG("WS", "Disconnected");
            wsconnectd = false;
            break;
        case WStype_CONNECTED:
            LOG("WS", "Connected to server");
            wsconnectd = true;
            break;
        case WStype_TEXT:
            LOG("WS", "Received: %.*s", (int)length, payload);
            break;
        case WStype_BIN:
            LOG("WS", "Received binary data (%u bytes)", (unsigned)length);
            break;
        default:
            LOG("WS", "Event: %d", type);
    }
}

// ── Arduino ───────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(1500);
    Serial.println();
    Serial.println("============================================================");
    Serial.println("  Air Quality Monitor — JSD-BH-312-002 / ESP32-C3");
    Serial.println("============================================================");

    Wire.begin(I2C_SDA, I2C_SCL);
    Wire.setClock(100000);
    LOG("SENSOR", "I2C init  SDA=GPIO%d  SCL=GPIO%d  addr=0x%02X", I2C_SDA, I2C_SCL, SENSOR_ADDR);

    if (sendCommand(CMD_START_CONT, sizeof(CMD_START_CONT))) {
        LOG("SENSOR", "Continuous mode command sent OK");
    } else {
        LOG("SENSOR", "Command FAILED — check CTL pin (must be GND) and wiring");
    }

    connectWiFi();
    ws.begin(WS_HOST, WS_PORT, "/");
    ws.onEvent(wsEvent);
    ws.setReconnectInterval(5000);

    LOG("SYS", "Setup complete — sampling every %lu s", READ_INTERVAL_MS / 1000UL);
    Serial.println("============================================================");
    Serial.println();
}

void loop() {
    ws.loop();
    static unsigned long lastRead = 0;
    if (millis() - lastRead < READ_INTERVAL_MS) return;
    lastRead = millis();

    SensorData data;
    if (!readSensor(data)) return;

    const char *statusStr =
        data.status == STATUS_STABLE  ? "STABLE"  :
        data.status == STATUS_TESTING ? "TESTING" :
        data.status == STATUS_ALARM   ? "ALARM"   :
        data.status == STATUS_CLOSE   ? "CLOSE"   : "UNKNOWN";

    LOG("SENSOR", "0x%02X %-7s | GRIMM PM1=%3u PM2.5=%3u PM10=%3u µg/m³",
        data.status, statusStr,
        data.pm1_grimm, data.pm25_grimm, data.pm10_grimm);

    if (data.status == STATUS_CLOSE || data.status == STATUS_ALARM) {
        LOG("SENSOR", "Sensor not ready (0x%02X) — upload skipped", data.status);
        return;
    }

    postData(data);
}
