-- =============================================================
-- TAT V2 REFACTOR: Phase 28
-- Feature: Stitch day-split geofence visits (23:59:59 -> 00:00:00)
--          into a continuous operational stop-state visit.
--
-- Why:
--   Raw geofence feeds can split a continuous dwell at midnight into
--   separate rows per day. Without stitching, downstream state machine and
--   reporting can interpret false exit/re-entry transitions.
--
-- Stitch rule:
--   Merge consecutive rows when ALL are true:
--     1) same tracker_id
--     2) same geofence_name
--     3) same stop_state
--     4) current.visit_start_utc <= previous.visit_end_for_overlap_utc + 1 second
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_tat_operational_visit_stream_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    tracker_id                 INTEGER,
    tracker_name               TEXT,
    geofence_name              TEXT,
    stop_state                 TEXT,
    state_rank                 INTEGER,
    visit_start_utc            TIMESTAMPTZ,
    visit_end_utc              TIMESTAMPTZ,
    visit_end_for_overlap_utc  TIMESTAMPTZ,
    dwell_hours                NUMERIC,
    is_open_geofence           BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH tracker_names AS (
    SELECT DISTINCT ON (gv.tracker_id)
        gv.tracker_id,
        COALESCE(NULLIF(gv.tracker_name, ''), '(unknown)') AS tracker_name
    FROM public.geofence_visits gv
    WHERE gv.tracker_id IS NOT NULL
      AND (p_tracker_id IS NULL OR gv.tracker_id = p_tracker_id)
    ORDER BY gv.tracker_id, gv.in_time_dt DESC
),
candidates_base AS (
    SELECT
        n.event_id,
        n.tracker_id,
        COALESCE(tn.tracker_name, '(unknown)') AS tracker_name,
        COALESCE(NULLIF(n.canonical_name, ''), NULLIF(n.raw_geofence_name, ''), '(null)') AS geofence_name,
        n.in_time AS visit_start_utc,
        COALESCE(n.out_time, n.in_time) AS visit_end_utc,
        COALESCE(n.out_time, p_end_date) AS visit_end_for_overlap_utc,
        (n.out_time IS NULL) AS is_open_geofence,
        ROUND(
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(n.out_time, n.in_time) - n.in_time)), 0) / 3600.0,
            2
        ) AS dwell_hours,
        n.priority,
        n.normalization_confidence,
        COALESCE(
            n.canonical_geofence_id::text,
            COALESCE(NULLIF(n.canonical_name, ''), normalize_geofence_name(n.raw_geofence_name), 'unmapped')
        ) AS dedupe_key,
        COALESCE(
            NULLIF(n.stop_state, ''),
            public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)
        ) AS stop_state,
        CASE
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'destination_stop'
                THEN 100
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'origin_loading_stop'
                 AND LOWER(COALESCE(n.role_code, '')) = 'origin_terminal'
                THEN 97
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'origin_loading_stop'
                 AND UPPER(COALESCE(n.canonical_name, '')) = 'KURASINI ZONE'
                THEN 96
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'origin_loading_stop'
                THEN 94
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'customs_stop'
                THEN 90
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'operational_stop'
                THEN 80
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'origin_region_presence'
                THEN 75
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'destination_region_presence'
                THEN 70
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'border_crossing'
                THEN 40
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) IN ('corridor_transit', 'return_transit')
                THEN 30
            ELSE 10
        END AS state_rank,
        UPPER(COALESCE(n.canonical_name, '')) AS canonical_name_up
    FROM public.trip_geofence_events_normalized n
    LEFT JOIN tracker_names tn
        ON tn.tracker_id = n.tracker_id
    WHERE n.tracker_id IS NOT NULL
      AND (p_tracker_id IS NULL OR n.tracker_id = p_tracker_id)
      AND n.in_time <= p_end_date
      AND COALESCE(n.out_time, n.in_time) >= p_start_date
),
ranked AS (
    SELECT
        cb.*,
        ROW_NUMBER() OVER (
            PARTITION BY
                cb.tracker_id,
                cb.visit_start_utc,
                cb.visit_end_utc,
                cb.dedupe_key
            ORDER BY
                cb.state_rank DESC,
                COALESCE(cb.priority, -1) DESC,
                COALESCE(cb.normalization_confidence, 0) DESC,
                cb.event_id ASC
        ) AS rn
    FROM candidates_base cb
),
winner_rows AS (
    SELECT *
    FROM ranked r
    WHERE r.rn = 1
),
filtered AS (
    SELECT w.*
    FROM winner_rows w
    WHERE NOT (
        w.stop_state = 'origin_region_presence'
        AND w.canonical_name_up IN ('DAR GEOFENCE', 'TANGA ZONE', 'BEIRA ZONE', 'MTWARA ZONE', 'MOMBASA ZONE')
        AND EXISTS (
            SELECT 1
            FROM winner_rows x
            WHERE x.tracker_id = w.tracker_id
              AND x.event_id <> w.event_id
              AND x.visit_start_utc < w.visit_end_for_overlap_utc
              AND x.visit_end_for_overlap_utc > w.visit_start_utc
              AND x.stop_state IN ('origin_loading_stop', 'operational_stop')
        )
    )
),
ordered_rows AS (
    SELECT
        f.*,
        LAG(f.geofence_name) OVER (
            PARTITION BY f.tracker_id
            ORDER BY f.visit_start_utc, f.visit_end_for_overlap_utc, f.event_id
        ) AS prev_geofence_name,
        LAG(f.stop_state) OVER (
            PARTITION BY f.tracker_id
            ORDER BY f.visit_start_utc, f.visit_end_for_overlap_utc, f.event_id
        ) AS prev_stop_state,
        LAG(f.visit_end_for_overlap_utc) OVER (
            PARTITION BY f.tracker_id
            ORDER BY f.visit_start_utc, f.visit_end_for_overlap_utc, f.event_id
        ) AS prev_visit_end_for_overlap_utc
    FROM filtered f
),
stitched_tagged AS (
    SELECT
        o.*,
        CASE
            WHEN o.prev_visit_end_for_overlap_utc IS NULL THEN 1
            WHEN o.geofence_name = o.prev_geofence_name
             AND o.stop_state = o.prev_stop_state
             AND o.visit_start_utc <= o.prev_visit_end_for_overlap_utc + INTERVAL '1 second'
                THEN 0
            ELSE 1
        END AS is_new_segment
    FROM ordered_rows o
),
stitched_groups AS (
    SELECT
        st.*,
        SUM(st.is_new_segment) OVER (
            PARTITION BY st.tracker_id
            ORDER BY st.visit_start_utc, st.visit_end_for_overlap_utc, st.event_id
            ROWS UNBOUNDED PRECEDING
        ) AS stitch_group
    FROM stitched_tagged st
),
stitched AS (
    SELECT
        sg.tracker_id,
        MAX(sg.tracker_name) AS tracker_name,
        sg.geofence_name,
        sg.stop_state,
        MAX(sg.state_rank) AS state_rank,
        MIN(sg.visit_start_utc) AS visit_start_utc,
        MAX(sg.visit_end_utc) AS visit_end_utc,
        MAX(sg.visit_end_for_overlap_utc) AS visit_end_for_overlap_utc,
        ROUND(
            GREATEST(
                EXTRACT(EPOCH FROM (MAX(sg.visit_end_for_overlap_utc) - MIN(sg.visit_start_utc))),
                0
            ) / 3600.0,
            2
        ) AS dwell_hours,
        BOOL_OR(sg.is_open_geofence) AS is_open_geofence
    FROM stitched_groups sg
    GROUP BY
        sg.tracker_id,
        sg.stitch_group,
        sg.geofence_name,
        sg.stop_state
)
SELECT
    s.tracker_id,
    s.tracker_name,
    s.geofence_name,
    s.stop_state,
    s.state_rank,
    s.visit_start_utc,
    s.visit_end_utc,
    s.visit_end_for_overlap_utc,
    s.dwell_hours,
    s.is_open_geofence
FROM stitched s
WHERE (
      s.state_rank >= 70
      OR (s.state_rank IN (30, 40) AND s.dwell_hours >= 0.25)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;
