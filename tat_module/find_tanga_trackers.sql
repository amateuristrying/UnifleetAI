WITH non_dest_trips AS (
    SELECT tracker_id, tracker_name, loading_exit, COALESCE(next_loading_entry, now()) as next_load
    FROM public.tat_trips_data
    WHERE dest_name IS NULL AND customer_name IS NULL
)
SELECT DISTINCT t.tracker_name, t.tracker_id, COUNT(*) as visit_count
FROM non_dest_trips t
JOIN public.geofence_visits gv ON gv.tracker_id = t.tracker_id
WHERE gv.geofence_name = 'Tanga Parking'
  AND gv.in_time_dt >= t.loading_exit
  AND gv.in_time_dt < t.next_load
GROUP BY t.tracker_name, t.tracker_id
ORDER BY visit_count DESC
LIMIT 10
