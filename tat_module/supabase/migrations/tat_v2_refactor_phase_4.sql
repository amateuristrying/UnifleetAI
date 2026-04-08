-- file: /Users/op_maulana/unifleet2/supabase/migrations/tat_v2_refactor_phase_4.sql
CREATE OR REPLACE FUNCTION build_tat_trip_facts_v2(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_tracker_id INTEGER DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO tat_trip_facts_v2 (
        trip_key, tracker_id, loading_start, loading_end, loading_terminal, 
        destination_name, dest_entry, dest_exit, border_entry, trip_closed_at,
        status, trip_type, lifecycle_confidence, 
        loading_phase_hrs, transit_hrs, destination_dwell_hrs, total_tat_hrs,
        has_border_event
    )
    WITH active_trips AS (
        -- Find trips starting in this window
        SELECT DISTINCT trip_key FROM trip_state_events
        WHERE event_code = 'loading_start'
          AND event_time >= p_start AND event_time < p_end
          AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
    ),
    aggregated AS (
        -- Collect ALL milestones for those trips, regardless of when they occurred
        SELECT 
            e.trip_key, e.tracker_id,
            MIN(e.event_time) FILTER (WHERE e.event_code = 'loading_start') as l_start,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'loading_end') as l_end,
            MIN(e.event_time) FILTER (WHERE e.event_code = 'destination_entry') as d_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'destination_exit') as d_exit,
            MIN(e.event_time) FILTER (WHERE e.event_code = 'border_entry') as b_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'trip_closed') as t_closed,
            MAX(e.event_meta->>'geofence') FILTER (WHERE e.event_code = 'loading_start') as term_name,
            MAX(e.event_meta->>'geofence') FILTER (WHERE e.event_code = 'destination_entry') as destination,
            AVG(e.event_confidence) as confidence
        FROM trip_state_events e
        JOIN active_trips at ON at.trip_key = e.trip_key
        GROUP BY e.trip_key, e.tracker_id
    )
    SELECT 
        trip_key, tracker_id, l_start, l_end, term_name, 
        destination, d_entry, d_exit, b_entry, t_closed,
        CASE 
            WHEN t_closed IS NOT NULL THEN 'completed'
            WHEN d_entry IS NOT NULL THEN 'returning'
            ELSE 'in_transit'
        END as status,
        CASE 
            WHEN b_entry IS NOT NULL THEN 'long_haul'
            ELSE 'local_ops'
        END as trip_type,
        confidence,
        EXTRACT(EPOCH FROM (l_end - l_start))/3600.0,
        EXTRACT(EPOCH FROM (d_entry - l_end))/3600.0,
        EXTRACT(EPOCH FROM (d_exit - d_entry))/3600.0,
        EXTRACT(EPOCH FROM (COALESCE(t_closed, NOW()) - l_start))/3600.0,
        (b_entry IS NOT NULL)
    FROM aggregated
    ON CONFLICT (trip_key) DO UPDATE SET 
        loading_start = EXCLUDED.loading_start,
        loading_end = EXCLUDED.loading_end,
        loading_terminal = EXCLUDED.loading_terminal,
        destination_name = EXCLUDED.destination_name,
        dest_entry = EXCLUDED.dest_entry,
        dest_exit = EXCLUDED.dest_exit,
        border_entry = EXCLUDED.border_entry,
        trip_closed_at = EXCLUDED.trip_closed_at,
        status = EXCLUDED.status,
        trip_type = EXCLUDED.trip_type,
        lifecycle_confidence = EXCLUDED.lifecycle_confidence,
        loading_phase_hrs = EXCLUDED.loading_phase_hrs,
        transit_hrs = EXCLUDED.transit_hrs,
        destination_dwell_hrs = EXCLUDED.destination_dwell_hrs,
        total_tat_hrs = EXCLUDED.total_tat_hrs,
        has_border_event = EXCLUDED.has_border_event,
        updated_at = NOW();
END $$;
