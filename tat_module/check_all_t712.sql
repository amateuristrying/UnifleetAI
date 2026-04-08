SELECT loading_entry, loading_end, loading_terminal, total_tat_hrs, session_id
FROM tat_trips_data 
WHERE tracker_id = 3352081
ORDER BY loading_entry
