-- =============================================================
-- TAT V2 REFACTOR: Phase 38
-- Hotfix-2 for return_origin semantics:
--   Ensure build_trip_state_events_v2() has no remaining references to
--   tc.return_origin_stop_state (which may not exist in _trip_context).
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    v_new := REPLACE(
        v_new,
        'COALESCE(tc.return_origin_stop_state, ''operational_stop'')',
        '''operational_stop'''
    );

    v_new := REPLACE(
        v_new,
        'WHEN COALESCE(tc.return_origin_stop_state, '''') = ''origin_loading_stop'' THEN ''origin_zone''',
        'WHEN UPPER(COALESCE(tc.return_origin_name, '''')) LIKE ''%ZONE%'' THEN ''origin_zone'''
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

