BEGIN;

-- ============================================================================
-- Phase 52: Origin-exit + Origin-region fallback hardening
-- ----------------------------------------------------------------------------
-- Problem:
-- 1) origin_exit can be NULL when truck leaves directly from origin loading zone
--    after loading_end, because origin-exit candidate logic only looks at
--    operational/origin-region stop states and requires visit_start >= loading_end.
-- 2) origin_region can be NULL in facts when trip_anchor_start is filtered out
--    (e.g., stale re-anchored anchor outside trip bounds), despite clear origin zone.
--
-- Fix:
-- 1) In build_trip_state_events_v2, allow origin_loading_stop as origin-exit
--    fallback and use overlap-aware condition on visit_end >= loading_end.
-- 2) In build_tat_trip_facts_v2, fallback origin_region to origin_zone, then
--    origin_gateway around the loading window.
-- ============================================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_old_block TEXT := E'    LEFT JOIN LATERAL (\n        SELECT\n            ov.visit_end_for_overlap_utc AS origin_exit,\n            ov.geofence_name AS origin_exit_name\n        FROM _ops_visits ov\n        WHERE ov.tracker_id = tw.tracker_id\n          AND ov.stop_state IN (''operational_stop'', ''origin_region_presence'')\n          AND ov.visit_start_utc >= ls.session_out\n          AND ov.visit_start_utc < COALESCE(sig.first_signal, tw.window_end)\n        ORDER BY ov.visit_end_for_overlap_utc DESC NULLS LAST, ov.raw_visit_id DESC\n        LIMIT 1\n    ) ox ON true';
    v_new_block TEXT := E'    LEFT JOIN LATERAL (\n        SELECT\n            ov.visit_end_for_overlap_utc AS origin_exit,\n            ov.geofence_name AS origin_exit_name\n        FROM _ops_visits ov\n        WHERE ov.tracker_id = tw.tracker_id\n          AND ov.stop_state IN (''operational_stop'', ''origin_region_presence'', ''origin_loading_stop'')\n          AND COALESCE(ov.visit_end_for_overlap_utc, ov.visit_start_utc) >= ls.session_out\n          AND ov.visit_start_utc < COALESCE(sig.first_signal, tw.window_end)\n        ORDER BY COALESCE(ov.visit_end_for_overlap_utc, ov.visit_start_utc) DESC NULLS LAST, ov.raw_visit_id DESC\n        LIMIT 1\n    ) ox ON true';
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    )
    INTO v_def;

    v_new := REPLACE(v_def, v_old_block, v_new_block);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 52 patch failed: origin_exit lateral block not found in build_trip_state_events_v2.';
    END IF;

    EXECUTE v_new;
END;
$$;

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_old_expr TEXT := '        a.origin_region_name,';
    v_new_expr TEXT := E'        COALESCE(\n            a.origin_region_name,\n            (\n                SELECT n.canonical_name\n                FROM trip_geofence_events_normalized n\n                WHERE n.tracker_id = a.tracker_id\n                  AND n.in_time <= COALESCE(a.l_end, a.l_start)\n                  AND COALESCE(n.out_time, n.in_time) >= a.l_start\n                  AND LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_zone%''\n                ORDER BY COALESCE(n.out_time, n.in_time) DESC, n.in_time DESC\n                LIMIT 1\n            ),\n            (\n                SELECT n.canonical_name\n                FROM trip_geofence_events_normalized n\n                WHERE n.tracker_id = a.tracker_id\n                  AND n.in_time <= COALESCE(a.l_end, a.l_start)\n                  AND COALESCE(n.out_time, n.in_time) >= a.l_start\n                  AND LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_gateway%''\n                ORDER BY COALESCE(n.out_time, n.in_time) DESC, n.in_time DESC\n                LIMIT 1\n            )\n        ),';
BEGIN
    SELECT pg_get_functiondef(
        'public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure
    )
    INTO v_def;

    v_new := REPLACE(v_def, v_old_expr, v_new_expr);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 52 patch failed: origin_region select expression not found in build_tat_trip_facts_v2.';
    END IF;

    EXECUTE v_new;
END;
$$;

COMMIT;
