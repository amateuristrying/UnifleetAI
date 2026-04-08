SELECT t.loading_terminal, t.loading_entry, t.loading_exit, t.next_loading_entry, t.dest_name,
       gv.geofence_name, gv.in_time_dt, gv.out_time_dt,
       EXTRACT(EPOCH FROM (gv.out_time_dt - gv.in_time_dt))/3600.0 as dwell_hrs
FROM public.tat_trips_data t
JOIN public.geofence_visits gv ON gv.tracker_id = t.tracker_id
WHERE t.tracker_id = 3006355
  AND gv.in_time_dt >= t.loading_exit - INTERVAL '12 hours'
  AND gv.in_time_dt < COALESCE(t.next_loading_entry, now())
  AND t.dest_name IS NULL
ORDER BY t.loading_entry, gv.in_time_dt
LIMIT 100
