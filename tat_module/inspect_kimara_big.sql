SELECT t.loading_terminal, t.loading_exit, t.next_loading_entry, 
       gv.geofence_name, gv.in_time_dt, gv.out_time_dt,
       EXTRACT(EPOCH FROM (gv.out_time_dt - gv.in_time_dt))/3600.0 as dwell_hrs
FROM public.tat_trips_data t
JOIN public.geofence_visits gv ON gv.tracker_id = t.tracker_id
WHERE t.tracker_id = 3511966
  AND gv.in_time_dt >= '2026-02-01'
  AND gv.in_time_dt < '2026-03-15'
  AND t.dest_name IS NULL
ORDER BY gv.in_time_dt
LIMIT 200
