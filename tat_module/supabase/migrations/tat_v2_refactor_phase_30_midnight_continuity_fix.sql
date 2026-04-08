-- =============================================================
-- TAT V2 REFACTOR: Phase 30
-- Feature: Midnight continuity fix for stop-state trip building
--
-- Problem:
--   Daily report splits (23:59:59 -> 00:00:00) were still creating
--   false new loading sessions when overlapping geofences interleaved
--   in the visit stream ordering.
--
-- Fixes:
--   1) Stitching in get_tat_operational_visit_stream_v2 is now done per
--      (tracker_id, geofence_name, stop_state), not by immediate prior row
--      across all geofences.
--   2) build_trip_state_events_v2 loading/pre-origin sessionization uses
--      +1 second continuity tolerance (for day-boundary splits only).
-- =============================================================

-- -------------------------------------------------------------
-- 1) Operational stream stitching: per geofence+state continuity
-- -------------------------------------------------------------
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
candidates_base_raw AS (
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
            public.map_visit_stop_state_v2(n.canonical_name, n.role_code, NULL)
        ) AS stop_state,
        LOWER(COALESCE(n.role_code, '')) AS role_code_l,
        UPPER(COALESCE(n.canonical_name, '')) AS canonical_name_up
    FROM public.trip_geofence_events_normalized n
    LEFT JOIN tracker_names tn
      ON tn.tracker_id = n.tracker_id
    WHERE n.tracker_id IS NOT NULL
      AND (p_tracker_id IS NULL OR n.tracker_id = p_tracker_id)
      AND n.in_time <= p_end_date
      AND COALESCE(n.out_time, n.in_time) >= p_start_date
),
candidates_base AS (
    SELECT
        cbr.*,
        CASE
            WHEN cbr.stop_state = 'destination_stop'
                THEN 100
            WHEN cbr.stop_state = 'origin_loading_stop'
                 AND cbr.role_code_l = 'origin_terminal'
                THEN 97
            WHEN cbr.stop_state = 'origin_loading_stop'
                 AND cbr.canonical_name_up = 'KURASINI ZONE'
                THEN 96
            WHEN cbr.stop_state = 'origin_loading_stop'
                THEN 94
            WHEN cbr.stop_state = 'customs_stop'
                THEN 90
            WHEN cbr.stop_state = 'operational_stop'
                THEN 80
            WHEN cbr.stop_state = 'origin_region_presence'
                THEN 75
            WHEN cbr.stop_state = 'destination_region_presence'
                THEN 70
            WHEN cbr.stop_state = 'border_crossing'
                THEN 40
            WHEN cbr.stop_state IN ('corridor_transit', 'return_transit')
                THEN 30
            ELSE 10
        END AS state_rank
    FROM candidates_base_raw cbr
),
ranked AS (
    SELECT
        cb.*,
        ROW_NUMBER() OVER (
            PARTITION BY cb.tracker_id, cb.visit_start_utc, cb.visit_end_utc, cb.dedupe_key
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
        LAG(f.visit_end_for_overlap_utc) OVER (
            PARTITION BY f.tracker_id, f.geofence_name, f.stop_state
            ORDER BY f.visit_start_utc, f.visit_end_for_overlap_utc, f.event_id
        ) AS prev_visit_end_for_overlap_utc
    FROM filtered f
),
stitched_tagged AS (
    SELECT
        o.*,
        CASE
            WHEN o.prev_visit_end_for_overlap_utc IS NULL THEN 1
            WHEN o.visit_start_utc <= o.prev_visit_end_for_overlap_utc + INTERVAL '1 second'
                THEN 0
            ELSE 1
        END AS is_new_segment
    FROM ordered_rows o
),
stitched_groups AS (
    SELECT
        st.*,
        SUM(st.is_new_segment) OVER (
            PARTITION BY st.tracker_id, st.geofence_name, st.stop_state
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
        sg.geofence_name,
        sg.stop_state,
        sg.stitch_group
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

-- -------------------------------------------------------------
-- 2) State machine continuity: +1 second day-split tolerance
-- -------------------------------------------------------------
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    v_def := replace(
        v_def,
        $r$WHEN o.prev_max_out >= o.visit_start_utc THEN 0$r$,
        $r$WHEN o.prev_max_out + INTERVAL '1 second' >= o.visit_start_utc THEN 0$r$
    );

    v_def := replace(
        v_def,
        $r$WHEN p.prev_max_out >= p.visit_start_utc THEN 0$r$,
        $r$WHEN p.prev_max_out + INTERVAL '1 second' >= p.visit_start_utc THEN 0$r$
    );

    EXECUTE v_def;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;
