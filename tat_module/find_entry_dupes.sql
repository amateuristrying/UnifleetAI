SELECT tracker_id, loading_entry, COUNT(*) 
FROM tat_trips_data 
GROUP BY tracker_id, loading_entry 
HAVING COUNT(*) > 1
LIMIT 50
