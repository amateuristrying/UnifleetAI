-- =============================================================
-- TAT V2 REFACTOR: Phase 24
-- Feature: DAR broad-region handling for stop-state mapping.
--
-- Operational intent:
--   DAR GEOFENCE is a broad origin region container. It should represent
--   region presence (origin_region_presence), not a specific ops-yard stop.
--
-- Rules:
--   1) Persist DAR rows in normalized events as stop_state=origin_region_presence.
--   2) In operational visit stream, suppress DAR origin_region_presence rows
--      when a stronger overlapping origin stop exists (loading/ops).
--   3) Keep state-machine compatibility by allowing origin_region_presence
--      wherever origin_operational_stop is used for pre-origin/return-origin logic.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Canonical-name aware mapping for normalized visits
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
            WHEN UPPER(COALESCE(p_canonical_name, '')) = 'DAR GEOFENCE'
                THEN 'origin_region_presence'
            ELSE public.map_role_to_stop_state_v2(p_role_code, p_trip_stage)
        END;
$$;

CREATE OR REPLACE FUNCTION public.tgen_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.stop_state := COALESCE(
        NULLIF(NEW.stop_state, ''),
        public.map_visit_stop_state_v2(NEW.canonical_name, NEW.role_code, NEW.trip_stage)
    );
    RETURN NEW;
END;
$$;

-- Backfill persisted normalized rows with canonical-aware mapping.
UPDATE public.trip_geofence_events_normalized
SET stop_state = public.map_visit_stop_state_v2(canonical_name, role_code, trip_stage)
WHERE COALESCE(stop_state, '') = ''
   OR UPPER(COALESCE(canonical_name, '')) = 'DAR GEOFENCE';

-- -------------------------------------------------------------
-- 2) Operational visit stream: use persisted stop_state and suppress
--    DAR broad region when specific origin stops overlap.
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
        CASE COALESCE(
            NULLIF(n.stop_state, ''),
            public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)
        )
            WHEN 'destination_stop'            THEN 100
            WHEN 'origin_loading_stop'         THEN 95
            WHEN 'customs_stop'                THEN 90
            WHEN 'origin_operational_stop'     THEN 80
            WHEN 'origin_region_presence'      THEN 75
            WHEN 'destination_region_presence' THEN 70
            WHEN 'border_crossing'             THEN 40
            WHEN 'corridor_transit'            THEN 30
            WHEN 'return_transit'              THEN 30
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
        AND w.canonical_name_up = 'DAR GEOFENCE'
        AND EXISTS (
            SELECT 1
            FROM winner_rows x
            WHERE x.tracker_id = w.tracker_id
              AND x.event_id <> w.event_id
              AND x.visit_start_utc < w.visit_end_for_overlap_utc
              AND x.visit_end_for_overlap_utc > w.visit_start_utc
              AND x.stop_state IN ('origin_loading_stop', 'origin_operational_stop')
        )
    )
)
SELECT
    f.tracker_id,
    f.tracker_name,
    f.geofence_name,
    f.stop_state,
    f.state_rank,
    f.visit_start_utc,
    f.visit_end_utc,
    f.visit_end_for_overlap_utc,
    f.dwell_hours,
    f.is_open_geofence
FROM filtered f
WHERE (
      f.state_rank >= 70
      OR (f.state_rank IN (30, 40) AND f.dwell_hours >= 0.25)
  );
$$;

-- -------------------------------------------------------------
-- 3) State-machine compatibility patch:
--    include origin_region_presence wherever origin_operational_stop
--    is used for pre-origin and return-origin detection.
-- -------------------------------------------------------------
DO $$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    -- pre-origin and origin-exit probes
    v_def := replace(
        v_def,
        $r$ov.stop_state = 'origin_operational_stop'$r$,
        $r$ov.stop_state IN ('origin_operational_stop', 'origin_region_presence')$r$
    );

    -- return-origin closure probe
    v_def := replace(
        v_def,
        $r$ov.stop_state IN ('origin_operational_stop', 'origin_loading_stop')$r$,
        $r$ov.stop_state IN ('origin_operational_stop', 'origin_region_presence', 'origin_loading_stop')$r$
    );

    EXECUTE v_def;
END;
$$;

GRANT EXECUTE ON FUNCTION public.map_visit_stop_state_v2(text, text, text)
TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;
