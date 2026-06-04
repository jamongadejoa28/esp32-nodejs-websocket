-- Migration: 2026-05-25
-- Adds US633-F1K-T4 differential pressure sensor columns to pm_sensor_data.
-- Run once on the NAS MySQL instance.

ALTER TABLE pm_sensor_data
    ADD COLUMN pressure_pa     SMALLINT          NULL DEFAULT NULL
        COMMENT 'US633-F1K-T4 차압, signed Pa (±1000)',
    ADD COLUMN pressure_status TINYINT UNSIGNED  NULL DEFAULT NULL
        COMMENT 'US633 status 바이트 (디버깅용)';
