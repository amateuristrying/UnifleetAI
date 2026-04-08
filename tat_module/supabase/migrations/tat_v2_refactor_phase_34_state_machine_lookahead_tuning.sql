-- =============================================================
-- TAT V2 REFACTOR: Phase 34
-- Performance tuning for state-machine rebuild on ALL trackers.
--
-- Problem:
--   build_trip_state_events_v2() materializes operational visits using
--   get_tat_operational_visit_stream_v2(p_start - 1d, p_end + 365d, ...).
--   For ALL trackers this wide lookahead can exceed statement timeout.
--
-- Change:
--   Patch function text to use adaptive lookahead:
--     - ALL trackers  (p_tracker_id IS NULL): 120 days
--     - Single tracker:                         365 days (unchanged)
--   Optional runtime override via GUC:
--     set_config('tat.state_lookahead_days', '<int>', true)
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := regexp_replace(
        v_def,
        'p_end\s*\+\s*INTERVAL ''365 days''',
        'p_end + (COALESCE(NULLIF(current_setting(''tat.state_lookahead_days'', true), '''')::INT, CASE WHEN p_tracker_id IS NULL THEN 120 ELSE 365 END) * INTERVAL ''1 day'')',
        'n'
    );

    IF v_new = v_def THEN
        RAISE NOTICE 'Phase34: lookahead pattern not found; function may already be tuned.';
    ELSE
        EXECUTE v_new;
    END IF;
END;
$$;
