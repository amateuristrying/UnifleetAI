SELECT geofence_name,
       CASE 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'DSM GEOFENCE', 'DAR GEOFENCE', 'MOMBASA GEOFENCE'
            ) THEN 'L1_ZONE'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS DSM OFFICE', 'ASAS TABATA'
            ) THEN 'L1_ASAS_BASE'
            ELSE 'OTHER'
        END as suspected_level
FROM (SELECT 'ASAS DSM Office / Dar W/Shop' as geofence_name) x;
