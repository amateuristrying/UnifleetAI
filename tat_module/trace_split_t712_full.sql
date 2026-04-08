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
                'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL',
                'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                'VIVO ENERGY MOMBASA TERMINAL'
            ) THEN 'L1_TERMINAL'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN ('TANGA GF', 'MTWARA GF', 'BEIRA', 'BEIRA GF', 'KURASINI ALL TOGETHER', 'MOMBASA GF') THEN 'L1_ZONE'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') = 'DRC OFFLOADING GEO' THEN 'L1_DRC_REGION'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'LUSAKA DEPOT', 'NDOLA OFFLOADING', 'MZUZU OFFLOADING', 'LILONGWE',
                'JINJA GF', 'KAMPALA GF', 'BUJUMBURA GF', 'KIGALI GF',
                'BLANTYRE', 'BLANTYRE OFFLOADING'
            ) THEN 'L1_OFFLOADING'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'ISAKA LPG DEPOT', 'DODOMA LPG DEPOT', 'ORYX DODOMA LPG DEPOT',
                'MWANZA LPG DEPOT', 'MOSHI LPG DEPOT', 'IRINGA LPG DEPOT',
                'MBEYA LPG DEPOT'
            ) THEN 'L1_LPG_DEPOT'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'ASAS HEAD OFFICE IPOGOLO YARD -IRINGA'
            ) THEN 'L1_LOCAL_DELIVERY'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN ('ASAS DSM OFFICE / DAR W/SHOP', 'ASAS KIBAHA DSM -YARD', 'ASAS TABATA') THEN 'L1_ASAS_BASE'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'DSM GEOFENCE', 'DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'BEIRA GEOFENCE', 'MOMBASA GEOFENCE'
            ) THEN 'L3_ORIGIN_REGION'
            ELSE 'OTHER'
        END as geo_level
    FROM public.geofence_visits gv
    WHERE gv.tracker_id = 3352081
      AND gv.in_time_dt >= '2025-10-10'
      AND gv.in_time_dt < '2025-11-25'
),
merged_visits AS (
    SELECT tracker_id, geofence_name, geo_level, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt
    FROM (
        SELECT *, SUM(is_new) OVER (PARTITION BY geofence_name ORDER BY in_time_dt) as sid
        FROM (
            SELECT *, CASE WHEN LAG(out_time_dt) OVER (PARTITION BY geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new
            FROM loading_visits
        ) x
    ) y
    GROUP BY tracker_id, geofence_name, geo_level, sid
),
anchors AS (
    -- REPLICATE REAL SELECTION: PRIMARY + FALLBACK ORIGIN REGION
    SELECT mv.* 
    FROM merged_visits mv
    WHERE geo_level IN ('L1_TERMINAL', 'L1_ZONE', 'L1_ASAS_BASE')
       OR (geo_level = 'L3_ORIGIN_REGION' AND EXISTS (
            SELECT 1 FROM merged_visits mv2 
            WHERE mv2.in_time_dt > mv.in_time_dt 
              AND mv2.geo_level NOT IN ('L1_TERMINAL', 'L1_ZONE', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE')
            ORDER BY mv2.in_time_dt ASC LIMIT 1
       ))
)
SELECT 
    curr.geofence_name, 
    curr.in_time_dt,
    (SELECT MAX(prev.in_time_dt) FROM anchors prev WHERE prev.in_time_dt < curr.in_time_dt) as prev_anchor_time,
    (SELECT m.geofence_name || ' (' || m.geo_level || ')'
     FROM merged_visits m
     WHERE m.in_time_dt > (SELECT MAX(prev.in_time_dt) FROM anchors prev WHERE prev.in_time_dt < curr.in_time_dt)
       AND m.in_time_dt < curr.in_time_dt
       AND (
          (curr.geo_level = 'L3_ORIGIN_REGION' AND 
             m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_CUSTOMER', 'L1_LOCAL_DELIVERY', 'L1_LPG_DEPOT', 'L1_ASAS_BASE')
          )
          OR (curr.geo_level != 'L3_ORIGIN_REGION' AND (
             m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_CUSTOMER', 'L1_LOCAL_DELIVERY', 'L1_LPG_DEPOT', 'L1_ASAS_BASE', 'L3_ORIGIN_REGION')
          ))
       )
     ORDER BY m.in_time_dt ASC LIMIT 1
    ) as splitter_cause,
    curr.geo_level
FROM anchors curr
ORDER BY curr.in_time_dt ASC
