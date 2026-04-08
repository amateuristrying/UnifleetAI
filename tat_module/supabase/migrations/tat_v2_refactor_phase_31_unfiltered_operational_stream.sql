-- =============================================================
-- TAT V2 REFACTOR: Phase 31
-- Feature: Remove dwell/rank filtering from operational visit stream
--
-- Rationale:
--   Stream-level gating by dwell/state rank can hide operationally
--   relevant signals. Return all stitched visits and let downstream
--   consumers decide their own filtering/view logic.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_tat_operational_visit_stream_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    -- Remove the final WHERE clause that kept only high-rank / >=15 min corridor-border visits.
    v_new := regexp_replace(
        v_def,
        'FROM stitched s\s*WHERE\s*\(\s*s\.state_rank\s*>=\s*70\s*OR\s*\(s\.state_rank\s*IN\s*\(30,\s*40\)\s*AND\s*s\.dwell_hours\s*>=\s*0\.25\)\s*\)',
        'FROM stitched s',
        'nsi'
    );

    IF v_new = v_def THEN
        RAISE NOTICE 'Phase31: stream filter pattern not found; function may already be unfiltered.';
    END IF;

    EXECUTE v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;
