 WITH non_dest_trips AS (
    SELECT tracker_id, tracker_name, loading_exit, COALESCE(next_loading_entry, now()) as next_load
    FROM public.tat_trips_data
    WHERE dest_name IS NULL AND customer_name IS NULL
)
SELECT DISTINCT t.tracker_name, t.tracker_id
FROM non_dest_trips t
JOIN public.geofence_visits gv ON gv.tracker_id = t.tracker_id
WHERE gv.geofence_name = 'Kimara Fueling Point'
  AND gv.in_time_dt >= t.loading_exit
  AND gv.in_time_dt < t.next_load
