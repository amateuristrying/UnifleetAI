-- =============================================================
-- TAT V2 REFACTOR: Phase 39
-- No-gap waiting accounting:
--   Anchor next trip at previous trip return-origin milestone so
--   operational delays (e.g., parked at Kibaha for 2 days) are counted.
--
-- Behavior:
--   For each trip_anchor_start event, if a prior return_origin_entry
--   exists for the same tracker, move anchor time to that milestone.
--   This preserves operational idle/waiting as part of waiting stage.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    IF position('state_machine_prev_trip_return_anchor' in v_new) = 0 THEN
        v_new := replace(
            v_new,
            '    -- 13) Data quality marker',
            E'    -- 12.6) Re-anchor from previous return-origin milestone (no-gap waiting accounting)\n    WITH anchor_candidates AS (\n        SELECT\n            a.event_id,\n            a.event_time AS old_anchor_time,\n            prev_ro.event_time AS new_anchor_time,\n            prev_ro.canonical_name AS new_anchor_geofence,\n            prev_ro.role_code AS new_anchor_role\n        FROM trip_state_events a\n        JOIN LATERAL (\n            SELECT\n                p.event_time,\n                p.canonical_name,\n                p.role_code\n            FROM trip_state_events p\n            WHERE p.tracker_id = a.tracker_id\n              AND p.event_code = ''return_origin_entry''\n              AND p.event_time < a.event_time\n            ORDER BY p.event_time DESC\n            LIMIT 1\n        ) prev_ro ON true\n        WHERE a.event_code = ''trip_anchor_start''\n          AND a.event_time >= p_start\n          AND a.event_time < p_end\n          AND (p_tracker_id IS NULL OR a.tracker_id = p_tracker_id)\n    )\n    UPDATE trip_state_events a\n    SET\n        event_time = ac.new_anchor_time,\n        canonical_name = COALESCE(ac.new_anchor_geofence, a.canonical_name),\n        role_code = COALESCE(NULLIF(ac.new_anchor_role, ''''), a.role_code),\n        inference_rule = ''state_machine_prev_trip_return_anchor'',\n        event_meta = jsonb_strip_nulls(\n            COALESCE(a.event_meta, ''{}''::jsonb)\n            || jsonb_build_object(\n                ''geofence'', COALESCE(ac.new_anchor_geofence, a.canonical_name),\n                ''anchor_source'', ''previous_trip_return_origin'',\n                ''anchor_shift_hours'', ROUND(EXTRACT(EPOCH FROM (ac.old_anchor_time - ac.new_anchor_time)) / 3600.0, 2)\n            )\n        )\n    FROM anchor_candidates ac\n    WHERE a.event_id = ac.event_id\n      AND ac.new_anchor_time < ac.old_anchor_time;\n\n    -- 13) Data quality marker'
        );
    END IF;

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

