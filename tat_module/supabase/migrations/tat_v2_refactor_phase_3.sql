-- file: /Users/op_maulana/unifleet2/supabase/migrations/tat_v2_refactor_phase_3.sql
CREATE OR REPLACE FUNCTION build_trip_state_events_v2(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_tracker_id INTEGER DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- 1. Initial Cleanup
    DELETE FROM trip_state_events 
    WHERE event_time >= p_start AND event_time < p_end 
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- 2. Milestone: loading_start (Anchors)
    INSERT INTO trip_state_events (trip_key, tracker_id, event_code, event_time, event_confidence, inference_rule, event_meta)
    SELECT 
        tracker_id || ':' || (EXTRACT(EPOCH FROM in_time)::BIGINT) as trip_key,
        tracker_id, 'loading_start', in_time, normalization_confidence, 'terminal_entry', 
        jsonb_build_object('geofence', canonical_name, 'role', role_code)
    FROM trip_geofence_events_normalized 
    WHERE role_code IN ('origin_terminal', 'origin_zone') 
      AND in_time >= p_start AND in_time < p_end 
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- 3. Milestone: loading_end
    INSERT INTO trip_state_events (trip_key, tracker_id, event_code, event_time, event_confidence, inference_rule, event_meta)
    SELECT 
        tracker_id || ':' || (EXTRACT(EPOCH FROM in_time)::BIGINT) as trip_key,
        tracker_id, 'loading_end', out_time, normalization_confidence, 'terminal_exit', 
        jsonb_build_object('geofence', canonical_name, 'role', role_code)
    FROM trip_geofence_events_normalized 
    WHERE role_code IN ('origin_terminal', 'origin_zone') 
      AND in_time >= p_start AND in_time < p_end 
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- 4. Milestone: destination_entry
    INSERT INTO trip_state_events (trip_key, tracker_id, event_code, event_time, event_confidence, inference_rule, event_meta)
    SELECT 
        l.trip_key, l.tracker_id, 'destination_entry', d.in_time, d.normalization_confidence, 'first_dest_after_load',
        jsonb_build_object('geofence', d.canonical_name, 'role', d.role_code)
    FROM trip_state_events l
    JOIN LATERAL (
        SELECT * FROM trip_geofence_events_normalized n 
        WHERE n.tracker_id = l.tracker_id 
          AND n.in_time > l.event_time 
          AND n.trip_stage = 'at_destination'
        ORDER BY n.in_time ASC LIMIT 1
    ) d ON true
    WHERE l.event_code = 'loading_start' 
      AND l.event_time >= p_start AND l.event_time < p_end;

    -- 5. Milestone: destination_exit
    INSERT INTO trip_state_events (trip_key, tracker_id, event_code, event_time, event_confidence, inference_rule, event_meta)
    SELECT 
        l.trip_key, l.tracker_id, 'destination_exit', d.out_time, d.normalization_confidence, 'dest_exit_time',
        jsonb_build_object('geofence', d.canonical_name, 'role', d.role_code)
    FROM trip_state_events l
    JOIN LATERAL (
        SELECT * FROM trip_geofence_events_normalized n 
        WHERE n.tracker_id = l.tracker_id 
          AND n.in_time > l.event_time 
          AND n.trip_stage = 'at_destination'
        ORDER BY n.in_time ASC LIMIT 1
    ) d ON true
    WHERE l.event_code = 'loading_start' 
      AND l.event_time >= p_start AND l.event_time < p_end;

    -- 6. Milestone: border_entry
    INSERT INTO trip_state_events (trip_key, tracker_id, event_code, event_time, event_confidence, inference_rule, event_meta)
    SELECT 
        l.trip_key, l.tracker_id, 'border_entry', n.in_time, n.normalization_confidence, 'transit_border_entry',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code)
    FROM trip_state_events l
    JOIN trip_geofence_events_normalized n ON n.tracker_id = l.tracker_id
    WHERE l.event_code = 'loading_start' 
      AND n.in_time > l.event_time 
      AND n.role_code LIKE 'border_%' 
      AND (n.in_time < (SELECT MIN(e2.event_time) FROM trip_state_events e2 WHERE e2.trip_key = l.trip_key AND e2.event_code = 'destination_entry') OR NOT EXISTS (SELECT 1 FROM trip_state_events e3 WHERE e3.trip_key = l.trip_key AND e3.event_code = 'destination_entry'))
      AND l.event_time >= p_start AND l.event_time < p_end;

    -- 7. Milestone: trip_closed (Return to origin)
    INSERT INTO trip_state_events (trip_key, tracker_id, event_code, event_time, event_confidence, inference_rule, event_meta)
    SELECT 
        l.trip_key, l.tracker_id, 'trip_closed', r.in_time, 0.90, 'return_to_origin',
        jsonb_build_object('geofence', r.canonical_name, 'reason', 'closed_by_return_origin')
    FROM trip_state_events l
    JOIN LATERAL (
        SELECT * FROM trip_geofence_events_normalized n 
        WHERE n.tracker_id = l.tracker_id 
          AND n.in_time > (SELECT MAX(e2.event_time) FROM trip_state_events e2 WHERE e2.trip_key = l.trip_key AND e2.event_code = 'destination_entry')
          AND n.role_code IN ('origin_zone', 'origin_gateway')
        ORDER BY n.in_time ASC LIMIT 1
    ) r ON true
    WHERE l.event_code = 'loading_start' 
      AND l.event_time >= p_start AND l.event_time < p_end;

END $$;
