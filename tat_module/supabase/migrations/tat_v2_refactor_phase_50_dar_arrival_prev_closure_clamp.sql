-- =============================================================
-- TAT V2 REFACTOR: Phase 50
-- Clamp dar_arrival to latest valid prior trip closure.
--
-- Problem:
--   dar_arrival is sourced from MIN(trip_anchor_start), which can be stale
--   when anchor re-positioning lags behind corrected return-origin closure.
--
-- Fix:
--   In build_tat_trip_facts_v2:
--     dar_arrival := max(anchor_dar_arrival, previous_trip_closed_before_loading)
--   with loading_start fallback when both are null.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_old_expr TEXT := '        COALESCE(a.dar_arrival, a.l_start),';
    v_new_expr TEXT := E'        CASE\n            WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL THEN a.l_start\n            ELSE GREATEST(\n                COALESCE(a.dar_arrival, ''-infinity''::TIMESTAMPTZ),\n                COALESCE(pc.prev_trip_closed, ''-infinity''::TIMESTAMPTZ)\n            )\n        END,';
    v_old_from TEXT := E'    FROM agg a\n    LEFT JOIN next_trips    nt ON nt.trip_key    = a.trip_key\n    LEFT JOIN next_anchor   na ON na.trip_key    = a.trip_key\n    LEFT JOIN closure_fallback cf ON cf.trip_key = a.trip_key\n    LEFT JOIN tracker_names tn ON tn.tracker_id  = a.tracker_id\n    LEFT JOIN border_summary bs ON bs.trip_key   = a.trip_key';
    v_new_from TEXT := E'    FROM agg a\n    LEFT JOIN next_trips    nt ON nt.trip_key    = a.trip_key\n    LEFT JOIN next_anchor   na ON na.trip_key    = a.trip_key\n    LEFT JOIN closure_fallback cf ON cf.trip_key = a.trip_key\n    LEFT JOIN LATERAL (\n        SELECT MAX(e.event_time) AS prev_trip_closed\n        FROM trip_state_events e\n        WHERE e.tracker_id = a.tracker_id\n          AND e.event_code = ''trip_closed''\n          AND e.event_time < COALESCE(a.l_start, ''infinity''::TIMESTAMPTZ)\n    ) pc ON true\n    LEFT JOIN tracker_names tn ON tn.tracker_id  = a.tracker_id\n    LEFT JOIN border_summary bs ON bs.trip_key   = a.trip_key';
BEGIN
    SELECT pg_get_functiondef('public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := REPLACE(v_def, v_old_from, v_new_from);
    v_new := REPLACE(v_new, v_old_expr, v_new_expr);

    -- Idempotency + drift checks
    IF v_new = v_def THEN
        IF POSITION(v_new_from IN v_def) > 0
           AND POSITION(v_new_expr IN v_def) > 0 THEN
            v_new := v_def;
        ELSE
            RAISE EXCEPTION 'Phase 50 patch failed: expected dar_arrival block not found in build_tat_trip_facts_v2.';
        END IF;
    END IF;

    -- Keep builder lineage tag current.
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase50_v1'', true);',
        'n'
    );

    EXECUTE v_new;
END;
$$;

