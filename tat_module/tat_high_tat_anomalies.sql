-- =============================================================
-- TAT ANOMALY FINDER: HIGH-TAT & NO-DESTINATION DIAGNOSTICS
-- Purpose: Filters for suspicious trips where TAT is unusually high (e.g. > 25 days)
-- or where the trip finished without a destination (missed geofence).
-- Ignores recent "genuine" starts to minimize noise.
-- =============================================================

WITH base_data AS (
    SELECT 
        tracker_name || ' (' || tracker_id || ')' as vehicle,
        loading_entry,
        loading_exit,
        loading_terminal,
        dest_name,
        dest_entry,
        dest_exit,
        next_dar_entry,
        next_loading_entry,
        dar_arrival,
        loading_start,
        loading_end,
        
        -- CALCULATE TAT
        CASE 
            WHEN (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) 
                THEN EXTRACT(EPOCH FROM (COALESCE(next_dar_entry, next_loading_entry) - COALESCE(dar_arrival, loading_start)))/3600.0
            WHEN dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (dest_exit - COALESCE(dar_arrival, loading_start)))/3600.0
            WHEN dest_entry IS NOT NULL THEN EXTRACT(EPOCH FROM (dest_entry - COALESCE(dar_arrival, loading_start)))/3600.0
            ELSE EXTRACT(EPOCH FROM (NOW() - COALESCE(dar_arrival, loading_start)))/3600.0
        END as calculated_tat_hrs
    FROM public.tat_trips_view
),
trip_audit AS (
    SELECT 
        *,
        -- STATUS MAPPING
        CASE 
            WHEN dest_name IS NOT NULL AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) 
                THEN 'COMPLETED'
            WHEN dest_name IS NULL AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL OR dar_arrival >= loading_end) 
                THEN 'DELIVERED (NO DEST)'
            WHEN dest_exit IS NOT NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL 
                THEN 'RETURNING'
            WHEN dest_entry IS NOT NULL AND dest_exit IS NULL 
                THEN 'AT DESTINATION'
            WHEN loading_exit IS NOT NULL AND dest_entry IS NULL 
                THEN 'IN TRANSIT'
            WHEN loading_end IS NOT NULL AND loading_end > loading_entry THEN 'PRE-TRANSIT'
            ELSE 'LOADING'
        END as audit_status
    FROM base_data
)
SELECT 
    audit_status,
    vehicle,
    loading_entry::DATE as trip_start,
    loading_terminal as origin,
    COALESCE(dest_name, '⚠️ NO DEST GEOFENCE') as destination,
    ROUND(calculated_tat_hrs::numeric, 1) as tat_hrs,
    ROUND((calculated_tat_hrs/24.0)::numeric, 1) as tat_days,
    loading_entry,
    loading_exit,
    dest_entry,
    dest_exit,
    COALESCE(next_dar_entry, next_loading_entry) as return_signal
FROM trip_audit
WHERE 
    -- 1. Focus on unusually high TAT (e.g., more than 20 days / 480 hours)
    calculated_tat_hrs > 480 
    
    -- 2. Focus on problematic categories (Finished but high TAT or No Destination)
    AND (
        audit_status IN ('COMPLETED', 'DELIVERED (NO DEST)', 'RETURNING')
        OR (audit_status = 'IN TRANSIT' AND calculated_tat_hrs > 600) -- Stale in transit for >25 days
    )
    
    -- 3. Ignore recent genuine starts (trips started in the last 7 days)
    AND loading_entry < (NOW() - INTERVAL '7 days')

    -- 4. Error check: ensure we aren't just seeing logic errors
    AND loading_exit >= loading_entry 
    
ORDER BY calculated_tat_hrs DESC;
