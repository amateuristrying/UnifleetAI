-- =============================================================
-- TAT V2 REFACTOR: Phase 42
-- Hotfix for phase41:
--   Ensure _trip_windows tw join is present in anchor_candidates
--   before using tw.window_start in the previous-return filter.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- 1) Insert tw join robustly if still missing.
    IF position('JOIN _trip_windows tw' in v_new) = 0 THEN
        v_new := regexp_replace(
            v_new,
            E'FROM trip_state_events a\\s*\\n\\s*JOIN LATERAL \\(',
            E'FROM trip_state_events a\n        JOIN _trip_windows tw\n          ON tw.trip_key = a.trip_key\n         AND tw.tracker_id = a.tracker_id\n        JOIN LATERAL (',
            'n'
        );
    END IF;

    -- 2) Keep previous-return bound on current trip loading window when tw exists.
    IF position('JOIN _trip_windows tw' in v_new) > 0 THEN
        v_new := REPLACE(v_new, 'AND p.event_time < a.event_time', 'AND p.event_time < tw.window_start');
    ELSE
        -- Safety fallback: never leave unresolved tw reference.
        v_new := REPLACE(v_new, 'AND p.event_time < tw.window_start', 'AND p.event_time < a.event_time');
    END IF;

    -- 3) Remove chunk-time gating from re-anchor candidates.
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

