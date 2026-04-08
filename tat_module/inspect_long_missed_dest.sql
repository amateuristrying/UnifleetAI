SELECT 
    tracker_name, 
    loading_exit as "Departure",
    COALESCE(next_dar_entry, next_loading_entry) as "Return",
    ROUND(EXTRACT(EPOCH FROM (COALESCE(next_dar_entry, next_loading_entry) - loading_exit))/3600.0, 1) as "Hours Away",
    (SELECT json_agg(json_build_object('g', g.geofence_name, 'in', g.in_time_dt) ORDER BY g.in_time_dt ASC)
     FROM geofence_visits g
     WHERE g.tracker_id = t.tracker_id
       AND g.in_time_dt >= t.loading_exit
       AND g.in_time_dt <= COALESCE(t.next_dar_entry, t.next_loading_entry)
    ) as "Visit Chain"
FROM tat_trips_data t
WHERE dest_exit IS NULL 
  AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL)
  AND (COALESCE(next_dar_entry, next_loading_entry) - loading_exit) > INTERVAL '3 days'
ORDER BY loading_exit DESC
LIMIT 5
