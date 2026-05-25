/* ── DB INSERT/SELECT 헬퍼 ────────────────────────────────────
 * 모든 함수는 db.isReady() 가정. 미연결 시 throw.
 * ───────────────────────────────────────────────────────── */

import type { RowDataPacket } from 'mysql2';
import { db } from './dbSession.js';
import type { SensorPayloadFull } from './sensorTypes.js';

const INSERT_SQL = `INSERT INTO pm_sensor_data
    (recorded_at,
     pm1_grimm, pm25_grimm, pm10_grimm,
     pm1_tsi,   pm25_tsi,   pm10_tsi,
     cnt_0p3,   cnt_0p5,    cnt_1p0,
     cnt_2p5,   cnt_5p0,    cnt_10,
     pressure_pa, pressure_status)
VALUES (?, ?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

const SELECT_COLS = `recorded_at,
    pm1_grimm, pm25_grimm, pm10_grimm,
    pm1_tsi,   pm25_tsi,   pm10_tsi,
    cnt_0p3,   cnt_0p5,    cnt_1p0,
    cnt_2p5,   cnt_5p0,    cnt_10,
    pressure_pa, pressure_status`;

export async function insertReading(p: SensorPayloadFull, recordedAt: Date): Promise<void> {
    const pool = db.getPool();
    if (!pool) throw new Error('DB not connected');
    await pool.execute(INSERT_SQL, [
        recordedAt,
        p.pm1_grimm, p.pm25_grimm, p.pm10_grimm,
        p.pm1_tsi,   p.pm25_tsi,   p.pm10_tsi,
        p.cnt_0p3,   p.cnt_0p5,    p.cnt_1p0,
        p.cnt_2p5,   p.cnt_5p0,    p.cnt_10,
        p.pressure_pa, p.pressure_status,
    ]);
}

export async function selectHistory(from: Date, to: Date, limit: number): Promise<RowDataPacket[]> {
    const pool = db.getPool();
    if (!pool) throw new Error('DB not connected');
    const sql = `SELECT ${SELECT_COLS} FROM pm_sensor_data
        WHERE recorded_at BETWEEN ? AND ?
        ORDER BY recorded_at ASC
        LIMIT ?`;
    // MySQL은 LIMIT에 prepared param을 받지 않는 버전이 있어 number를 문자열로 인라인하지 않고 query() 사용
    const [rows] = await pool.query<RowDataPacket[]>(sql, [from, to, limit]);
    return rows;
}

export async function selectLatest(): Promise<RowDataPacket | null> {
    const pool = db.getPool();
    if (!pool) throw new Error('DB not connected');
    const sql = `SELECT ${SELECT_COLS} FROM pm_sensor_data
        ORDER BY recorded_at DESC LIMIT 1`;
    const [rows] = await pool.query<RowDataPacket[]>(sql);
    return rows.length > 0 ? rows[0] : null;
}
