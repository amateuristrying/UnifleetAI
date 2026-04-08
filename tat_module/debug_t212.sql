SELECT loading_entry, loading_end, dest_name, next_dar_entry, next_loading_entry, session_id
FROM tat_trips_data 
WHERE tracker_id = 1681536
  AND loading_entry >= '2025-11-20'
  AND loading_entry < '2026-01-01'
ORDER BY loading_entry
