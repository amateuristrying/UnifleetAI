const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
    const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await client.connect();

    const sql = `
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
                WHEN geofence_name IN ('Kiluvya to Mbezi  Geofence', 'Dar Geofence') THEN 'L3_ORIGIN_REGION'
                ELSE 'L2_CORRIDOR'
            END as geo_level
        FROM public.geofence_visits
        WHERE in_time_dt >= '2026-01-01' AND in_time_dt <= '2026-03-01'
        AND tracker_name ILIKE '%T 670 DWX%'
    ),
    flagged AS (
        SELECT *, CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session FROM tmp_classified
    ),
    sessioned AS (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) as session_id FROM flagged
    ),
    tmp_merged AS (
        SELECT tracker_id, tracker_name, geofence_name, geo_level, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt, session_id FROM sessioned GROUP BY tracker_id, tracker_name, geofence_name, geo_level, session_id
    ),
    loading_visits AS (
        SELECT tracker_id, tracker_name, geofence_name, in_time_dt, out_time_dt, CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) >= in_time_dt - INTERVAL '24 hours' THEN 0 ELSE 1 END as is_new_session FROM tmp_merged WHERE geo_level = 'L1_LOADING'
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
    SELECT ls.loading_entry, ls.next_loading_entry,
        (SELECT MAX(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_ORIGIN_REGION' AND m.in_time_dt <= ls.loading_entry AND m.in_time_dt >= ls.loading_entry - INTERVAL '7 days') as dar_arrival,
        (SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as dest_exit,
        COALESCE(
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_ASAS_BASE' AND m.in_time_dt > COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)),
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt > COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz))
        ) as next_dar_entry
    FROM tmp_loading_sessions ls
    ORDER BY ls.loading_entry;
    `;
    const res = await client.query(sql);
    console.table(res.rows);
    await client.end();
}
run().catch(console.error);
