-- Comprehensive query to find "In Progress" trips that have actually returned home
SELECT 
    tracker_name, 
    loading_exit as "Left Origin", 
    COALESCE(dest_name, 'DESTINATION MISSED') as "Destination",
    dest_entry as "Arrived at Dest",
    COALESCE(next_dar_entry, next_loading_entry) as "Returned Home",
    trip_status,
    ROUND(total_tat_hrs/24.0, 1) as "Duration (Days)"
FROM tat_trips_view
WHERE dest_exit IS NULL -- Current definition of 'In Progress'
  AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) -- But they HAVE returned
ORDER BY loading_exit ASC;
