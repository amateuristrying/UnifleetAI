-- =============================================================
-- DIAGNOSTIC: Most common geofences in trips without destinations
-- =============================================================
-- This query helps identify "missed" destinations by finding 
-- where trucks spend the most time when NO dest is detected.

WITH non_dest_trips AS (
    SELECT 
        tracker_id,
        tracker_name,
        loading_exit,
        COALESCE(next_loading_entry, now()) as next_load,
        loading_terminal
    FROM public.tat_trips_data
    WHERE dest_name IS NULL 
      AND customer_name IS NULL
      AND loading_exit > now() - INTERVAL '6 months'
),
visits_in_window AS (
    SELECT 
        t.tracker_id,
        t.tracker_name,
        gv.geofence_name,
        gv.in_time_dt,
        gv.out_time_dt,
        EXTRACT(EPOCH FROM (gv.out_time_dt - gv.in_time_dt))/3600.0 as dwell_hrs
    FROM non_dest_trips t
    JOIN public.geofence_visits gv ON gv.tracker_id = t.tracker_id
    WHERE gv.in_time_dt >= t.loading_exit
      AND gv.in_time_dt < t.next_load
      -- Exclude common transit/loading geofences to reduce noise
      AND NOT (
          gv.geofence_name ILIKE '%DAR GEOFENCE%' OR
          gv.geofence_name ILIKE '%DSM GEOFENCE%' OR
          gv.geofence_name ILIKE '%KILUVYA%' OR
          gv.geofence_name ILIKE '%KURASINI%' OR
          gv.geofence_name ILIKE '%BORDER%' OR
          gv.geofence_name ILIKE '%CORRIDOR%' OR
          gv.geofence_name ILIKE '%MOMBASA GEOFENCE%' OR
          gv.geofence_name ILIKE '%TANGA GF%' OR
          gv.geofence_name ILIKE '%TIPER%' OR
          gv.geofence_name ILIKE '%ORYX%' OR
          gv.geofence_name ILIKE '%PUMA%' OR
          gv.geofence_name ILIKE '%OILCOM%' OR
          gv.geofence_name ILIKE '%ASAS%DSM%' OR
          gv.geofence_name ILIKE '%TABATA%' OR
          gv.geofence_name ILIKE '%MOROGORO%' OR
          gv.geofence_name ILIKE '%SEGERA%' OR
          gv.geofence_name ILIKE '%MAKAMBAKO%' OR
          gv.geofence_name ILIKE '%MBEYA%' OR
          gv.geofence_name ILIKE '%IRINGA%'
      )
)
SELECT 
    geofence_name,
    COUNT(*) as trip_count,
    ROUND(SUM(dwell_hrs)::numeric, 1) as total_dwell_hrs,
    ROUND(AVG(dwell_hrs)::numeric, 1) as avg_dwell_hrs,
    COUNT(DISTINCT tracker_id) as unique_trackers
FROM visits_in_window
WHERE dwell_hrs > 0.5 -- Only care about stops > 30 mins
GROUP BY geofence_name
ORDER BY total_dwell_hrs DESC
LIMIT 50
