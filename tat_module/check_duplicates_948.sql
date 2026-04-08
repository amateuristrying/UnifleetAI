SELECT 
    tracker_name, 
    loading_entry, 
    count(*) 
FROM tat_trips_data 
WHERE tracker_name ILIKE '%T 948%' 
GROUP BY tracker_name, loading_entry 
HAVING count(*) > 1
