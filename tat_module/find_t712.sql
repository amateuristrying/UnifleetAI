SELECT DISTINCT tracker_id, tracker_name 
FROM tat_trips_data 
WHERE tracker_name ILIKE '%T 712 ECY%'
   OR tracker_name ILIKE '%712 ECY%'
