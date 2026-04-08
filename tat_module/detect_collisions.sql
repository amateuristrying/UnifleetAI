SELECT tracker_id, loading_end, COUNT(*) 
FROM tat_trips_data 
GROUP BY tracker_id, loading_end 
HAVING COUNT(*) > 1
LIMIT 50
