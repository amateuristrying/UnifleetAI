-- =============================================================
-- TAT V2 REFACTOR: Phase 36
-- Fixes:
--   1) Correct transition enforcement mode assignment in builder:
--        single tracker => strict, ALL trackers => warn.
--   2) Improve return-origin semantics in state machine:
--      - Emit return_origin_entry milestone event.
--      - Carry return_origin stop_state in trip context.
--      - Avoid hard-coded trip_closed role_code='origin_zone';
--        resolve role_code from geofence/stop_state context.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- ---------------------------------------------------------
    -- A) Fix enforcement mode assignment (phase35 had it reversed).
    -- ---------------------------------------------------------
    v_new := REPLACE(
        v_new,
        'PERFORM set_config(''tat.transition_enforcement_mode'', CASE WHEN p_tracker_id IS NULL THEN ''strict'' ELSE ''warn'' END, true);',
        'PERFORM set_config(''tat.transition_enforcement_mode'', CASE WHEN p_tracker_id IS NULL THEN ''warn'' ELSE ''strict'' END, true);'
    );

    -- ---------------------------------------------------------
    -- B) Return-origin context should accept both old/new stop-state naming.
    -- ---------------------------------------------------------
    v_new := regexp_replace(
        v_new,
        'ov\.stop_state IN \(''origin_operational_stop'',\s*''origin_loading_stop''\)',
        'ov.stop_state IN (''operational_stop'', ''origin_operational_stop'', ''origin_loading_stop'')',
        'n'
    );

    -- ---------------------------------------------------------
    -- C) Carry return_origin_stop_state from _ops_visits into _trip_context.
    -- ---------------------------------------------------------
    v_new := regexp_replace(
        v_new,
        'SELECT\s*\n\s*ov\.visit_start_utc AS return_origin_entry,\s*\n\s*ov\.geofence_name AS return_origin_name',
        E'SELECT\n            ov.visit_start_utc AS return_origin_entry,\n            ov.geofence_name AS return_origin_name,\n            ov.stop_state AS return_origin_stop_state',
        'n'
    );

    -- ---------------------------------------------------------
    -- D) Emit explicit return_origin_entry event before trip closure.
    -- ---------------------------------------------------------
    IF position('state_machine_return_origin_entry' in v_new) = 0 THEN
        v_new := REPLACE(
            v_new,
            '    -- 12) Trip closures',
            E'    -- 11.5) return_origin_entry\n    INSERT INTO trip_state_events (\n        trip_key, tracker_id, tracker_name,\n        event_code, event_time,\n        event_confidence, inference_rule, event_meta,\n        canonical_name, role_code, trip_stage\n    )\n    SELECT\n        tc.trip_key,\n        tc.tracker_id,\n        tc.tracker_name,\n        ''return_origin_entry'',\n        tc.return_origin_entry,\n        0.88,\n        ''state_machine_return_origin_entry'',\n        jsonb_build_object(\n            ''geofence'', tc.return_origin_name,\n            ''stop_state'', COALESCE(tc.return_origin_stop_state, ''operational_stop'')\n        ),\n        tc.return_origin_name,\n        CASE\n            WHEN UPPER(COALESCE(tc.return_origin_name, '''')) IN (\n                ''ASAS KIBAHA YARD'', ''ASAS TABATA'', ''ASAS DAR OFFICE'', ''ASAS IRINGA YARD''\n            ) THEN ''ops_yard''\n            WHEN UPPER(COALESCE(tc.return_origin_name, '''')) = ''KURASINI ZONE'' THEN ''origin_zone''\n            WHEN UPPER(COALESCE(tc.return_origin_name, '''')) IN (\n                ''DAR GEOFENCE'', ''KILUVYA GATEWAY'', ''TANGA ZONE'', ''BEIRA ZONE'', ''MTWARA ZONE'', ''MOMBASA ZONE''\n            ) THEN ''origin_gateway''\n            WHEN COALESCE(tc.return_origin_stop_state, '''') = ''origin_loading_stop'' THEN ''origin_zone''\n            ELSE ''origin_gateway''\n        END,\n        ''returning''\n    FROM _trip_context tc\n    WHERE tc.return_origin_entry IS NOT NULL\n      AND NOT EXISTS (\n          SELECT 1\n          FROM trip_state_events e\n          WHERE e.trip_key = tc.trip_key\n            AND e.event_code = ''return_origin_entry''\n      );\n\n    -- 12) Trip closures'
        );
    END IF;

    -- ---------------------------------------------------------
    -- E) trip_closed role_code should be derived, not hardcoded origin_zone.
    -- ---------------------------------------------------------
    v_new := regexp_replace(
        v_new,
        'tc\.return_origin_name,\s*\n\s*''origin_zone'',\s*\n\s*''returning''',
        E'tc.return_origin_name,\n        CASE\n            WHEN UPPER(COALESCE(tc.return_origin_name, '''')) IN (\n                ''ASAS KIBAHA YARD'', ''ASAS TABATA'', ''ASAS DAR OFFICE'', ''ASAS IRINGA YARD''\n            ) THEN ''ops_yard''\n            WHEN UPPER(COALESCE(tc.return_origin_name, '''')) = ''KURASINI ZONE'' THEN ''origin_zone''\n            WHEN UPPER(COALESCE(tc.return_origin_name, '''')) IN (\n                ''DAR GEOFENCE'', ''KILUVYA GATEWAY'', ''TANGA ZONE'', ''BEIRA ZONE'', ''MTWARA ZONE'', ''MOMBASA ZONE''\n            ) THEN ''origin_gateway''\n            WHEN COALESCE(tc.return_origin_stop_state, '''') = ''origin_loading_stop'' THEN ''origin_zone''\n            ELSE ''origin_gateway''\n        END,\n        ''returning''',
        'n'
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

