SELECT loading_entry, loading_end, dar_arrival, loading_start, next_dar_entry, next_loading_entry
FROM tat_trips_data 
WHERE tracker_id = 1681536
  AND (
    ROUND(EXTRACT(EPOCH FROM (COALESCE(next_dar_entry, next_loading_entry) - COALESCE(dar_arrival, loading_start)))/3600.0, 1) IN (101.1, 2023.0, 1086.1, 537.7)
  )
ORDER BY loading_entry
