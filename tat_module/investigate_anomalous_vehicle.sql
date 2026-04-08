SELECT 
    tracker_name, 
    loading_entry, 
    loading_exit, 
    next_dar_entry, 
    next_loading_entry 
FROM tat_trips_data 
WHERE tracker_name = 'T 679 CTF IVECO' 
ORDER BY loading_entry DESC 
LIMIT 5
