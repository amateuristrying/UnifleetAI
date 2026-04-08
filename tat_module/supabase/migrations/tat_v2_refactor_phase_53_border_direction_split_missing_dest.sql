BEGIN;

-- ============================================================================
-- Phase 53: Border direction split for missed-destination trips
-- ----------------------------------------------------------------------------
-- Problem:
--   For trips without destination signals, outbound and return border events
--   were both derived from the same border window (> loading_end), causing
--   identical outbound/return timestamps and double counting.
--
-- Fix:
--   1) Compute `second_border_start` in _trip_context.
--   2) Derive:
--        - outbound_border_cutoff : first destination signal, else second border
--        - return_border_start    : destination return threshold, else second border
--   3) Outbound border events end at outbound_border_cutoff.
--   4) Return border events start at return_border_start and only when present.
-- ============================================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_old_select TEXT := E'        CASE\n            WHEN ds.dest_entry IS NOT NULL AND dr.dest_region_entry IS NOT NULL\n                THEN LEAST(ds.dest_entry, dr.dest_region_entry)\n            ELSE COALESCE(ds.dest_entry, dr.dest_region_entry)\n        END AS first_destination_signal,\n        ro.return_origin_entry,\n        ro.return_origin_name';
    v_new_select TEXT := E'        CASE\n            WHEN ds.dest_entry IS NOT NULL AND dr.dest_region_entry IS NOT NULL\n                THEN LEAST(ds.dest_entry, dr.dest_region_entry)\n            ELSE COALESCE(ds.dest_entry, dr.dest_region_entry)\n        END AS first_destination_signal,\n        CASE\n            WHEN ds.dest_entry IS NOT NULL AND dr.dest_region_entry IS NOT NULL\n                THEN LEAST(ds.dest_entry, dr.dest_region_entry)\n            ELSE COALESCE(ds.dest_entry, dr.dest_region_entry, b2.second_border_start)\n        END AS outbound_border_cutoff,\n        CASE\n            WHEN ds.dest_entry IS NOT NULL OR dr.dest_region_entry IS NOT NULL\n                THEN COALESCE(\n                    dse.dest_exit,\n                    dre.dest_region_exit,\n                    ds.dest_entry,\n                    dr.dest_region_entry,\n                    ls.session_out\n                )\n            ELSE b2.second_border_start\n        END AS return_border_start,\n        ro.return_origin_entry,\n        ro.return_origin_name';
    v_old_join TEXT := E'    ) dre ON true\n    LEFT JOIN LATERAL (\n        SELECT\n            ov.visit_start_utc AS return_origin_entry,';
    v_new_join TEXT := E'    ) dre ON true\n    LEFT JOIN LATERAL (\n        SELECT\n            ov.visit_start_utc AS second_border_start\n        FROM _ops_visits ov\n        WHERE ov.tracker_id = tw.tracker_id\n          AND ov.stop_state = ''border_crossing''\n          AND ov.visit_start_utc > ls.session_out\n          AND ov.visit_start_utc < tw.window_end\n        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC\n        OFFSET 1\n        LIMIT 1\n    ) b2 ON true\n    LEFT JOIN LATERAL (\n        SELECT\n            ov.visit_start_utc AS return_origin_entry,';
    v_old_outbound_cap TEXT := E'AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end)\n    CROSS JOIN LATERAL resolve_border_code(ov.geofence_name) rb;';
    v_new_outbound_cap TEXT := E'AND ov.visit_start_utc < COALESCE(tc.outbound_border_cutoff, tc.window_end)\n    CROSS JOIN LATERAL resolve_border_code(ov.geofence_name) rb;';
    v_old_return_gate TEXT := E'AND ov.visit_start_utc > COALESCE(\n            tc.dest_exit,\n            tc.dest_region_exit,\n            tc.dest_entry,\n            tc.dest_region_entry,\n            tc.loading_end\n     )\n     AND ov.visit_start_utc < tc.window_end';
    v_new_return_gate TEXT := E'AND tc.return_border_start IS NOT NULL\n     AND ov.visit_start_utc >= tc.return_border_start\n     AND ov.visit_start_utc < tc.window_end';
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    )
    INTO v_def;

    v_new := v_def;

    v_new := REPLACE(v_new, v_old_select, v_new_select);
    v_new := REPLACE(v_new, v_old_join, v_new_join);
    v_new := REPLACE(v_new, v_old_outbound_cap, v_new_outbound_cap);
    v_new := REPLACE(v_new, v_old_return_gate, v_new_return_gate);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 53 patch failed: no changes applied to build_trip_state_events_v2.';
    END IF;

    EXECUTE v_new;
END;
$$;

COMMIT;
