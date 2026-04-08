-- =============================================================
-- TAT V2 REFACTOR: Phase 22
-- Feature: Ops-yard waiting stage classification for uncovered logic.
--
-- Goal:
--   Treat Asas ops-yard dwell after trip closure as waiting/maintenance stage,
--   not uncovered anomaly.
--
-- Scope:
--   - get_tat_uncovered_trip_summary_v2
--   - get_tat_uncovered_facts_summary_v2
-- =============================================================

-- Phase 21 override: remove visit-gap heuristics from uncovered RPCs
-- =============================================================
CREATE OR REPLACE FUNCTION get_tat_uncovered_trip_summary_v2(
    p_start_date       TIMESTAMPTZ,
    p_end_date         TIMESTAMPTZ,
    p_tracker_id       INTEGER DEFAULT NULL,
    p_orphan_gap_hours NUMERIC DEFAULT 8,
    p_tracker_limit    INTEGER DEFAULT 500,
    p_trip_limit       INTEGER DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH p AS (
        SELECT
            p_start_date AS from_ts,
            p_end_date AS to_ts,
            INTERVAL '0 seconds' AS orphan_gap,
            INTERVAL '0 seconds' AS coverage_buffer
    ),
    facts_scope AS (
        SELECT
            f.tracker_id,
            COALESCE(f.dar_arrival, f.loading_start) AS fact_trip_start_utc,
            COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) AS fact_trip_end_utc,
            CONCAT(
                'FACT:',
                f.tracker_id::text, ':',
                EXTRACT(EPOCH FROM COALESCE(f.dar_arrival, f.loading_start))::bigint::text, ':',
                EXTRACT(EPOCH FROM COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival))::bigint::text
            ) AS fact_trip_key
        FROM public.tat_trip_facts_v2 f
        CROSS JOIN p
        WHERE f.tracker_id IS NOT NULL
          AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
          AND COALESCE(f.dar_arrival, f.loading_start) IS NOT NULL
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) IS NOT NULL
          AND COALESCE(f.dar_arrival, f.loading_start) <= p.to_ts
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) >= p.from_ts
    ),
    raw_scope AS (
        SELECT
            ROW_NUMBER() OVER (
                ORDER BY
                    ov.tracker_id,
                    ov.visit_start_utc,
                    ov.visit_end_utc,
                    COALESCE(ov.geofence_name, '')
            ) AS raw_visit_id,
            ov.tracker_id,
            ov.tracker_name,
            ov.geofence_name,
            ov.stop_state,
            ov.state_rank,
            ov.visit_start_utc,
            ov.visit_end_utc,
            ov.visit_end_for_overlap_utc,
            ov.is_open_geofence
        FROM public.get_tat_operational_visit_stream_v2(
            p_start_date,
            p_end_date,
            p_tracker_id
        ) ov
    ),
    facts_ordered AS (
        SELECT
            fs.tracker_id,
            fs.fact_trip_start_utc,
            fs.fact_trip_end_utc,
            LEAD(fs.fact_trip_start_utc) OVER (
                PARTITION BY fs.tracker_id
                ORDER BY fs.fact_trip_start_utc, fs.fact_trip_end_utc
            ) AS next_fact_trip_start_utc
        FROM facts_scope fs
    ),
    waiting_stage_rows AS (
        SELECT
            rs.*
        FROM raw_scope rs
        WHERE (
                UPPER(COALESCE(rs.geofence_name, '')) LIKE 'ASAS TABATA%'
             OR UPPER(COALESCE(rs.geofence_name, '')) LIKE 'ASAS DAR OFFICE%'
             OR UPPER(COALESCE(rs.geofence_name, '')) LIKE 'ASAS KIBAHA%'
        )
          AND EXISTS (
              SELECT 1
              FROM facts_ordered fo
              WHERE fo.tracker_id = rs.tracker_id
                AND rs.visit_start_utc >= fo.fact_trip_end_utc
                AND (
                    fo.next_fact_trip_start_utc IS NULL
                    OR rs.visit_end_for_overlap_utc <= fo.next_fact_trip_start_utc
                )
          )
    ),
    raw_mapped AS (
        SELECT
            rs.*,
            mf.fact_trip_key AS matched_fact_trip_key
        FROM raw_scope rs
        LEFT JOIN LATERAL (
            SELECT
                fs.fact_trip_key,
                GREATEST(
                    0,
                    EXTRACT(EPOCH FROM
                        LEAST(rs.visit_end_for_overlap_utc, fs.fact_trip_end_utc)
                        - GREATEST(rs.visit_start_utc, fs.fact_trip_start_utc)
                    )
                )::bigint AS overlap_seconds
            FROM facts_scope fs
            CROSS JOIN p
            WHERE fs.tracker_id = rs.tracker_id
              AND rs.visit_start_utc < fs.fact_trip_end_utc
              AND rs.visit_end_for_overlap_utc > fs.fact_trip_start_utc
            ORDER BY
                GREATEST(
                    0,
                    EXTRACT(EPOCH FROM
                        LEAST(rs.visit_end_for_overlap_utc, fs.fact_trip_end_utc)
                        - GREATEST(rs.visit_start_utc, fs.fact_trip_start_utc)
                    )
                ) DESC,
                fs.fact_trip_start_utc
            LIMIT 1
        ) mf ON TRUE
        WHERE NOT EXISTS (
            SELECT 1
            FROM waiting_stage_rows ws
            WHERE ws.raw_visit_id = rs.raw_visit_id
        )
    ),
    orphan_only AS (
        SELECT
            x.*,
            CASE
                WHEN x.prev_visit_end_utc IS NULL THEN 1
                WHEN x.visit_start_utc > x.prev_visit_end_utc THEN 1
                ELSE 0
            END AS is_new_orphan_trip
        FROM (
            SELECT
                rm.*,
                LAG(rm.visit_end_for_overlap_utc) OVER (
                    PARTITION BY rm.tracker_id
                    ORDER BY rm.visit_start_utc, rm.raw_visit_id
                ) AS prev_visit_end_utc
            FROM raw_mapped rm
            WHERE rm.matched_fact_trip_key IS NULL
        ) x
        CROSS JOIN p
    ),
    orphan_tagged AS (
        SELECT
            oo.raw_visit_id,
            oo.tracker_id,
            SUM(oo.is_new_orphan_trip) OVER (
                PARTITION BY oo.tracker_id
                ORDER BY oo.visit_start_utc, oo.raw_visit_id
                ROWS UNBOUNDED PRECEDING
            ) AS orphan_trip_seq
        FROM orphan_only oo
    ),
    orphan_with_trip AS (
        SELECT
            oo.raw_visit_id,
            oo.tracker_id,
            oo.tracker_name,
            oo.geofence_name,
            oo.stop_state,
            oo.state_rank,
            oo.visit_start_utc,
            oo.visit_end_utc,
            oo.visit_end_for_overlap_utc,
            oo.is_open_geofence,
            CONCAT(
                'ORPHAN:',
                oo.tracker_id::text, ':',
                LPAD(COALESCE(ot.orphan_trip_seq, 1)::text, 6, '0')
            ) AS trip_key
        FROM orphan_only oo
        LEFT JOIN orphan_tagged ot
            ON ot.raw_visit_id = oo.raw_visit_id
    ),
    trip_stats AS (
        SELECT
            owt.tracker_id,
            MAX(owt.tracker_name) AS tracker_name,
            owt.trip_key,
            MIN(owt.visit_start_utc) AS trip_start_utc,
            MAX(owt.visit_end_for_overlap_utc) AS trip_end_utc,
            ROUND(
                GREATEST(EXTRACT(EPOCH FROM (MAX(owt.visit_end_for_overlap_utc) - MIN(owt.visit_start_utc))), 0) / 3600.0,
                2
            ) AS trip_duration_hours,
            COUNT(*)::bigint AS trip_raw_geofence_rows,
            COUNT(DISTINCT owt.geofence_name)::bigint AS trip_distinct_geofences,
            COUNT(*) FILTER (WHERE owt.state_rank >= 70)::bigint AS trip_major_state_rows,
            COUNT(*) FILTER (WHERE owt.is_open_geofence)::bigint AS open_geofence_rows
        FROM orphan_with_trip owt
        GROUP BY owt.tracker_id, owt.trip_key
    ),
    trip_last_geofence AS (
        SELECT DISTINCT ON (owt.tracker_id, owt.trip_key)
            owt.tracker_id,
            owt.trip_key,
            owt.geofence_name AS trip_last_geofence_name,
            owt.visit_start_utc AS trip_last_geofence_since_utc
        FROM orphan_with_trip owt
        ORDER BY owt.tracker_id, owt.trip_key, owt.visit_start_utc DESC, owt.raw_visit_id DESC
    ),
    trip_state_mix AS (
        SELECT
            owt.tracker_id,
            owt.trip_key,
            ARRAY_AGG(DISTINCT owt.stop_state ORDER BY owt.stop_state) AS trip_stop_states
        FROM orphan_with_trip owt
        GROUP BY owt.tracker_id, owt.trip_key
    ),
    waiting_tracker_rollup AS (
        SELECT
            ws.tracker_id,
            COUNT(*)::bigint AS waiting_stage_rows,
            ROUND(
                SUM(
                    GREATEST(
                        EXTRACT(EPOCH FROM (ws.visit_end_for_overlap_utc - ws.visit_start_utc)),
                        0
                    ) / 3600.0
                ),
                2
            ) AS waiting_stage_hours
        FROM waiting_stage_rows ws
        GROUP BY ws.tracker_id
    ),
    tracker_rollup AS (
        SELECT
            ts.tracker_id,
            COALESCE(MAX(ts.tracker_name), '(unknown)') AS tracker_name,
            COUNT(*)::bigint AS uncovered_trip_count,
            SUM(ts.trip_raw_geofence_rows)::bigint AS uncovered_raw_geofence_rows,
            SUM(ts.trip_major_state_rows)::bigint AS uncovered_major_state_rows,
            SUM(ts.trip_distinct_geofences)::bigint AS uncovered_distinct_geofences,
            ROUND(SUM(ts.trip_duration_hours), 2) AS uncovered_total_hours,
            SUM(ts.open_geofence_rows)::bigint AS open_geofence_rows,
            MIN(ts.trip_start_utc) AS first_uncovered_trip_start_utc,
            MAX(ts.trip_end_utc) AS last_uncovered_trip_end_utc
        FROM trip_stats ts
        GROUP BY ts.tracker_id
    ),
    tracker_rows AS (
        SELECT
            tr.*,
            COALESCE(wtr.waiting_stage_rows, 0)::bigint AS waiting_stage_rows,
            COALESCE(wtr.waiting_stage_hours, 0)::numeric AS waiting_stage_hours
        FROM tracker_rollup tr
        LEFT JOIN waiting_tracker_rollup wtr
            ON wtr.tracker_id = tr.tracker_id
        ORDER BY tr.uncovered_trip_count DESC, tr.last_uncovered_trip_end_utc DESC NULLS LAST, tr.tracker_id
        LIMIT GREATEST(COALESCE(p_tracker_limit, 500), 1)
    ),
    trip_rows AS (
        SELECT
            ts.tracker_id,
            tr.tracker_name,
            ts.trip_key,
            ts.trip_start_utc,
            ts.trip_end_utc,
            ts.trip_duration_hours,
            ts.trip_raw_geofence_rows,
            ts.trip_major_state_rows,
            ts.trip_distinct_geofences,
            ts.open_geofence_rows,
            tlg.trip_last_geofence_name,
            tlg.trip_last_geofence_since_utc,
            tsm.trip_stop_states
        FROM trip_stats ts
        JOIN tracker_rows tr
            ON tr.tracker_id = ts.tracker_id
        LEFT JOIN trip_last_geofence tlg
            ON tlg.tracker_id = ts.tracker_id
           AND tlg.trip_key = ts.trip_key
        LEFT JOIN trip_state_mix tsm
            ON tsm.tracker_id = ts.tracker_id
           AND tsm.trip_key = ts.trip_key
        ORDER BY ts.trip_end_utc DESC NULLS LAST, ts.tracker_id, ts.trip_start_utc
        LIMIT GREATEST(COALESCE(p_trip_limit, 5000), 1)
    )
    SELECT json_build_object(
        'start_date',               p_start_date,
        'end_date',                 p_end_date,
        'orphan_gap_hours',         0,
        'coverage_buffer_hours',    0,
        'tracker_limit_applied',    GREATEST(COALESCE(p_tracker_limit, 500), 1),
        'trip_limit_applied',       GREATEST(COALESCE(p_trip_limit, 5000), 1),
        'detection_mode',           'stop_state_event_v2',
        'visit_source',             'trip_geofence_events_normalized',
        'waiting_stage_definition', 'ops_yard_post_closure',
        'total_waiting_stage_rows', COALESCE((SELECT SUM(waiting_stage_rows) FROM waiting_tracker_rollup), 0),
        'total_waiting_stage_hours', COALESCE((SELECT ROUND(SUM(waiting_stage_hours), 2) FROM waiting_tracker_rollup), 0),
        'total_uncovered_trips',    COALESCE((SELECT COUNT(*) FROM trip_stats), 0),
        'total_uncovered_trackers', COALESCE((SELECT COUNT(*) FROM tracker_rollup), 0),
        'trackers',                 COALESCE((SELECT json_agg(row_to_json(r)) FROM tracker_rows r), '[]'::json),
        'trips',                    COALESCE((SELECT json_agg(row_to_json(r)) FROM trip_rows r), '[]'::json)
    ) INTO v_result;

    RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION get_tat_uncovered_facts_summary_v2(
    p_start_date       TIMESTAMPTZ,
    p_end_date         TIMESTAMPTZ,
    p_tracker_id       INTEGER DEFAULT NULL,
    p_orphan_gap_hours NUMERIC DEFAULT 8,
    p_tracker_limit    INTEGER DEFAULT 500
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH p AS (
        SELECT
            p_start_date AS from_ts,
            p_end_date AS to_ts,
            INTERVAL '0 seconds' AS orphan_gap,
            INTERVAL '0 seconds' AS coverage_buffer
    ),
    facts_scope AS (
        SELECT
            f.tracker_id,
            COALESCE(f.dar_arrival, f.loading_start) AS fact_trip_start_utc,
            COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) AS fact_trip_end_utc,
            f.status AS fact_status
        FROM public.tat_trip_facts_v2 f
        CROSS JOIN p
        WHERE f.tracker_id IS NOT NULL
          AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
          AND COALESCE(f.dar_arrival, f.loading_start) IS NOT NULL
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) IS NOT NULL
          AND COALESCE(f.dar_arrival, f.loading_start) <= p.to_ts
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) >= p.from_ts
    ),
    raw_scope AS (
        SELECT
            ROW_NUMBER() OVER (
                ORDER BY
                    ov.tracker_id,
                    ov.visit_start_utc,
                    ov.visit_end_utc,
                    COALESCE(ov.geofence_name, '')
            ) AS raw_visit_id,
            ov.tracker_id,
            ov.tracker_name,
            ov.geofence_name,
            ov.stop_state,
            ov.state_rank,
            ov.visit_start_utc,
            ov.visit_end_utc,
            ov.visit_end_for_overlap_utc,
            ov.is_open_geofence
        FROM public.get_tat_operational_visit_stream_v2(
            p_start_date,
            p_end_date,
            p_tracker_id
        ) ov
    ),
    facts_ordered AS (
        SELECT
            fs.tracker_id,
            fs.fact_trip_start_utc,
            fs.fact_trip_end_utc,
            LEAD(fs.fact_trip_start_utc) OVER (
                PARTITION BY fs.tracker_id
                ORDER BY fs.fact_trip_start_utc, fs.fact_trip_end_utc
            ) AS next_fact_trip_start_utc
        FROM facts_scope fs
    ),
    waiting_stage_rows AS (
        SELECT
            rs.*
        FROM raw_scope rs
        WHERE (
                UPPER(COALESCE(rs.geofence_name, '')) LIKE 'ASAS TABATA%'
             OR UPPER(COALESCE(rs.geofence_name, '')) LIKE 'ASAS DAR OFFICE%'
             OR UPPER(COALESCE(rs.geofence_name, '')) LIKE 'ASAS KIBAHA%'
        )
          AND EXISTS (
              SELECT 1
              FROM facts_ordered fo
              WHERE fo.tracker_id = rs.tracker_id
                AND rs.visit_start_utc >= fo.fact_trip_end_utc
                AND (
                    fo.next_fact_trip_start_utc IS NULL
                    OR rs.visit_end_for_overlap_utc <= fo.next_fact_trip_start_utc
                )
          )
    ),
    raw_uncovered AS (
        SELECT rs.*
        FROM raw_scope rs
        WHERE NOT EXISTS (
            SELECT 1
            FROM waiting_stage_rows ws
            WHERE ws.raw_visit_id = rs.raw_visit_id
        )
          AND NOT EXISTS (
            SELECT 1
            FROM facts_scope fs
            CROSS JOIN p
            WHERE fs.tracker_id = rs.tracker_id
              AND rs.visit_start_utc < fs.fact_trip_end_utc
              AND rs.visit_end_for_overlap_utc > fs.fact_trip_start_utc
        )
    ),
    uncovered_only AS (
        SELECT
            x.*,
            CASE
                WHEN x.prev_visit_end_utc IS NULL THEN 1
                WHEN x.visit_start_utc > x.prev_visit_end_utc THEN 1
                ELSE 0
            END AS is_new_orphan_trip
        FROM (
            SELECT
                ru.*,
                LAG(ru.visit_end_for_overlap_utc) OVER (
                    PARTITION BY ru.tracker_id
                    ORDER BY ru.visit_start_utc, ru.raw_visit_id
                ) AS prev_visit_end_utc
            FROM raw_uncovered ru
        ) x
        CROSS JOIN p
    ),
    uncovered_tagged AS (
        SELECT
            uo.*,
            SUM(uo.is_new_orphan_trip) OVER (
                PARTITION BY uo.tracker_id
                ORDER BY uo.visit_start_utc, uo.raw_visit_id
                ROWS UNBOUNDED PRECEDING
            ) AS orphan_trip_seq
        FROM uncovered_only uo
    ),
    uncovered_trip_stats AS (
        SELECT
            ut.tracker_id,
            ut.orphan_trip_seq,
            MIN(ut.visit_start_utc) AS trip_start_utc,
            MAX(ut.visit_end_for_overlap_utc) AS trip_end_utc,
            ROUND(
                GREATEST(EXTRACT(EPOCH FROM (MAX(ut.visit_end_for_overlap_utc) - MIN(ut.visit_start_utc))), 0) / 3600.0,
                2
            ) AS trip_duration_hours,
            COUNT(*)::bigint AS trip_raw_geofence_rows,
            COUNT(DISTINCT ut.geofence_name)::bigint AS trip_distinct_geofences,
            COUNT(*) FILTER (WHERE ut.state_rank >= 70)::bigint AS trip_major_state_rows,
            COUNT(*) FILTER (WHERE ut.is_open_geofence)::bigint AS open_geofence_rows
        FROM uncovered_tagged ut
        GROUP BY ut.tracker_id, ut.orphan_trip_seq
    ),
    uncovered_tracker_summary AS (
        SELECT
            uts.tracker_id,
            COUNT(*)::bigint AS uncovered_trip_count,
            SUM(uts.trip_raw_geofence_rows)::bigint AS uncovered_raw_geofence_rows,
            SUM(uts.trip_major_state_rows)::bigint AS uncovered_major_state_rows,
            SUM(uts.trip_distinct_geofences)::bigint AS uncovered_distinct_geofences,
            ROUND(SUM(uts.trip_duration_hours), 2) AS uncovered_total_hours,
            SUM(uts.open_geofence_rows)::bigint AS open_geofence_rows,
            MIN(uts.trip_start_utc) AS first_uncovered_trip_start_utc,
            MAX(uts.trip_end_utc) AS last_uncovered_trip_end_utc
        FROM uncovered_trip_stats uts
        GROUP BY uts.tracker_id
    ),
    waiting_tracker_rollup AS (
        SELECT
            ws.tracker_id,
            COUNT(*)::bigint AS waiting_stage_rows,
            ROUND(
                SUM(
                    GREATEST(
                        EXTRACT(EPOCH FROM (ws.visit_end_for_overlap_utc - ws.visit_start_utc)),
                        0
                    ) / 3600.0
                ),
                2
            ) AS waiting_stage_hours
        FROM waiting_stage_rows ws
        GROUP BY ws.tracker_id
    ),
    facts_tracker_summary AS (
        SELECT
            fs.tracker_id,
            COUNT(*)::bigint AS fact_trip_count,
            COUNT(*) FILTER (WHERE fs.fact_status = 'completed')::bigint AS fact_completed_count,
            COUNT(*) FILTER (WHERE fs.fact_status = 'returning')::bigint AS fact_returning_count,
            COUNT(*) FILTER (WHERE fs.fact_status IN ('loading', 'pre_transit', 'in_transit', 'at_destination'))::bigint AS fact_unfinished_count
        FROM facts_scope fs
        GROUP BY fs.tracker_id
    ),
    tracker_names AS (
        SELECT
            rs.tracker_id,
            MAX(rs.tracker_name) AS tracker_name
        FROM raw_scope rs
        GROUP BY rs.tracker_id
    ),
    tracker_rows AS (
        SELECT
            uts.tracker_id,
            COALESCE(tn.tracker_name, '(unknown)') AS tracker_name,
            COALESCE(fts.fact_trip_count, 0)::bigint AS fact_trip_count,
            COALESCE(fts.fact_completed_count, 0)::bigint AS fact_completed_count,
            COALESCE(fts.fact_returning_count, 0)::bigint AS fact_returning_count,
            COALESCE(fts.fact_unfinished_count, 0)::bigint AS fact_unfinished_count,
            uts.uncovered_trip_count,
            uts.uncovered_raw_geofence_rows,
            uts.uncovered_major_state_rows,
            uts.uncovered_distinct_geofences,
            uts.uncovered_total_hours,
            uts.open_geofence_rows,
            uts.first_uncovered_trip_start_utc,
            uts.last_uncovered_trip_end_utc,
            COALESCE(wtr.waiting_stage_rows, 0)::bigint AS waiting_stage_rows,
            COALESCE(wtr.waiting_stage_hours, 0)::numeric AS waiting_stage_hours,
            CASE
                WHEN COALESCE(fts.fact_trip_count, 0) > 0
                    THEN ROUND((uts.uncovered_trip_count::numeric / fts.fact_trip_count::numeric) * 100.0, 2)
                ELSE NULL
            END AS uncovered_vs_fact_pct
        FROM uncovered_tracker_summary uts
        LEFT JOIN facts_tracker_summary fts
            ON fts.tracker_id = uts.tracker_id
        LEFT JOIN waiting_tracker_rollup wtr
            ON wtr.tracker_id = uts.tracker_id
        LEFT JOIN tracker_names tn
            ON tn.tracker_id = uts.tracker_id
        ORDER BY uts.uncovered_trip_count DESC, uts.last_uncovered_trip_end_utc DESC NULLS LAST, uts.tracker_id
        LIMIT GREATEST(COALESCE(p_tracker_limit, 500), 1)
    ),
    overall AS (
        SELECT
            COALESCE((SELECT COUNT(*) FROM facts_scope), 0)::bigint AS total_fact_trips,
            COALESCE((SELECT COUNT(DISTINCT tracker_id) FROM facts_scope), 0)::bigint AS total_fact_trackers,
            COALESCE((SELECT COUNT(*) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_trips,
            COALESCE((SELECT COUNT(DISTINCT tracker_id) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_trackers,
            COALESCE((SELECT ROUND(SUM(trip_duration_hours), 2) FROM uncovered_trip_stats), 0)::numeric AS total_uncovered_hours,
            COALESCE((SELECT SUM(trip_raw_geofence_rows) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_raw_geofence_rows,
            COALESCE((SELECT SUM(trip_major_state_rows) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_major_state_rows,
            COALESCE((SELECT SUM(waiting_stage_rows) FROM waiting_tracker_rollup), 0)::bigint AS total_waiting_stage_rows,
            COALESCE((SELECT ROUND(SUM(waiting_stage_hours), 2) FROM waiting_tracker_rollup), 0)::numeric AS total_waiting_stage_hours
    )
    SELECT json_build_object(
        'start_date',                        p_start_date,
        'end_date',                          p_end_date,
        'orphan_gap_hours',         0,
        'coverage_buffer_hours',    0,
        'tracker_limit_applied',             GREATEST(COALESCE(p_tracker_limit, 500), 1),
        'detection_mode',                    'stop_state_event_v2',
        'visit_source',                      'trip_geofence_events_normalized',
        'waiting_stage_definition',          'ops_yard_post_closure',
        'total_fact_trips',                  o.total_fact_trips,
        'total_fact_trackers',               o.total_fact_trackers,
        'total_waiting_stage_rows',          o.total_waiting_stage_rows,
        'total_waiting_stage_hours',         o.total_waiting_stage_hours,
        'total_uncovered_trips',             o.total_uncovered_trips,
        'total_uncovered_trackers',          o.total_uncovered_trackers,
        'total_uncovered_hours',             o.total_uncovered_hours,
        'total_uncovered_raw_geofence_rows', o.total_uncovered_raw_geofence_rows,
        'total_uncovered_major_state_rows',  o.total_uncovered_major_state_rows,
        'uncovered_vs_fact_pct',             CASE
                                                 WHEN o.total_fact_trips > 0
                                                     THEN ROUND((o.total_uncovered_trips::numeric / o.total_fact_trips::numeric) * 100.0, 2)
                                                 ELSE NULL
                                             END,
        'trackers',                          COALESCE((SELECT json_agg(row_to_json(r)) FROM tracker_rows r), '[]'::json)
    ) INTO v_result
    FROM overall o;

    RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_tat_uncovered_trip_summary_v2(
    timestamptz,
    timestamptz,
    integer,
    numeric,
    integer,
    integer
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_tat_uncovered_facts_summary_v2(
    timestamptz,
    timestamptz,
    integer,
    numeric,
    integer
) TO anon, authenticated, service_role;
