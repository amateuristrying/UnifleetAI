-- =============================================================
-- TAT V2 REFACTOR: Phase 43
-- Robust chunk-boundary fix for re-anchor:
--   1) Keep prior-return constraint as p.event_time < a.event_time
--      (no external alias dependency).
--   2) Remove re-anchor candidate gating by a.event_time within chunk.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- 1) Ensure no unresolved tw alias remains.
    v_new := REPLACE(
        v_new,
        'AND p.event_time < tw.window_start',
        'AND p.event_time < a.event_time'
    );

    -- 2) Remove chunk-time gating from re-anchor candidates.
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

