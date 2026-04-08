-- =============================================================
-- TAT V2 REFACTOR: Phase 44
-- Re-anchor stabilization:
--   1) Keep prior-return comparison as p.event_time < a.event_time.
--   2) Remove unresolved tw references.
--   3) Re-anchor only once per anchor row:
--      only when anchor is not already state_machine_prev_trip_return_anchor.
--   4) Keep chunk-gate removal (boundary-safe), now stabilized by once-guard.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- 1) No tw dependency in return bound.
    v_new := REPLACE(
        v_new,
        'AND p.event_time < tw.window_start',
        'AND p.event_time < a.event_time'
    );

    -- 2) Insert one-time guard on anchor re-anchor candidates.
    IF position('state_machine_prev_trip_return_anchor' in v_new) > 0
       AND position('COALESCE(a.inference_rule, '''') <> ''state_machine_prev_trip_return_anchor''' in v_new) = 0 THEN
        v_new := REPLACE(
            v_new,
            'WHERE a.event_code = ''trip_anchor_start''',
            E'WHERE a.event_code = ''trip_anchor_start''\n          AND COALESCE(a.inference_rule, '''') <> ''state_machine_prev_trip_return_anchor'''
        );
    END IF;

    -- 3) Ensure chunk-time gating is removed.
    v_new := regexp_replace(
        v_new,
        E'\\n\\s*AND a\\.event_time >= p_start\\n\\s*AND a\\.event_time < p_end',
        '',
        'n'
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

