SELECT loading_entry, loading_end, dest_name, total_tat_hrs, session_id
FROM (
    SELECT *,
        CASE 
            WHEN (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) 
                THEN EXTRACT(EPOCH FROM (COALESCE(next_dar_entry, next_loading_entry) - COALESCE(dar_arrival, loading_start)))/3600.0
            WHEN dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (dest_exit - COALESCE(dar_arrival, loading_start)))/3600.0
            WHEN dest_entry IS NOT NULL THEN EXTRACT(EPOCH FROM (dest_entry - COALESCE(dar_arrival, loading_start)))/3600.0
            ELSE EXTRACT(EPOCH FROM (NOW() - COALESCE(dar_arrival, loading_start)))/3600.0
        END as total_tat_hrs
    FROM tat_trips_data
) t
WHERE tracker_id = 3266033
  AND loading_entry >= '2025-12-15'
  AND loading_entry < '2025-12-18'
ORDER BY loading_entry ASC
