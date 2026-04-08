WITH loading_visits AS (
    SELECT 
        gv.tracker_id, 
        gv.geofence_name, 
        gv.in_time_dt, 
        gv.out_time_dt,
        CASE 
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)',
                'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT',
                'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                'TANGA GF', 'MTWARA GF', 'BEIRA', 'BEIRA GF',
                'KURASINI ALL TOGETHER', 'MOMBASA GF', 'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL',
                'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                'VIVO ENERGY MOMBASA TERMINAL'
            ) OR gv.geofence_name ILIKE '%KURASINI%' THEN 'L1_TERMINAL'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'DSM GEOFENCE', 'DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'BEIRA GEOFENCE', 'MOMBASA GEOFENCE'
            ) THEN 'L1_ZONE'
            ELSE 'OTHER'
        END as geo_level
    FROM public.geofence_visits gv
    WHERE gv.tracker_id = 3352081
      AND gv.in_time_dt >= '2026-03-01'
      AND gv.in_time_dt < '2026-03-31'
),
potential_anchors AS (
    SELECT * FROM loading_visits WHERE geo_level IN ('L1_TERMINAL', 'L1_ZONE')
),
session_flags AS (
    SELECT
        pa.*,
        CASE
            WHEN LAG(pa.out_time_dt) OVER (ORDER BY pa.in_time_dt) IS NULL THEN 1
            ELSE 0 -- simplified for now
        END as is_new_session
    FROM potential_anchors pa
)
SELECT * FROM session_flags ORDER BY in_time_dt
