from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
import pymysql
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

app = FastAPI()


class Reading(BaseModel):
    pm1_grimm:  int
    pm25_grimm: int
    pm10_grimm: int
    pm1_tsi:    int
    pm25_tsi:   int
    pm10_tsi:   int
    cnt_0p3:    int
    cnt_0p5:    int
    cnt_1p0:    int
    cnt_2p5:    int
    cnt_5p0:    int
    cnt_10:     int


@app.post("/")
def ingest(r: Reading):
    try:
        conn = pymysql.connect(
            host=os.environ["DB_HOST"],
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASS"],
            database=os.environ["DB_NAME"],
            port=int(os.environ.get("DB_PORT", "3306")),
        )
        now_kst = datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d %H:%M:%S')
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO pm_sensor_data "
                "(recorded_at, pm1_grimm, pm25_grimm, pm10_grimm, "
                " pm1_tsi, pm25_tsi, pm10_tsi, "
                " cnt_0p3, cnt_0p5, cnt_1p0, cnt_2p5, cnt_5p0, cnt_10) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (now_kst,
                 r.pm1_grimm, r.pm25_grimm, r.pm10_grimm,
                 r.pm1_tsi,   r.pm25_tsi,   r.pm10_tsi,
                 r.cnt_0p3,   r.cnt_0p5,    r.cnt_1p0,
                 r.cnt_2p5,   r.cnt_5p0,    r.cnt_10),
            )
        conn.commit()
        conn.close()
        return {"status": "ok", "rows": 1}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
