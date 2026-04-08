SELECT loading_entry, dar_arrival, loading_start, loading_end, dest_entry, dest_exit, next_dar_entry, next_loading_entry, session_id
FROM tat_trips_data 
WHERE tracker_id = 3262846 
  AND dest_name = 'Lumwana Mines'
ORDER BY loading_entry ASC
