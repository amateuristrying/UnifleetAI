-- =============================================================
-- TAT V2 REFACTOR: Phase 41
-- Chunk-safe re-anchor fix:
--   Ensure phase39 re-anchor logic is scoped by rebuilt trip windows
--   (trip_key) instead of anchor event_time within [p_start, p_end).
--
-- Why:
--   In chunked rebuilds, a trip_anchor_start can naturally fall before
--   chunk start (pre-loading context), causing re-anchor to be skipped.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- 1) Anchor candidate scope: join to _trip_windows (rebuilt trips in chunk).
    IF position('JOIN _trip_windows tw' in v_new) = 0 THEN
        v_new := REPLACE(
            v_new,
            'FROM trip_state_events a
        JOIN LATERAL (',
            'FROM trip_state_events a
        JOIN _trip_windows tw
          ON tw.trip_key = a.trip_key
         AND tw.tracker_id = a.tracker_id
        JOIN LATERAL ('
        );
    END IF;

    -- 2) Previous return-origin must be before current trip loading window.
    v_new := REPLACE(
        v_new,
        'AND p.event_time < a.event_time',
        'AND p.event_time < tw.window_start'
    );

    -- 3) Remove event-time chunk gating (this caused boundary misses).
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

