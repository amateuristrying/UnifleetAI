SELECT prosrc FROM pg_proc WHERE proname = 'get_tat_trip_details' ORDER BY array_length(proargnames, 1) DESC LIMIT 1
