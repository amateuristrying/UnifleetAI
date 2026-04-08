-- Phase 2: Normalized Visit Layer
CREATE TABLE IF NOT EXISTS trip_geofence_events_normalized (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracker_id INTEGER NOT NULL,
    in_time TIMESTAMPTZ NOT NULL,
    out_time TIMESTAMPTZ NOT NULL,
    dwell_hours NUMERIC(10,2) GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (out_time - in_time))/3600.0) STORED,
    
    raw_geofence_name TEXT NOT NULL,
    canonical_geofence_id UUID REFERENCES geofence_master(geofence_id),
    canonical_name TEXT,
    
    role_code TEXT,
    trip_stage TEXT,
    country_code TEXT,
    priority INTEGER,
    
    normalization_rule TEXT, -- 'exact_alias', 'normalized_alias', 'unmapped'
    normalization_confidence NUMERIC(3,2),
    
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gen_events_tracker_time ON trip_geofence_events_normalized(tracker_id, in_time);
CREATE INDEX IF NOT EXISTS idx_gen_events_stage ON trip_geofence_events_normalized(trip_stage);
CREATE INDEX IF NOT EXISTS idx_gen_events_canonical ON trip_geofence_events_normalized(canonical_geofence_id);

-- Population Function
CREATE OR REPLACE FUNCTION refresh_trip_geofence_events_normalized(
    p_start TIMESTAMPTZ, 
    p_end TIMESTAMPTZ, 
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_run_id UUID;
BEGIN
    -- Start Run Logging
    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES ('PHASE_2_NORMALIZE', 'running', jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id))
    RETURNING run_id INTO v_run_id;

    -- Clean existing normalized events in window
    DELETE FROM trip_geofence_events_normalized
    WHERE in_time >= p_start AND in_time < p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- Insert Normalized Events
    INSERT INTO trip_geofence_events_normalized (
        tracker_id, in_time, out_time, raw_geofence_name,
        canonical_geofence_id, canonical_name, role_code, trip_stage, country_code, priority,
        normalization_rule, normalization_confidence
    )
    WITH raw_visits AS (
        SELECT 
            gv.tracker_id, gv.in_time_dt, gv.out_time_dt, gv.geofence_name,
            normalize_geofence_name(gv.geofence_name) as norm_name
        FROM public.geofence_visits gv
        WHERE gv.in_time_dt >= p_start AND gv.in_time_dt < p_end
          AND (p_tracker_id IS NULL OR gv.tracker_id = p_tracker_id)
    ),
    matched_visits AS (
        SELECT 
            rv.*,
            COALESCE(ga_exact.geofence_id, ga_norm.geofence_id) as matched_geo_id,
            CASE 
                WHEN ga_exact.geofence_id IS NOT NULL THEN 'exact_alias'
                WHEN ga_norm.geofence_id IS NOT NULL THEN 'normalized_alias'
                ELSE 'unmapped'
            END as rule,
            CASE 
                WHEN ga_exact.geofence_id IS NOT NULL THEN 1.00
                WHEN ga_norm.geofence_id IS NOT NULL THEN 0.95
                ELSE 0.20
            END as confidence
        FROM raw_visits rv
        LEFT JOIN geofence_aliases ga_exact ON ga_exact.alias_name = rv.geofence_name
        LEFT JOIN geofence_aliases ga_norm ON ga_norm.normalized_name = rv.norm_name AND ga_exact.geofence_id IS NULL
    )
    SELECT 
        mv.tracker_id, mv.in_time_dt, mv.out_time_dt, mv.geofence_name,
        gm.geofence_id, gm.canonical_name, 
        rm.role_code, rm.trip_stage, gm.country_code, rm.priority,
        mv.rule, mv.confidence
    FROM matched_visits mv
    LEFT JOIN geofence_master gm ON gm.geofence_id = mv.matched_geo_id
    LEFT JOIN geofence_role_map rm ON rm.geofence_id = gm.geofence_id;

    -- Log Unmapped Geofences to Quality Issues
    INSERT INTO tat_data_quality_issues (run_id, tracker_id, issue_type, severity, description, context)
    SELECT 
        v_run_id, tracker_id, 'unmapped_geofence', 'medium',
        'Unmapped geofence: ' || raw_geofence_name,
        jsonb_build_object('raw_name', raw_geofence_name, 'in_time', in_time)
    FROM trip_geofence_events_normalized
    WHERE normalization_rule = 'unmapped'
      AND created_at >= (SELECT start_time FROM tat_refactor_runs WHERE run_id = v_run_id);

    -- Finish Run Logging
    UPDATE tat_refactor_runs 
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'event_count', (SELECT count(*) FROM trip_geofence_events_normalized WHERE in_time >= p_start AND in_time < p_end),
            'unmapped_count', (SELECT count(*) FROM trip_geofence_events_normalized WHERE in_time >= p_start AND in_time < p_end AND normalization_rule = 'unmapped')
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    UPDATE tat_refactor_runs 
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;
