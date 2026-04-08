-- Verification query for session overlaps and Tanga pass-through
-- Case 1: T 679 CTF IVECO (Overlapping session bounds)
SELECT 
    tracker_name, 
    loading_entry, 
    loading_exit, 
    next_loading_entry,
    loading_terminal
FROM tat_trips_data 
WHERE tracker_name = 'T 679 CTF IVECO' 
ORDER BY loading_entry DESC 
LIMIT 5;

-- Case 2: T 713 ECY (Tanga pass-through)
SELECT 
    tracker_name, 
    loading_terminal, 
    loading_entry, 
    loading_exit, 
    dest_name,
    (SELECT json_agg(json_build_object('g', res->>'geofence_name', 'in', res->>'in_time'))
     FROM json_array_elements(visit_chain) res
    ) as visits
FROM (
    SELECT * FROM json_to_recordset(
        (get_tat_trip_details('2026-03-01', NOW(), 10, 0, NULL, NULL, NULL, NULL, 'date_desc'))->'data'
    ) AS x(
        tracker_name TEXT, 
        loading_terminal TEXT,
        loading_entry TIMESTAMPTZ, 
        loading_exit TIMESTAMPTZ, 
        dest_name TEXT,
        visit_chain JSON
    )
) sub
WHERE tracker_name = 'T 713 ECY'
ORDER BY loading_entry DESC;
