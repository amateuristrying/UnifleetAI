SELECT 
    loading_entry, 
    loading_exit, 
    next_loading_entry, 
    loading_terminal,
    (SELECT json_agg(json_build_object('g', g.geofence_name, 'in', g.in_time_dt) ORDER BY g.in_time_dt ASC)
     FROM geofence_visits g
     WHERE g.tracker_id = t.tracker_id
       AND g.in_time_dt >= t.loading_entry
       AND g.in_time_dt <= COALESCE(t.next_loading_entry, NOW())
    ) as visit_history
FROM tat_trips_data t 
WHERE tracker_name ILIKE '%T 713 ECY%' 
  AND loading_entry >= '2026-03-01'
ORDER BY loading_entry DESC
