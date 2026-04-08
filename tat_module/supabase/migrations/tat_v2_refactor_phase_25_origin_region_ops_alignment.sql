-- =============================================================
-- TAT V2 REFACTOR: Phase 25
-- Feature: Origin-region + ops/customer role realignment.
--
-- User-driven policy updates:
--   1) MOSHI TOTAL FUEL DEPOT => customer_site (TZ local customer)
--   2) TANGA PARKING          => ops_yard
--   3) Broad origin-region presence set:
--        DAR GEOFENCE, TANGA ZONE, BEIRA ZONE, MTWARA ZONE, MOMBASA ZONE
--   4) KURASINI ZONE is a terminal-zone fallback when terminal is missing.
--   5) ASAS IRINGA YARD + ASAS TABATA behave as central ops yards,
--      while mapping function supports future multi-role stop-state outcomes.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Canonical role/taxonomy updates in metadata
-- -------------------------------------------------------------
WITH role_updates AS (
    SELECT *
    FROM (
        VALUES
            ('MOSHI TOTAL FUEL DEPOT', 'customer_site', 'at_destination', 10, 'customer', 'TZ'),
            ('TANGA PARKING',          'ops_yard',      'pre_transit',     2, 'yard',     'TZ'),
            ('ASAS IRINGA YARD',       'ops_yard',      'pre_transit',     2, 'yard',     'TZ'),
            ('ASAS TABATA',            'ops_yard',      'pre_transit',     2, 'yard',     'TZ')
    ) AS t(canonical_name, role_code, trip_stage, priority, site_type, country_code)
)
INSERT INTO geofence_master (canonical_name, default_role_code, site_type, country_code)
SELECT
    ru.canonical_name,
    ru.role_code,
    ru.site_type,
    ru.country_code
FROM role_updates ru
ON CONFLICT (canonical_name) DO UPDATE
SET
    default_role_code = EXCLUDED.default_role_code,
    site_type = EXCLUDED.site_type,
    country_code = EXCLUDED.country_code,
    is_active = TRUE;

WITH role_updates AS (
    SELECT *
    FROM (
        VALUES
            ('MOSHI TOTAL FUEL DEPOT', 'customer_site', 'at_destination', 10),
            ('TANGA PARKING',          'ops_yard',      'pre_transit',     2),
            ('ASAS IRINGA YARD',       'ops_yard',      'pre_transit',     2),
            ('ASAS TABATA',            'ops_yard',      'pre_transit',     2)
    ) AS t(canonical_name, role_code, trip_stage, priority)
)
INSERT INTO geofence_role_map (geofence_id, role_code, trip_stage, priority)
SELECT
    gm.geofence_id,
    ru.role_code,
    ru.trip_stage,
    ru.priority
FROM role_updates ru
JOIN geofence_master gm
  ON gm.canonical_name = ru.canonical_name
ON CONFLICT (geofence_id, role_code) DO UPDATE
SET
    trip_stage = EXCLUDED.trip_stage,
    priority = EXCLUDED.priority;

-- Keep these canonicals single-role to avoid mixed-role ambiguity in normalized scans.
DELETE FROM geofence_role_map rm
USING geofence_master gm
WHERE rm.geofence_id = gm.geofence_id
  AND (
        (gm.canonical_name = 'MOSHI TOTAL FUEL DEPOT' AND rm.role_code <> 'customer_site')
     OR (gm.canonical_name = 'TANGA PARKING'          AND rm.role_code <> 'ops_yard')
     OR (gm.canonical_name = 'ASAS IRINGA YARD'       AND rm.role_code <> 'ops_yard')
     OR (gm.canonical_name = 'ASAS TABATA'            AND rm.role_code <> 'ops_yard')
  );

-- Helpful alias normalization for yard naming variants.
INSERT INTO geofence_aliases (geofence_id, alias_name, normalized_name)
SELECT
    gm.geofence_id,
    alias_name,
    normalize_geofence_name(alias_name)
FROM geofence_master gm
JOIN (
    VALUES
        ('ASAS TABATA',      'ASAS TABATA YARD'),
        ('ASAS IRINGA YARD', 'ASAS IRINGA YARD')
) a(canonical_name, alias_name)
  ON a.canonical_name = gm.canonical_name
ON CONFLICT (alias_name) DO NOTHING;

-- -------------------------------------------------------------
-- 2) Canonical-aware stop-state mapping update
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
            -- Broad origin regions (presence only), not operational yard/loading stops.
            WHEN UPPER(COALESCE(p_canonical_name, '')) IN (
                'DAR GEOFENCE',
                'TANGA ZONE',
                'BEIRA ZONE',
                'MTWARA ZONE',
                'MOMBASA ZONE'
            )
                THEN 'origin_region_presence'

            -- Explicit terminal-zone fallback at origin when terminal signal is missing.
            WHEN UPPER(COALESCE(p_canonical_name, '')) = 'KURASINI ZONE'
                THEN 'origin_loading_stop'

            -- Central ops-control yards.
            -- Default behavior is ops/idle waiting; future role-stage variants can
            -- still map to destination/loading outcomes if source role/stage changes.
            WHEN UPPER(COALESCE(p_canonical_name, '')) IN ('ASAS IRINGA YARD', 'ASAS TABATA')
                THEN CASE
                    WHEN LOWER(COALESCE(p_trip_stage, '')) IN ('at_destination', 'destination')
                        OR LOWER(COALESCE(p_role_code, '')) IN ('customer_site', 'destination_site', 'lpg_site', 'local_delivery_site', 'destination_region')
                        THEN 'destination_stop'
                    WHEN LOWER(COALESCE(p_role_code, '')) IN ('origin_terminal', 'origin_zone')
                        OR LOWER(COALESCE(p_trip_stage, '')) = 'loading'
                        THEN 'origin_loading_stop'
                    ELSE 'origin_operational_stop'
                END

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

-- -------------------------------------------------------------
-- 3) Backfill impacted normalized rows (role + stop_state)
-- -------------------------------------------------------------
UPDATE public.trip_geofence_events_normalized
SET
    role_code = 'customer_site',
    trip_stage = 'at_destination',
    priority = 10,
    country_code = 'TZ'
WHERE canonical_name = 'MOSHI TOTAL FUEL DEPOT';

UPDATE public.trip_geofence_events_normalized
SET
    role_code = 'ops_yard',
    trip_stage = 'pre_transit',
    priority = 2,
    country_code = 'TZ'
WHERE canonical_name IN ('TANGA PARKING', 'ASAS IRINGA YARD', 'ASAS TABATA');

UPDATE public.trip_geofence_events_normalized
SET stop_state = public.map_visit_stop_state_v2(canonical_name, role_code, trip_stage)
WHERE COALESCE(stop_state, '') = ''
   OR canonical_name IN (
        'DAR GEOFENCE',
        'TANGA ZONE',
        'BEIRA ZONE',
        'MTWARA ZONE',
        'MOMBASA ZONE',
        'KURASINI ZONE',
        'TANGA PARKING',
        'MOSHI TOTAL FUEL DEPOT',
        'ASAS IRINGA YARD',
        'ASAS TABATA'
   );

-- -------------------------------------------------------------
-- 4) Operational stream update:
--    - Prefer terminal over zone within origin_loading_stop.
--    - Keep KURASINI ZONE as explicit fallback terminal-zone.
--    - Suppress broad origin-region presence when stronger overlap exists.
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
            WHEN COALESCE(NULLIF(n.stop_state, ''), public.map_visit_stop_state_v2(n.canonical_name, n.role_code, n.trip_stage)) = 'origin_operational_stop'
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
-- 5) Keep state-machine compatibility for origin region presence
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
        $r$ov.stop_state = 'origin_operational_stop'$r$,
        $r$ov.stop_state IN ('origin_operational_stop', 'origin_region_presence')$r$
    );

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
