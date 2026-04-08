SELECT DISTINCT geofence_name 
FROM public.geofence_visits 
WHERE tracker_id = 3352081 
  AND in_time_dt >= '2025-10-10' 
  AND in_time_dt < '2025-10-25'
  AND (geofence_name ILIKE '%MOMBASA%GEOFENCE%' OR geofence_name ILIKE '%BEIRA%GEOFENCE%')
