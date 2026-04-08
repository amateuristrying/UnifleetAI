-- Verification query for session overlaps and Tanga pass-through
-- Case 1: T 679 CTF IVECO (Overlapping session bounds)
SELECT 
    tracker_name, 
    loading_entry, 
    loading_exit, 
    next_loading_entry,
    loading_terminal
FROM tat_trips_data 
WHERE tracker_name = 'T 679 CTF IVECO' 
ORDER BY loading_entry DESC 
LIMIT 5
