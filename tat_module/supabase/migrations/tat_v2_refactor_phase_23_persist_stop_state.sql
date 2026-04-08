-- =============================================================
-- TAT V2 REFACTOR: Phase 23
-- Feature: Persist stop_state as a first-class field (no longer transient).
--
-- Why:
--   stop_state currently drives operational logic but is derived at query time.
--   We persist it in core tables so state-machine and analytics can use a stable,
--   queryable field aligned with operational flow.
--
-- Operational flow (target):
--   origin_arrival_stop -> origin_loading_stop -> transit (corridor/border/customs)
--   -> destination_stop -> return transit -> origin_arrival_stop
-- =============================================================

-- -------------------------------------------------------------
-- 1) Canonical role -> stop_state mapping
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
                THEN 'origin_operational_stop'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('destination_region', 'local_delivery_site')
                THEN 'destination_region_presence'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('border_tz', 'border_zm', 'border_drc', 'border_other')
                THEN 'border_crossing'
            WHEN LOWER(COALESCE(p_role_code, '')) IN ('corridor_checkpoint', 'corridor_region')
                THEN 'corridor_transit'
            WHEN LOWER(COALESCE(p_trip_stage, '')) = 'returning'
                THEN 'return_transit'
            WHEN LOWER(COALESCE(p_trip_stage, '')) = 'at_destination'
                THEN 'destination_stop'
            WHEN LOWER(COALESCE(p_trip_stage, '')) IN ('loading', 'pre_transit')
                THEN 'origin_loading_stop'
            WHEN LOWER(COALESCE(p_trip_stage, '')) = 'transit'
                THEN 'corridor_transit'
            ELSE 'other'
        END;
$$;

CREATE OR REPLACE FUNCTION public.map_stop_state_to_trip_stage_v2(
    p_stop_state TEXT,
    p_existing_trip_stage TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        COALESCE(
            CASE LOWER(COALESCE(p_stop_state, ''))
                WHEN 'origin_loading_stop'      THEN 'loading'
                WHEN 'origin_operational_stop'  THEN 'loading'
                WHEN 'corridor_transit'         THEN 'transit'
                WHEN 'border_crossing'          THEN 'transit'
                WHEN 'customs_stop'             THEN 'transit'
                WHEN 'destination_stop'         THEN 'at_destination'
                WHEN 'destination_region_presence' THEN 'at_destination'
                WHEN 'return_transit'           THEN 'returning'
                WHEN 'trip_closure'             THEN 'returning'
                ELSE NULL
            END,
            NULLIF(TRIM(COALESCE(p_existing_trip_stage, '')), '')
        );
$$;

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
            NULLIF(TRIM(COALESCE(p_event_meta->>'stop_state', '')), ''),
            CASE LOWER(COALESCE(p_event_code, ''))
                WHEN 'trip_anchor_start'        THEN 'origin_operational_stop'
                WHEN 'loading_start'            THEN 'origin_loading_stop'
                WHEN 'loading_end'              THEN 'origin_loading_stop'
                WHEN 'origin_exit'              THEN 'corridor_transit'
                WHEN 'corridor_entry'           THEN 'corridor_transit'
                WHEN 'border_entry'             THEN 'border_crossing'
                WHEN 'border_exit'              THEN 'border_crossing'
                WHEN 'return_border_entry'      THEN 'border_crossing'
                WHEN 'return_border_exit'       THEN 'border_crossing'
                WHEN 'customs_entry'            THEN 'customs_stop'
                WHEN 'customs_exit'             THEN 'customs_stop'
                WHEN 'destination_region_entry' THEN 'destination_region_presence'
                WHEN 'destination_region_exit'  THEN 'destination_region_presence'
                WHEN 'destination_entry'        THEN 'destination_stop'
                WHEN 'destination_exit'         THEN 'destination_stop'
                WHEN 'customer_entry'           THEN 'destination_stop'
                WHEN 'customer_exit'            THEN 'destination_stop'
                WHEN 'return_leg_start'         THEN 'return_transit'
                WHEN 'return_origin_entry'      THEN 'origin_operational_stop'
                WHEN 'trip_closed'              THEN 'trip_closure'
                ELSE NULL
            END,
            public.map_role_to_stop_state_v2(p_role_code, p_trip_stage),
            'other'
        );
$$;

-- -------------------------------------------------------------
-- 2) Persist stop_state on normalized visit table
-- -------------------------------------------------------------
ALTER TABLE public.trip_geofence_events_normalized
    ADD COLUMN IF NOT EXISTS stop_state TEXT;

CREATE INDEX IF NOT EXISTS idx_gen_events_stop_state
    ON public.trip_geofence_events_normalized (stop_state)
    WHERE stop_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gen_events_tracker_stop_state_time
    ON public.trip_geofence_events_normalized (tracker_id, stop_state, in_time)
    WHERE stop_state IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tgen_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.stop_state := COALESCE(
        NULLIF(NEW.stop_state, ''),
        public.map_role_to_stop_state_v2(NEW.role_code, NEW.trip_stage)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tgen_set_stop_state_v2 ON public.trip_geofence_events_normalized;

CREATE TRIGGER trg_tgen_set_stop_state_v2
BEFORE INSERT OR UPDATE OF role_code, trip_stage, stop_state
ON public.trip_geofence_events_normalized
FOR EACH ROW
EXECUTE FUNCTION public.tgen_set_stop_state_v2();

UPDATE public.trip_geofence_events_normalized
SET stop_state = public.map_role_to_stop_state_v2(role_code, trip_stage)
WHERE COALESCE(stop_state, '') = '';

-- -------------------------------------------------------------
-- 3) Persist stop_state on trip state-events table
-- -------------------------------------------------------------
ALTER TABLE public.trip_state_events
    ADD COLUMN IF NOT EXISTS stop_state TEXT;

CREATE INDEX IF NOT EXISTS idx_tse_stop_state
    ON public.trip_state_events (stop_state)
    WHERE stop_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tse_tracker_stop_state_time
    ON public.trip_state_events (tracker_id, stop_state, event_time)
    WHERE stop_state IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tse_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_stop_state TEXT;
BEGIN
    v_stop_state := COALESCE(
        NULLIF(NEW.stop_state, ''),
        public.map_event_to_stop_state_v2(NEW.event_code, NEW.role_code, NEW.trip_stage, NEW.event_meta)
    );

    NEW.stop_state := v_stop_state;

    IF NEW.event_meta IS NULL THEN
        NEW.event_meta := '{}'::jsonb;
    END IF;

    IF COALESCE(NEW.event_meta->>'stop_state', '') = '' AND v_stop_state IS NOT NULL THEN
        NEW.event_meta := jsonb_set(NEW.event_meta, '{stop_state}', to_jsonb(v_stop_state), true);
    END IF;

    IF COALESCE(NEW.trip_stage, '') = '' THEN
        NEW.trip_stage := public.map_stop_state_to_trip_stage_v2(v_stop_state, NEW.trip_stage);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tse_set_stop_state_v2 ON public.trip_state_events;

CREATE TRIGGER trg_tse_set_stop_state_v2
BEFORE INSERT OR UPDATE OF event_code, role_code, trip_stage, event_meta, stop_state
ON public.trip_state_events
FOR EACH ROW
EXECUTE FUNCTION public.tse_set_stop_state_v2();

WITH mapped AS (
    SELECT
        tse.event_id,
        public.map_event_to_stop_state_v2(tse.event_code, tse.role_code, tse.trip_stage, tse.event_meta) AS stop_state_new,
        public.map_stop_state_to_trip_stage_v2(
            public.map_event_to_stop_state_v2(tse.event_code, tse.role_code, tse.trip_stage, tse.event_meta),
            tse.trip_stage
        ) AS trip_stage_new
    FROM public.trip_state_events tse
)
UPDATE public.trip_state_events tse
SET
    stop_state = mapped.stop_state_new,
    trip_stage = COALESCE(NULLIF(tse.trip_stage, ''), mapped.trip_stage_new),
    event_meta = CASE
        WHEN COALESCE(tse.event_meta->>'stop_state', '') = '' AND mapped.stop_state_new IS NOT NULL
            THEN COALESCE(tse.event_meta, '{}'::jsonb) || jsonb_build_object('stop_state', mapped.stop_state_new)
        ELSE tse.event_meta
    END
FROM mapped
WHERE mapped.event_id = tse.event_id
  AND (
      COALESCE(tse.stop_state, '') = ''
      OR COALESCE(tse.event_meta->>'stop_state', '') = ''
      OR COALESCE(tse.trip_stage, '') = ''
  );

-- -------------------------------------------------------------
-- 4) Re-point operational visit stream to persisted stop_state
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
        COALESCE(NULLIF(n.stop_state, ''), public.map_role_to_stop_state_v2(n.role_code, n.trip_stage)) AS stop_state,
        CASE COALESCE(NULLIF(n.stop_state, ''), public.map_role_to_stop_state_v2(n.role_code, n.trip_stage))
            WHEN 'destination_stop'            THEN 100
            WHEN 'origin_loading_stop'         THEN 95
            WHEN 'customs_stop'                THEN 90
            WHEN 'origin_operational_stop'     THEN 80
            WHEN 'destination_region_presence' THEN 70
            WHEN 'border_crossing'             THEN 40
            WHEN 'corridor_transit'            THEN 30
            WHEN 'return_transit'              THEN 30
            ELSE 10
        END AS state_rank
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
)
SELECT
    r.tracker_id,
    r.tracker_name,
    r.geofence_name,
    r.stop_state,
    r.state_rank,
    r.visit_start_utc,
    r.visit_end_utc,
    r.visit_end_for_overlap_utc,
    r.dwell_hours,
    r.is_open_geofence
FROM ranked r
WHERE r.rn = 1
  AND (
      r.state_rank >= 70
      OR (r.state_rank IN (30, 40) AND r.dwell_hours >= 0.25)
  );
$$;

GRANT EXECUTE ON FUNCTION public.map_role_to_stop_state_v2(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.map_stop_state_to_trip_stage_v2(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.map_event_to_stop_state_v2(text, text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(timestamptz, timestamptz, integer) TO anon, authenticated, service_role;
