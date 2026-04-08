SELECT 
    tracker_name, 
    loading_entry, 
    loading_exit, 
    next_dar_entry, 
    next_loading_entry,
    dest_name,
    EXTRACT(EPOCH FROM (NOW() - loading_exit))/3600.0 as current_delay
FROM tat_trips_data 
WHERE EXTRACT(EPOCH FROM (NOW() - loading_entry))/3600.0 BETWEEN 1980 AND 1995
ORDER BY loading_entry DESC
