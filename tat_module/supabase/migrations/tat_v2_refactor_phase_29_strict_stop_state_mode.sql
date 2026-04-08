-- =============================================================
-- TAT V2 REFACTOR: Phase 29
-- Feature: Strict stop-state mode (trip-stage independent mapping)
--
-- Goals:
--   1) Stop-state classification should not depend on trip_stage fallbacks.
--   2) Operational stream should prefer persisted stop_state and use
--      trip-stage-independent fallback only when stop_state is missing.
--   3) Backfill normalized rows to deterministic stop_state values.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Role -> stop-state (strict, no trip_stage fallback)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.map_role_to_stop_state_v2(
    p_role_code TEXT,
    p_trip_stage TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        CASE
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('destination_site', 'customer_site', 'lpg_site')
                THEN 'destination_stop'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('origin_terminal', 'origin_zone')
                THEN 'origin_loading_stop'
            WHEN LOWER(COALESCE(p_role_code, '')) = 'customs_site'
                THEN 'customs_stop'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('ops_yard', 'origin_base', 'origin_gateway', 'origin_region')
                THEN 'operational_stop'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('destination_region', 'local_delivery_site')
                THEN 'destination_region_presence'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('border_tz', 'border_zm', 'border_drc', 'border_other')
                THEN 'border_crossing'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('corridor_checkpoint', 'corridor_region')
                THEN 'corridor_transit'
            ELSE 'other'
        END;
$$;

-- -------------------------------------------------------------
-- 2) Event -> stop-state (strict role fallback, no stage fallback)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.map_event_to_stop_state_v2(
    p_event_code TEXT,
    p_role_code TEXT DEFAULT NULL,
    p_trip_stage TEXT DEFAULT NULL,
    p_event_meta JSONB DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        COALESCE(
            CASE
                WHEN LOWER(COALESCE(p_event_meta->>'stop_state', '')) = 'origin_operational_stop'
                    THEN 'operational_stop'
                ELSE NULLIF(TRIM(COALESCE(p_event_meta->>'stop_state', '')), '')
            END,
            CASE LOWER(COALESCE(p_event_code, ''))
                WHEN 'trip_anchor_start' THEN 'operational_stop'
                WHEN 'loading_start' THEN 'origin_loading_stop'
                WHEN 'loading_end' THEN 'origin_loading_stop'
                WHEN 'origin_exit' THEN 'corridor_transit'
                WHEN 'corridor_entry' THEN 'corridor_transit'
                WHEN 'border_entry' THEN 'border_crossing'
                WHEN 'border_exit' THEN 'border_crossing'
                WHEN 'return_border_entry' THEN 'border_crossing'
                WHEN 'return_border_exit' THEN 'border_crossing'
                WHEN 'customs_entry' THEN 'customs_stop'
                WHEN 'customs_exit' THEN 'customs_stop'
                WHEN 'destination_region_entry' THEN 'destination_region_presence'
                WHEN 'destination_region_exit' THEN 'destination_region_presence'
                WHEN 'destination_entry' THEN 'destination_stop'
                WHEN 'destination_exit' THEN 'destination_stop'
                WHEN 'customer_entry' THEN 'destination_stop'
                WHEN 'customer_exit' THEN 'destination_stop'
                WHEN 'return_leg_start' THEN 'return_transit'
                WHEN 'return_origin_entry' THEN 'operational_stop'
                WHEN 'trip_closed' THEN 'trip_closure'
                ELSE NULL
            END,
            public.map_role_to_stop_state_v2(p_role_code, NULL),
            'other'
        );
$$;

-- -------------------------------------------------------------
-- 3) Canonical-aware visit mapping (strict mode)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.map_visit_stop_state_v2(
    p_canonical_name TEXT,
    p_role_code TEXT,
    p_trip_stage TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        CASE
            WHEN UPPER(COALESCE(p_canonical_name, '')) IN (
                'DAR GEOFENCE',
                'TANGA ZONE',
                'BEIRA ZONE',
                'MTWARA ZONE',
                'MOMBASA ZONE'
            )
                THEN 'origin_region_presence'

            WHEN UPPER(COALESCE(p_canonical_name, '')) = 'KURASINI ZONE'
                THEN 'origin_loading_stop'

            -- ASAS control-tower yards can play multiple roles by resolved role_code.
            WHEN UPPER(COALESCE(p_canonical_name, '')) IN (
                'ASAS IRINGA YARD',
                'ASAS TABATA',
                'ASAS KIBAHA YARD',
                'ASAS DAR OFFICE'
            )
                THEN CASE
                    WHEN LOWER(COALESCE(p_role_code, '')) IN ('customer_site', 'destination_site', 'lpg_site')
                        THEN 'destination_stop'
                    WHEN LOWER(COALESCE(p_role_code, '')) IN ('local_delivery_site', 'destination_region')
                        THEN 'destination_region_presence'
                    WHEN LOWER(COALESCE(p_role_code, '')) IN ('origin_terminal', 'origin_zone')
                        THEN 'origin_loading_stop'
                    ELSE 'operational_stop'
                END

            ELSE public.map_role_to_stop_state_v2(p_role_code, NULL)
        END;
$$;

-- -------------------------------------------------------------
-- 4) Trigger functions (strict mode)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tgen_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.stop_state := COALESCE(
        NULLIF(NEW.stop_state, ''),
        public.map_visit_stop_state_v2(NEW.canonical_name, NEW.role_code, NULL)
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tse_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_stop_state TEXT;
BEGIN
    IF NEW.event_meta IS NULL THEN
        NEW.event_meta := '{}'::jsonb;
    END IF;

    IF COALESCE(NEW.event_meta->>'stop_state', '') = 'origin_operational_stop' THEN
        NEW.event_meta := jsonb_set(NEW.event_meta, '{stop_state}', to_jsonb('operational_stop'::text), true);
    END IF;

    IF COALESCE(NEW.stop_state, '') = 'origin_operational_stop' THEN
        NEW.stop_state := 'operational_stop';
    END IF;

    v_stop_state := COALESCE(
        NULLIF(NEW.stop_state, ''),
        public.map_event_to_stop_state_v2(NEW.event_code, NEW.role_code, NULL, NEW.event_meta)
    );

    NEW.stop_state := v_stop_state;

    IF COALESCE(NEW.event_meta->>'stop_state', '') = '' AND v_stop_state IS NOT NULL THEN
        NEW.event_meta := jsonb_set(NEW.event_meta, '{stop_state}', to_jsonb(v_stop_state), true);
    END IF;

    IF COALESCE(NEW.trip_stage, '') = '' THEN
        NEW.trip_stage := public.map_stop_state_to_trip_stage_v2(v_stop_state, NEW.trip_stage);
    END IF;

    RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 5) Backfill normalized + state events using strict mapping
-- -------------------------------------------------------------
WITH mapped AS (
    SELECT
        n.event_id,
        public.map_visit_stop_state_v2(n.canonical_name, n.role_code, NULL) AS stop_state_new
    FROM public.trip_geofence_events_normalized n
)
UPDATE public.trip_geofence_events_normalized n
SET stop_state = mapped.stop_state_new
FROM mapped
WHERE mapped.event_id = n.event_id
  AND COALESCE(n.stop_state, '') <> COALESCE(mapped.stop_state_new, '');

WITH mapped AS (
    SELECT
        tse.event_id,
        public.map_event_to_stop_state_v2(tse.event_code, tse.role_code, NULL, tse.event_meta) AS stop_state_new,
        public.map_stop_state_to_trip_stage_v2(
            public.map_event_to_stop_state_v2(tse.event_code, tse.role_code, NULL, tse.event_meta),
            tse.trip_stage
        ) AS trip_stage_new
    FROM public.trip_state_events tse
)
UPDATE public.trip_state_events tse
SET
    stop_state = mapped.stop_state_new,
    trip_stage = COALESCE(NULLIF(tse.trip_stage, ''), mapped.trip_stage_new),
    event_meta = CASE
        WHEN COALESCE(tse.event_meta->>'stop_state', '') = ''
            THEN COALESCE(tse.event_meta, '{}'::jsonb) || jsonb_build_object('stop_state', mapped.stop_state_new)
        WHEN COALESCE(tse.event_meta->>'stop_state', '') <> COALESCE(mapped.stop_state_new, '')
            THEN jsonb_set(COALESCE(tse.event_meta, '{}'::jsonb), '{stop_state}', to_jsonb(mapped.stop_state_new), true)
        ELSE tse.event_meta
    END
FROM mapped
WHERE mapped.event_id = tse.event_id
  AND (
      COALESCE(tse.stop_state, '') <> COALESCE(mapped.stop_state_new, '')
      OR COALESCE(tse.event_meta->>'stop_state', '') <> COALESCE(mapped.stop_state_new, '')
      OR COALESCE(tse.trip_stage, '') = ''
  );

-- -------------------------------------------------------------
-- 6) Operational stream (strict stop_state precedence + stitching)
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

GRANT EXECUTE ON FUNCTION public.map_role_to_stop_state_v2(text, text)
TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.map_event_to_stop_state_v2(text, text, text, jsonb)
TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.map_visit_stop_state_v2(text, text, text)
TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;
