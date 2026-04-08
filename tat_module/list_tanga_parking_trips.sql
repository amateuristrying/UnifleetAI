-- List trips that visited Tanga Parking but have no destination detected
WITH non_dest_trips AS (
    SELECT 
        tracker_id,
        tracker_name,
        loading_entry,
        loading_exit,
        next_loading_entry,
        loading_terminal
    FROM public.tat_trips_data
    WHERE dest_name IS NULL 
      AND customer_name IS NULL
      AND loading_exit > now() - INTERVAL '3 months'
),
tanga_parking_visits AS (
    SELECT 
        t.*,
        gv.geofence_name,
        gv.in_time_dt as parking_entry,
        gv.out_time_dt as parking_exit,
        EXTRACT(EPOCH FROM (gv.out_time_dt - gv.in_time_dt))/3600.0 as parking_dwell_hrs
    FROM non_dest_trips t
    JOIN public.geofence_visits gv ON gv.tracker_id = t.tracker_id
    WHERE gv.geofence_name = 'Tanga Parking'
      AND gv.in_time_dt >= t.loading_exit
      AND gv.in_time_dt < COALESCE(t.next_loading_entry, now())
)
SELECT 
    tracker_name,
    loading_terminal,
    parking_entry::date as trip_date,
    ROUND(parking_dwell_hrs::numeric, 1) as parking_dwell_hrs,
    loading_entry,
    loading_exit,
    next_loading_entry
FROM tanga_parking_visits
ORDER BY parking_entry DESC
LIMIT 100
