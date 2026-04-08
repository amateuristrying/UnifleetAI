const { Client } = require('pg');

async function testQuery() {
    const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        console.log("🔍 Running full CTE string_agg resolution...");
        const res = await client.query(`
            WITH _chunk_classified AS (
                SELECT
                    id, tracker_id, tracker_name, geofence_name,
                    in_time_dt, out_time_dt,
                    CASE
                        WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\\s+', ' ', 'g') IN (
                            'TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)',
                            'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT',
                            'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                            'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                            'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                            'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL',
                            'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                            'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                            'VIVO ENERGY MOMBASA TERMINAL'
                        ) THEN 'L1_TERMINAL'
                        WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\\s+', ' ', 'g') IN ('TANGA GF', 'MTWARA GF', 'BEIRA', 'BEIRA GF', 'KURASINI ALL TOGETHER', 'MOMBASA GF') THEN 'L1_ZONE'
                        WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'TANGA GF', 'MTWARA GF', 'BEIRA GEOFENCE', 'BEIRA GF', 'MOMBASA GF', 'TANGA PARKING') THEN 'L3_ORIGIN_REGION'
                        ELSE 'OTHER'
                    END as geo_level
                FROM geofence_visits
                WHERE tracker_id = 3226123 AND in_time_dt >= '2026-02-01' AND in_time_dt < '2026-03-01'
            ),
            filtered_events AS (
                SELECT * FROM _chunk_classified c
                WHERE NOT EXISTS (
                    SELECT 1 FROM _chunk_classified c2
                    WHERE c2.tracker_id = c.tracker_id
                      AND c2.in_time_dt <= c.out_time_dt AND c2.out_time_dt >= c.in_time_dt
                      AND c2.geofence_name != c.geofence_name
                      AND (
                          (c.geo_level IN ('L1_ZONE', 'L3_ORIGIN_REGION') AND c2.geo_level IN ('L1_TERMINAL', 'L1_ASAS_BASE'))
                          OR (c.geo_level = 'L2_CORRIDOR' AND c2.geo_level != 'L2_CORRIDOR')
                      )
                )
            ),
            grouped_events AS (
                SELECT *, SUM(is_new_grp) OVER(PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) as grp
                FROM (SELECT *, CASE WHEN (in_time_dt - LAG(out_time_dt) OVER(PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt)) > INTERVAL '12 hours' THEN 1 ELSE 0 END as is_new_grp FROM filtered_events) sub
            ),
            merged_events AS (
                SELECT tracker_id, tracker_name, geofence_name, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt, geo_level
                FROM grouped_events GROUP BY tracker_id, tracker_name, geofence_name, geo_level, grp
            ),
            session_flags AS (
                SELECT m1.*, 0 as is_new_session FROM merged_events m1
            ),
            sessions AS (
                SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as session_id FROM session_flags
            ),
            session_stats AS (
                SELECT
                    tracker_id, session_id,
                    COALESCE(
                        (SELECT string_agg(DISTINCT sub.geofence_name, ' / ' ORDER BY sub.geofence_name)
                         FROM sessions sub 
                         WHERE sub.tracker_id = sessions.tracker_id AND sub.session_id = sessions.session_id
                           AND sub.geo_level = (
                               SELECT s2.geo_level 
                               FROM sessions s2 
                               WHERE s2.tracker_id = sessions.tracker_id AND s2.session_id = sessions.session_id 
                                 AND s2.geo_level IN ('L1_TERMINAL', 'L1_ASAS_BASE', 'L1_ZONE')
                               ORDER BY CASE 
                                    WHEN s2.geo_level = 'L1_TERMINAL' THEN 3 
                                    WHEN s2.geo_level = 'L1_ASAS_BASE' THEN 2 
                                    WHEN s2.geo_level = 'L1_ZONE' THEN 1 
                                    ELSE 0 END DESC
                               LIMIT 1
                           ))
                    ) as loading_terminal
                FROM sessions
                GROUP BY tracker_id, session_id
            )
            SELECT session_id, loading_terminal FROM session_stats WHERE session_id = 0;
        `);

        console.table(res.rows);

    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await client.end();
    }
}
testQuery();
