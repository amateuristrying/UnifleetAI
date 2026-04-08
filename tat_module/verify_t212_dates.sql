SELECT loading_entry, loading_end, dar_arrival, loading_start, next_dar_entry, 
       EXTRACT(EPOCH FROM (COALESCE(next_dar_entry, next_loading_entry) - COALESCE(dar_arrival, loading_start)))/3600.0 as total_tat_hrs
FROM tat_trips_data 
WHERE tracker_id = 1681536
  AND loading_entry >= '2025-12-10'
ORDER BY loading_entry
