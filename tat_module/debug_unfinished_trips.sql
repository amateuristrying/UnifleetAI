SELECT tracker_name, loading_exit, dest_name, dest_entry, dest_exit, next_dar_entry, next_loading_entry FROM tat_trips_data WHERE dest_exit IS NULL ORDER BY loading_exit ASC LIMIT 50
