BEGIN;

-- ============================================================================
-- Phase 54: Border episode split (ignore daily/raw border row fragmentation)
-- ----------------------------------------------------------------------------
-- Phase 53 introduced second-border split for missed-destination trips, but the
-- previous "OFFSET 1" approach could treat fragmented rows from the same border
-- episode as a second border.
--
-- This patch derives second_border_start from the second *episode* of border
-- crossing visits, using continuity grouping (30-minute gap tolerance).
-- ============================================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_old_block TEXT := E'    LEFT JOIN LATERAL (\n        SELECT\n            ov.visit_start_utc AS second_border_start\n        FROM _ops_visits ov\n        WHERE ov.tracker_id = tw.tracker_id\n          AND ov.stop_state = ''border_crossing''\n          AND ov.visit_start_utc > ls.session_out\n          AND ov.visit_start_utc < tw.window_end\n        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC\n        OFFSET 1\n        LIMIT 1\n    ) b2 ON true';
    v_new_block TEXT := E'    LEFT JOIN LATERAL (\n        WITH border_visits AS (\n            SELECT\n                ov.visit_start_utc,\n                ov.visit_end_for_overlap_utc,\n                ov.raw_visit_id,\n                MAX(ov.visit_end_for_overlap_utc) OVER (\n                    ORDER BY ov.visit_start_utc, ov.raw_visit_id\n                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING\n                ) AS prev_max_out\n            FROM _ops_visits ov\n            WHERE ov.tracker_id = tw.tracker_id\n              AND ov.stop_state = ''border_crossing''\n              AND ov.visit_start_utc > ls.session_out\n              AND ov.visit_start_utc < tw.window_end\n        ),\n        grouped AS (\n            SELECT\n                b.*,\n                SUM(\n                    CASE\n                        WHEN b.prev_max_out IS NULL THEN 1\n                        WHEN b.prev_max_out + INTERVAL ''30 minutes'' >= b.visit_start_utc THEN 0\n                        ELSE 1\n                    END\n                ) OVER (ORDER BY b.visit_start_utc, b.raw_visit_id) AS grp\n            FROM border_visits b\n        ),\n        episodes AS (\n            SELECT MIN(g.visit_start_utc) AS episode_start\n            FROM grouped g\n            GROUP BY g.grp\n            ORDER BY episode_start\n            OFFSET 1\n            LIMIT 1\n        )\n        SELECT episode_start AS second_border_start\n        FROM episodes\n    ) b2 ON true';
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    )
    INTO v_def;

    v_new := REPLACE(v_def, v_old_block, v_new_block);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 54 patch failed: second_border_start block not found in build_trip_state_events_v2.';
    END IF;

    EXECUTE v_new;
END;
$$;

COMMIT;
