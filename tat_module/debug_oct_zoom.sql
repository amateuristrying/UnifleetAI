SELECT gv.geofence_name, gv.in_time_dt, gv.out_time_dt,
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
                'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS KIBAHA DSM -YARD', 'ASAS TABATA'
            ) THEN 'L1_ASAS_BASE'
            WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                'DSM GEOFENCE', 'DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'BEIRA GEOFENCE', 'MOMBASA GEOFENCE'
            ) THEN 'L3_ORIGIN_REGION'
            ELSE 'OTHER'
       END as geo_level
FROM public.geofence_visits gv
WHERE gv.tracker_id = 3352081
  AND gv.in_time_dt >= '2025-10-10'
  AND gv.in_time_dt < '2025-10-25'
ORDER BY gv.in_time_dt ASC
