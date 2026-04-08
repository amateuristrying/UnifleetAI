-- =============================================================
-- FULL FLEET TAT MODULE AUDIT (ALL-TIME) - FIXED SCOPE
-- Purpose: Inspects ALL trips across ALL trackers for logical consistency.
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
        
        -- CALCULATE TAT MANUALLY IN THE FIRST STEP
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
        -- ROBUST STATUS MAPPING
        CASE 
            WHEN dest_name IS NOT NULL AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) 
                THEN 'COMPLETED (HAS DEST)'
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
        END as audit_status,

        -- GENUINENESS FLAGS (CAN NOW REFERENCE calculated_tat_hrs)
        CASE
            WHEN loading_exit < loading_entry THEN '❌ ERROR: Loading Exit before Entry'
            WHEN dest_entry < loading_exit THEN '❌ ERROR: Dest Entry before Departure'
            WHEN dest_exit < dest_entry THEN '❌ ERROR: Dest Exit before Entry'
            WHEN loading_entry IS NULL THEN '❌ ERROR: Missing Loading Entry'
            WHEN calculated_tat_hrs < 0 THEN '❌ ERROR: Negative TAT'
            WHEN calculated_tat_hrs > 3000 THEN '⚠️ WARNING: Extreme TAT (>3000h)'
            ELSE '✅ GENUINE'
        END as health_check
        
    FROM base_data
)
SELECT 
    health_check,
    audit_status,
    vehicle,
    loading_entry::DATE as trip_start,
    loading_terminal as origin,
    COALESCE(dest_name, '--- MISSING ---') as destination,
    ROUND(calculated_tat_hrs::numeric, 1) as tat_hrs,
    loading_entry,
    loading_exit,
    dest_entry,
    dest_exit,
    COALESCE(next_dar_entry, next_loading_entry) as return_signal
FROM trip_audit
ORDER BY health_check DESC, loading_entry DESC;
