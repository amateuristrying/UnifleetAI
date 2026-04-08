SELECT 
    tracker_name, 
    loading_entry, 
    loading_exit, 
    dest_entry, 
    dest_exit, 
    next_dar_entry, 
    next_loading_entry,
    dar_arrival,
    customer_name
FROM tat_trips_data 
WHERE tracker_name ILIKE '%T 948 DQG%' 
ORDER BY loading_entry DESC
