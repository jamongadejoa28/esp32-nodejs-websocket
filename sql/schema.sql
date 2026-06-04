-- Air quality sensor: JSD-BH-312-002 (Cubic PM2008)
-- MySQL 5.6.30 compatible (no JSON columns)
-- Run once on the NAS MySQL instance after creating the DB.

CREATE TABLE IF NOT EXISTS pm_sensor_data (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recorded_at  DATETIME     NOT NULL,

    -- PM concentration (μg/m³) – GRIMM calibration
    pm1_grimm    INT UNSIGNED NOT NULL DEFAULT 0,
    pm25_grimm   INT UNSIGNED NOT NULL DEFAULT 0,
    pm10_grimm   INT UNSIGNED NOT NULL DEFAULT 0,

    -- PM concentration (μg/m³) – TSI calibration
    pm1_tsi      INT UNSIGNED NOT NULL DEFAULT 0,
    pm25_tsi     INT UNSIGNED NOT NULL DEFAULT 0,
    pm10_tsi     INT UNSIGNED NOT NULL DEFAULT 0,

    -- Particle number concentration (pcs/0.1 L)
    cnt_0p3      INT UNSIGNED NOT NULL DEFAULT 0,   -- particles >0.3 μm
    cnt_0p5      INT UNSIGNED NOT NULL DEFAULT 0,   -- particles >0.5 μm
    cnt_1p0      INT UNSIGNED NOT NULL DEFAULT 0,   -- particles >1.0 μm
    cnt_2p5      INT UNSIGNED NOT NULL DEFAULT 0,   -- particles >2.5 μm
    cnt_5p0      INT UNSIGNED NOT NULL DEFAULT 0,   -- particles >5.0 μm
    cnt_10       INT UNSIGNED NOT NULL DEFAULT 0,   -- particles >10 μm

    -- US633-F1K-T4 차압센서 (2026-05-25 추가, NULL 허용으로 기존 펌웨어 호환)
    pressure_pa     SMALLINT          NULL DEFAULT NULL,  -- signed Pa (±1000)
    pressure_status TINYINT UNSIGNED  NULL DEFAULT NULL,  -- US633 status 바이트

    INDEX idx_recorded_at (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
