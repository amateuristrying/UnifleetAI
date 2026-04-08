SELECT loading_entry, loading_end, dest_name, session_id 
FROM tat_trips_data 
WHERE tracker_id = 3262846 
  AND dest_name = 'Lumwana Mines' 
ORDER BY loading_entry
