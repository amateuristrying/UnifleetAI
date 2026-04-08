import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: '.env.local' });
const connString = process.env.SUPABASE_DB_URL;

async function run() {
    const client = new Client({ connectionString: connString });
    await client.connect();

    const sql = `
    SELECT 
        tracker_id,
        geofence_name,
        geo_level,
        in_time_dt,
        out_time_dt,
        session_id
    FROM (
        WITH tmp_classified AS (
            SELECT
                id, tracker_id, tracker_name, geofence_name,
                in_time_dt, out_time_dt,
                CASE
                    WHEN geofence_name IN ('TIPER DEPOT', 'Puma Depo Kurasini', 'Oryx Loading Depo (Kigamboni)', 'Oryx Dar Depo', 'Oilcom Dar Depo', 'OILCOM LIMITED TERMINAL DEPOT', 'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT', 'Tanga GF', 'Mtwara GF', 'Beira', 'KURASINI ALL TOGETHER') THEN 'L1_LOADING'
                    WHEN geofence_name = 'DRC Offloading GEO' THEN 'L1_DRC_REGION'
                    WHEN geofence_name IN ('LUSAKA DEPOT', 'Ndola Offloading', 'Mzuzu Offloading', 'Lilongwe') THEN 'L1_OFFLOADING'
                    WHEN geofence_name IN ('ISAKA LPG Depot', 'Dodoma LPG Depot', 'ORYX DODOMA LPG DEPOT', 'Mwanza LPG Depot', 'Moshi LPG Depot', 'Iringa LPG Depot', 'Asas Head Office Ipogolo  Yard -Iringa') THEN 'L1_LOCAL_DELIVERY'
                    WHEN geofence_name IN ('ASAS DSM Office / Dar W/Shop', 'Asas Kibaha Dsm -Yard', 'Asas Tabata') THEN 'L1_ASAS_BASE'
                    ELSE 'L2_CORRIDOR'
                END as geo_level
            FROM public.geofence_visits
            WHERE in_time_dt >= '2026-01-01' AND in_time_dt <= '2026-03-01'
        ),
        flagged AS (
            SELECT *,
                CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session
            FROM tmp_classified
        ),
        sessioned AS (
            SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) as session_id
            FROM flagged
        )
        SELECT 
            tracker_id, tracker_name, geofence_name, geo_level,
            MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt, session_id
        FROM sessioned
        WHERE tracker_name ILIKE '%T 670 DWX%'
        GROUP BY tracker_id, tracker_name, geofence_name, geo_level, session_id
    ) m
    ORDER BY in_time_dt;
    `;
    const res = await client.query(sql);
    console.table(res.rows);
    await client.end();
}
run().catch(console.error);
