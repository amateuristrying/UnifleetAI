SELECT DISTINCT tracker_id, tracker_name 
FROM tat_trips_data 
WHERE tracker_name ILIKE '%1613%'
OR tracker_name ILIKE '%T212%'
