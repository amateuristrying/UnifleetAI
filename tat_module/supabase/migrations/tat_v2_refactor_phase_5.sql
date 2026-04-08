-- Phase 5: Benchmarks and Exceptions
CREATE TABLE IF NOT EXISTS tat_baseline_lane_daily (
    baseline_date DATE,
    origin_terminal TEXT,
    destination_name TEXT,
    trip_type TEXT,
    p50_tat_hrs NUMERIC(10,2),
    p75_tat_hrs NUMERIC(10,2),
    p90_tat_hrs NUMERIC(10,2),
    trip_count INTEGER,
    UNIQUE(baseline_date, origin_terminal, destination_name, trip_type)
);

CREATE TABLE IF NOT EXISTS tat_baseline_border_daily (
    baseline_date DATE,
    border_name TEXT,
    p50_dwell_hrs NUMERIC(10,2),
    p75_dwell_hrs NUMERIC(10,2),
    p90_dwell_hrs NUMERIC(10,2),
    visit_count INTEGER,
    UNIQUE(baseline_date, border_name)
);

CREATE TABLE IF NOT EXISTS tat_trip_exceptions (
    exception_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_key TEXT REFERENCES tat_trip_facts_v2(trip_key),
    exception_code TEXT NOT NULL, -- excess_loading, missing_destination, low_confidence, etc.
    severity TEXT DEFAULT 'medium',
    description TEXT,
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_tat_trip_exceptions_trip_code
    ON tat_trip_exceptions (trip_key, exception_code);

-- Exception Generator Function
CREATE OR REPLACE FUNCTION generate_tat_v2_exceptions(
    p_start TIMESTAMPTZ, 
    p_end TIMESTAMPTZ 
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- Flag: Low Confidence
    INSERT INTO tat_trip_exceptions (trip_key, exception_code, severity, description)
    SELECT trip_key, 'low_trip_confidence', 'high', 'Lifecycle confidence is below 0.50'
    FROM tat_trip_facts_v2
    WHERE lifecycle_confidence < 0.50
      AND loading_start >= p_start AND loading_start < p_end
      AND NOT EXISTS (
          SELECT 1
          FROM tat_trip_exceptions te
          WHERE te.trip_key = tat_trip_facts_v2.trip_key
            AND te.exception_code = 'low_trip_confidence'
      );

    -- Flag: Missing Destination for Completed Trips
    INSERT INTO tat_trip_exceptions (trip_key, exception_code, severity, description)
    SELECT trip_key, 'missing_destination', 'medium', 'Trip marked completed but no destination evidence found'
    FROM tat_trip_facts_v2
    WHERE (status = 'completed_missed_dest' OR missed_destination = TRUE)
      AND loading_start >= p_start AND loading_start < p_end
      AND NOT EXISTS (
          SELECT 1
          FROM tat_trip_exceptions te
          WHERE te.trip_key = tat_trip_facts_v2.trip_key
            AND te.exception_code = 'missing_destination'
      );

    -- Flag: Excess Loading Duration (> 48h)
    INSERT INTO tat_trip_exceptions (trip_key, exception_code, severity, description)
    SELECT trip_key, 'excess_loading_duration', 'medium', 'Loading phase took more than 48 hours'
    FROM tat_trip_facts_v2
    WHERE loading_phase_hrs > 48
      AND loading_start >= p_start AND loading_start < p_end
      AND NOT EXISTS (
          SELECT 1
          FROM tat_trip_exceptions te
          WHERE te.trip_key = tat_trip_facts_v2.trip_key
            AND te.exception_code = 'excess_loading_duration'
      );
END $$;
