SELECT loading_entry, loading_terminal, dest_name, 
    CASE
        WHEN (dest_exit IS NOT NULL OR dest_name IS NOT NULL) AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) THEN 'completed'
        WHEN dest_exit IS NOT NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL THEN 'returning'
        WHEN dest_exit IS NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL THEN 'unfinished'
        ELSE 'completed' -- Simplified fallback for finished trips
    END as derived_status
FROM tat_trips_data
WHERE tracker_id = 3262846
  AND loading_entry >= '2026-01-10'
ORDER BY loading_entry ASC
