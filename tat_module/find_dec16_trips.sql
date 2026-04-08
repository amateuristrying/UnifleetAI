SELECT tracker_id, tracker_name, loading_entry, loading_end, dest_name
FROM tat_trips_data
WHERE loading_entry::text ILIKE '%2025-12-16%'
ORDER BY loading_entry
