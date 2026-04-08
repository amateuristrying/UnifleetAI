-- Run this in your Supabase SQL Editor to verify the trip details before making the actual view change.
SELECT 
    tracker_name,
    loading_start,
    dar_arrival,
    EXTRACT(EPOCH FROM (loading_start - dar_arrival))/3600.0 as waiting_for_orders_hrs,
    loading_end,
    EXTRACT(EPOCH FROM (loading_end - loading_start))/3600.0 as loading_phase_hrs,
    loading_terminal
FROM public.get_tat_trip_details('2026-01-01', '2026-02-28', 10, 0, NULL, NULL, NULL, 3429967) as res
WHERE tracker_id = 3429967;
