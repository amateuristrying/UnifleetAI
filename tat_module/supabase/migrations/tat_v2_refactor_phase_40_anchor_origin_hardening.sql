-- =============================================================
-- TAT V2 REFACTOR: Phase 40
-- Anchor / origin hardening:
--   1) Prevent ASAS IRINGA YARD from acting as:
--      - trip_anchor_start source
--      - return_origin_entry source
--      - trip closure return-origin source
--      - previous-trip return-origin re-anchor source
--   2) Protect facts origin_region derivation from legacy Iringa anchors.
-- =============================================================

DO $$
DECLARE
    v_state_def TEXT;
    v_state_new TEXT;
    v_facts_def TEXT;
    v_facts_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_state_def;

    v_state_new := v_state_def;

    -- A) Do not emit trip_anchor_start from ASAS IRINGA YARD.
    v_state_new := regexp_replace(
        v_state_new,
        'WHERE tc\.pre_origin_in IS NOT NULL',
        E'WHERE tc.pre_origin_in IS NOT NULL\n      AND UPPER(COALESCE(tc.pre_origin_name, '''')) <> ''ASAS IRINGA YARD''',
        'n'
    );

    -- B) Exclude ASAS IRINGA YARD from return-origin candidate selection.
    v_state_new := REPLACE(
        v_state_new,
        'AND ov.visit_start_utc > COALESCE(
                dse.dest_exit,
                dre.dest_region_exit,
                ds.dest_entry,
                dr.dest_region_entry,
                ls.session_out
          )
          AND ov.visit_start_utc < tw.window_end',
        'AND ov.visit_start_utc > COALESCE(
                dse.dest_exit,
                dre.dest_region_exit,
                ds.dest_entry,
                dr.dest_region_entry,
                ls.session_out
          )
          AND ov.visit_start_utc < tw.window_end
          AND UPPER(COALESCE(ov.geofence_name, '''')) <> ''ASAS IRINGA YARD'''
    );

    -- C) Do not emit return_origin_entry / trip_closed from ASAS IRINGA YARD.
    v_state_new := REPLACE(
        v_state_new,
        'WHERE tc.return_origin_entry IS NOT NULL',
        E'WHERE tc.return_origin_entry IS NOT NULL\n      AND UPPER(COALESCE(tc.return_origin_name, '''')) <> ''ASAS IRINGA YARD'''
    );

    -- D) Do not re-anchor next trip from ASAS IRINGA YARD return-origin events.
    v_state_new := REPLACE(
        v_state_new,
        'AND p.event_code = ''return_origin_entry''',
        E'AND p.event_code = ''return_origin_entry''\n              AND UPPER(COALESCE(p.canonical_name, '''')) <> ''ASAS IRINGA YARD'''
    );

    IF v_state_new <> v_state_def THEN
        EXECUTE v_state_new;
    END IF;

    SELECT pg_get_functiondef('public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_facts_def;

    v_facts_new := v_facts_def;

    -- E) Facts guard: never publish ASAS IRINGA YARD as origin_region_name.
    v_facts_new := REPLACE(
        v_facts_new,
        'MAX(e.canonical_name)
                FILTER (WHERE e.event_code = ''trip_anchor_start'')    AS origin_region_name,',
        'MAX(e.canonical_name)
                FILTER (WHERE e.event_code = ''trip_anchor_start''
                           AND UPPER(COALESCE(e.canonical_name, '''')) <> ''ASAS IRINGA YARD'') AS origin_region_name,'
    );

    IF v_facts_new <> v_facts_def THEN
        EXECUTE v_facts_new;
    END IF;
END;
$$;
