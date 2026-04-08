-- 1. Deduplicate existing trips in tat_trips_data
-- Keep the record with the earliest loading_entry for each (tracker_id, loading_end)
DELETE FROM tat_trips_data t1
USING tat_trips_data t2
WHERE t1.tracker_id = t2.tracker_id
  AND t1.loading_end = t2.loading_end
  AND t1.loading_entry > t2.loading_entry;

-- 2. Drop the old unique constraint and add the new one
-- We need to find the name of the constraint first or just drop and recreate index.
-- In the table definition it was just UNIQUE(tracker_id, loading_entry)
-- Postgres usually names this as tat_trips_data_tracker_id_loading_entry_key

ALTER TABLE tat_trips_data DROP CONSTRAINT IF EXISTS tat_trips_data_tracker_id_loading_entry_key;
ALTER TABLE tat_trips_data ADD CONSTRAINT tat_trips_data_tracker_id_loading_end_key UNIQUE (tracker_id, loading_end);
