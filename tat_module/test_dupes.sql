SELECT tracker_name, loading_terminal, loading_entry, count(*) as cnt 
FROM tat_trips_data 
GROUP BY tracker_name, loading_terminal, loading_entry 
HAVING count(*) > 1;
