SELECT 
    tracker_name,
    loading_start,
    dar_arrival,
    ROUND((EXTRACT(EPOCH FROM (loading_start - dar_arrival))/3600.0)::numeric, 2) as wait_hours,
    loading_end,
    ROUND((EXTRACT(EPOCH FROM (loading_end - loading_start))/3600.0)::numeric, 2) as loading_hours,
    loading_terminal
FROM (
  SELECT * FROM json_to_recordset(
    (SELECT public.get_tat_trip_details('2026-01-01', '2026-02-28', 10, 0, NULL, NULL, NULL, 3429967)->'data')
  ) AS t(
    tracker_id int,
    tracker_name text,
    loading_start timestamptz,
    dar_arrival timestamptz,
    loading_end timestamptz,
    loading_terminal text
  )
) res;
