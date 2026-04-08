ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS border_chembe_entry TIMESTAMPTZ;
ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS border_chembe_exit TIMESTAMPTZ;
ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS return_border_chembe_entry TIMESTAMPTZ;
ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS return_border_chembe_exit TIMESTAMPTZ;
