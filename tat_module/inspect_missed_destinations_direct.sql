-- Direct query on tat_trips_data to find missed destinations without the overhead of the RPC
WITH missed_dest_samples AS (
    SELECT 
        tracker_id,
        tracker_name,
        loading_exit,
        COALESCE(next_dar_entry, next_loading_entry) as return_time
    FROM tat_trips_data
    WHERE dest_exit IS NULL 
      AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL)
    ORDER BY loading_exit DESC
    LIMIT 10
)
SELECT 
    m.tracker_name,
    m.loading_exit as "Departure",
    m.return_time as "Return",
    (SELECT json_agg(json_build_object('geofence', g.geofence_name, 'in', g.in_time_dt))
     FROM geofence_visits g
     WHERE g.tracker_id = m.tracker_id
       AND g.in_time_dt >= m.loading_exit
       AND g.in_time_dt <= m.return_time
    ) as "Visit Chain"
FROM missed_dest_samples m
