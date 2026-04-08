WITH 
chunk_classified AS (
    SELECT
        id, tracker_id, tracker_name, geofence_name,
        in_time_dt, out_time_dt,
        CASE
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
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
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('TANGA GF', 'MTWARA GF', 'BEIRA', 'BEIRA GF', 'KURASINI ALL TOGETHER', 'MOMBASA GF') THEN 'L1_ZONE'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('ASAS DSM OFFICE / DAR W/SHOP', 'ASAS TABATA') THEN 'L1_ASAS_BASE'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'KILUVYA GEOFENCE', 'KIBAHA GEOFENCE', 'ASAS KIBAHA DSM -YARD', 'TANGA GF', 'MTWARA GF', 'BEIRA GEOFENCE', 'BEIRA GF', 'MOMBASA GF', 'TANGA PARKING') THEN 'L3_ORIGIN_REGION'
            ELSE 'CORRIDOR'
        END as geo_level
    FROM public.geofence_visits
    WHERE tracker_id = 3262846
      AND in_time_dt >= '2025-11-20'
      AND in_time_dt < '2025-12-10'
),
chunk_merged AS (
    SELECT geofence_name, geo_level, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt
    FROM (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY geofence_name ORDER BY in_time_dt) as sid
        FROM (
            SELECT *, CASE WHEN LAG(out_time_dt) OVER (PARTITION BY geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session
            FROM chunk_classified
        ) flagged
    ) x
    GROUP BY geofence_name, geo_level, sid
)
SELECT * FROM chunk_merged ORDER BY in_time_dt
