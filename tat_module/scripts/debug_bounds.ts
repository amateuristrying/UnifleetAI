import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: '.env.local' });
const connString = process.env.SUPABASE_DB_URL;

async function run() {
    const client = new Client({ connectionString: connString });
    await client.connect();

    const sql = `
    WITH tmp_classified AS (
        SELECT id, tracker_id, tracker_name, geofence_name, in_time_dt, out_time_dt,
        CASE
            WHEN geofence_name IN ('TIPER DEPOT', 'Tanga GF', 'KURASINI ALL TOGETHER') THEN 'L1_LOADING'
            WHEN geofence_name IN ('LUSAKA DEPOT') THEN 'L1_OFFLOADING'
            WHEN geofence_name IN ('Asas Head Office Ipogolo  Yard -Iringa', 'Asas Head Office Ipogolo Yard -Iringa') THEN 'L1_LOCAL_DELIVERY'
            WHEN geofence_name IN ('Asas Tabata') THEN 'L1_ASAS_BASE'
            ELSE 'L2_CORRIDOR'
        END as geo_level
        FROM geofence_visits
        WHERE in_time_dt >= '2026-01-01' AND in_time_dt <= '2026-03-01'
    ),
    flagged AS (
        SELECT *, CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session FROM tmp_classified
    ),
    sessioned AS (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) as session_id FROM flagged
    ),
    tmp_merged AS (
        SELECT tracker_id, tracker_name, geofence_name, geo_level, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt FROM sessioned GROUP BY tracker_id, tracker_name, geofence_name, geo_level, session_id
    ),
    loading_visits AS (
        SELECT tracker_id, tracker_name, geofence_name, in_time_dt, out_time_dt,
            CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) >= in_time_dt - INTERVAL '24 hours' THEN 0 ELSE 1 END as is_new_session FROM tmp_merged WHERE geo_level = 'L1_LOADING'
    ),
    sessions AS (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as session_id FROM loading_visits
    ),
    tmp_loading_sessions AS (
        SELECT tracker_id, tracker_name, session_id,
        MIN(in_time_dt) as loading_entry, MAX(out_time_dt) as loading_exit,
        LEAD(MIN(in_time_dt)) OVER (PARTITION BY tracker_id ORDER BY MIN(in_time_dt)) as next_loading_entry
        FROM sessions GROUP BY tracker_id, tracker_name, session_id
    )
    SELECT ls.tracker_name, ls.loading_entry, ls.next_loading_entry,
        (SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as dest_exit,
        (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_LOADING', 'L1_ASAS_BASE') AND m.in_time_dt > COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours') AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as next_dar_entry
    FROM tmp_loading_sessions ls
    WHERE ls.tracker_name ILIKE '%T 670 DWX%';
    `;
    const res = await client.query(sql);
    console.table(res.rows);
    await client.end();
}
run().catch(console.error);
