SELECT geofence_name, in_time_dt, out_time_dt 
FROM public.geofence_visits 
WHERE tracker_id = 3352081 
  AND in_time_dt >= '2026-01-10' 
  AND in_time_dt < '2026-01-25'
ORDER BY in_time_dt
