-- =============================================================
-- TAT V2 REFACTOR: Phase 37
-- Hotfix for Phase 36 patch:
--   Remove dependency on tc.return_origin_stop_state in
--   build_trip_state_events_v2(), because some function text variants
--   did not acquire that projected column.
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- In return_origin_entry event_meta:
    v_new := regexp_replace(
        v_new,
        '''stop_state'',\s*COALESCE\(tc\.return_origin_stop_state,\s*''operational_stop''\)',
        '''stop_state'', ''operational_stop''',
        'n'
    );

    -- Remove stop_state-dependent role fallback branch in both CASE blocks.
    v_new := regexp_replace(
        v_new,
        E'\\n\\s*WHEN COALESCE\\(tc\\.return_origin_stop_state, ''''\\) = ''origin_loading_stop'' THEN ''origin_zone''',
        '',
        'n'
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

