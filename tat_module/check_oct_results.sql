SELECT loading_entry, loading_end, loading_terminal, dar_arrival, loading_start
FROM tat_trips_data 
WHERE tracker_id = 3352081 
  AND loading_entry >= '2025-10-10' 
  AND loading_entry < '2025-11-25'
ORDER BY loading_entry ASC
