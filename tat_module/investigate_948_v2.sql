SELECT 
    tracker_name, 
    loading_entry, 
    loading_exit, 
    next_dar_entry,
    next_loading_entry,
    count(*) OVER (PARTITION BY tracker_name, loading_entry) as dupe_count
FROM tat_trips_data 
WHERE tracker_name ILIKE '%T 948%' 
ORDER BY loading_entry DESC
