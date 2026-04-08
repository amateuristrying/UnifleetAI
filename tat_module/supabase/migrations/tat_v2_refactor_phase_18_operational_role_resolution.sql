-- =============================================================
-- TAT V2 REFACTOR: Phase 18
-- Fix: Operational role resolution for normalized geofence visits.
--
-- Problem:
--   A single raw visit can currently survive with multiple role interpretations
--   (same tracker + in/out + canonical geofence, different role_code), which
--   later causes state/fact ambiguity (e.g. corridor + local_delivery at once).
--
-- Change:
--   1) Enforce one mapped normalized row per logical raw visit
--      (tracker_id, in_time, out_time, canonical_geofence_id).
--   2) Replace Phase-2 refresh with operational role precedence that prefers
--      strong transit/corridor/border semantics over weak destination surrogates.
-- =============================================================

-- 1) Collapse existing mapped duplicates to a single operational winner.
WITH ranked_mapped AS (
    SELECT
        event_id,
        ROW_NUMBER() OVER (
            PARTITION BY
                tracker_id,
                in_time,
                out_time,
                canonical_geofence_id
            ORDER BY
                CASE role_code
                    WHEN 'origin_terminal'     THEN 100
                    WHEN 'destination_site'    THEN 95
                    WHEN 'customer_site'       THEN 94
                    WHEN 'lpg_site'            THEN 93
                    WHEN 'border_tz'           THEN 90
                    WHEN 'border_zm'           THEN 90
                    WHEN 'border_drc'          THEN 90
                    WHEN 'border_other'        THEN 89
                    WHEN 'customs_site'        THEN 85
                    WHEN 'corridor_checkpoint' THEN 80
                    WHEN 'corridor_region'     THEN 78
                    WHEN 'origin_gateway'      THEN 72
                    WHEN 'origin_zone'         THEN 70
                    WHEN 'ops_yard'            THEN 65
                    WHEN 'origin_base'         THEN 64
                    WHEN 'destination_region'  THEN 45
                    WHEN 'local_delivery_site' THEN 40
                    ELSE 10
                END DESC,
                COALESCE(priority, -1) DESC,
                CASE normalization_rule
                    WHEN 'exact_alias' THEN 2
                    WHEN 'normalized_alias' THEN 1
                    ELSE 0
                END DESC,
                COALESCE(normalization_confidence, 0) DESC,
                created_at ASC,
                event_id ASC
        ) AS rn
    FROM trip_geofence_events_normalized
    WHERE canonical_geofence_id IS NOT NULL
)
DELETE FROM trip_geofence_events_normalized t
USING ranked_mapped r
WHERE t.event_id = r.event_id
  AND r.rn > 1;

-- 2) Replace mapped uniqueness to enforce one canonical role per visit.
DROP INDEX IF EXISTS uq_tgen_mapped_visit;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tgen_mapped_visit_single
ON trip_geofence_events_normalized (
    tracker_id,
    in_time,
    out_time,
    canonical_geofence_id
)
WHERE canonical_geofence_id IS NOT NULL;

-- 3) Force-replace Phase-2 normalization function with operational role winner logic.
CREATE OR REPLACE FUNCTION refresh_trip_geofence_events_normalized(
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_run_id UUID;
BEGIN
    SET LOCAL statement_timeout = 0;

    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_2_NORMALIZE', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    DELETE FROM trip_geofence_events_normalized
    WHERE in_time >= p_start
      AND in_time  < p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    INSERT INTO trip_geofence_events_normalized (
        tracker_id, in_time, out_time, raw_geofence_name,
        canonical_geofence_id, canonical_name,
        role_code, trip_stage, country_code, priority,
        normalization_rule, normalization_confidence
    )
    WITH candidates AS (
        SELECT
            rv.tracker_id,
            rv.in_time_dt AS in_time,
            rv.out_time_dt AS out_time,
            rv.geofence_name AS raw_geofence_name,
            gm.geofence_id AS canonical_geofence_id,
            gm.canonical_name,
            rm.role_code,
            rm.trip_stage,
            gm.country_code,
            rm.priority,
            CASE
                WHEN ga_exact.geofence_id IS NOT NULL THEN 'exact_alias'
                WHEN ga_norm.geofence_id  IS NOT NULL THEN 'normalized_alias'
                ELSE 'unmapped'
            END AS normalization_rule,
            CASE
                WHEN ga_exact.geofence_id IS NOT NULL THEN 1.00
                WHEN ga_norm.geofence_id  IS NOT NULL THEN 0.95
                ELSE 0.20
            END AS normalization_confidence,
            CASE
                WHEN ga_exact.geofence_id IS NOT NULL THEN 2
                WHEN ga_norm.geofence_id  IS NOT NULL THEN 1
                ELSE 0
            END AS match_rank,
            CASE
                WHEN gm.geofence_id IS NOT NULL THEN gm.geofence_id::TEXT
                ELSE 'unmapped|' || rv.geofence_name
            END AS dedupe_key,
            CASE rm.role_code
                WHEN 'origin_terminal'     THEN 100
                WHEN 'destination_site'    THEN 95
                WHEN 'customer_site'       THEN 94
                WHEN 'lpg_site'            THEN 93
                WHEN 'border_tz'           THEN 90
                WHEN 'border_zm'           THEN 90
                WHEN 'border_drc'          THEN 90
                WHEN 'border_other'        THEN 89
                WHEN 'customs_site'        THEN 85
                WHEN 'corridor_checkpoint' THEN 80
                WHEN 'corridor_region'     THEN 78
                WHEN 'origin_gateway'      THEN 72
                WHEN 'origin_zone'         THEN 70
                WHEN 'ops_yard'            THEN 65
                WHEN 'origin_base'         THEN 64
                WHEN 'destination_region'  THEN 45
                WHEN 'local_delivery_site' THEN 40
                ELSE 10
            END AS role_rank
        FROM (
            SELECT
                tracker_id,
                in_time_dt,
                out_time_dt,
                geofence_name,
                normalize_geofence_name(geofence_name) AS norm_name
            FROM public.geofence_visits
            WHERE in_time_dt >= p_start
              AND in_time_dt  < p_end
              AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
        ) rv
        LEFT JOIN geofence_aliases ga_exact
               ON ga_exact.alias_name = rv.geofence_name
        LEFT JOIN geofence_aliases ga_norm
               ON ga_norm.normalized_name = rv.norm_name
              AND ga_exact.geofence_id IS NULL
        LEFT JOIN geofence_master gm
               ON gm.geofence_id = COALESCE(ga_exact.geofence_id, ga_norm.geofence_id)
        LEFT JOIN geofence_role_map rm
               ON rm.geofence_id = gm.geofence_id
    ),
    ranked AS (
        SELECT
            c.*,
            ROW_NUMBER() OVER (
                PARTITION BY c.tracker_id, c.in_time, c.out_time, c.dedupe_key
                ORDER BY
                    c.match_rank DESC,
                    c.role_rank DESC,
                    COALESCE(c.priority, -1) DESC,
                    c.raw_geofence_name ASC
            ) AS rn
        FROM candidates c
    )
    SELECT
        tracker_id,
        in_time,
        out_time,
        raw_geofence_name,
        canonical_geofence_id,
        canonical_name,
        role_code,
        trip_stage,
        country_code,
        priority,
        normalization_rule,
        normalization_confidence
    FROM ranked
    WHERE rn = 1
    ON CONFLICT DO NOTHING;

    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, issue_type, severity, description, context
    )
    SELECT
        v_run_id,
        tracker_id,
        'unmapped_geofence',
        'medium',
        'Visit not matched to any canonical geofence: ' || raw_geofence_name,
        jsonb_build_object('raw_name', raw_geofence_name, 'in_time', in_time)
    FROM trip_geofence_events_normalized
    WHERE normalization_rule = 'unmapped'
      AND in_time >= p_start
      AND in_time  < p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND NOT EXISTS (
          SELECT 1
          FROM tat_data_quality_issues dq
          WHERE dq.run_id      = v_run_id
            AND dq.issue_type  = 'unmapped_geofence'
            AND dq.tracker_id  = trip_geofence_events_normalized.tracker_id
            AND dq.description = 'Visit not matched to any canonical geofence: '
                                 || trip_geofence_events_normalized.raw_geofence_name
      )
    ON CONFLICT DO NOTHING;

    UPDATE tat_refactor_runs
    SET status = 'completed',
        end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'event_count', (
                SELECT count(*)
                FROM trip_geofence_events_normalized
                WHERE in_time >= p_start AND in_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'unmapped_count', (
                SELECT count(*)
                FROM trip_geofence_events_normalized
                WHERE in_time >= p_start AND in_time < p_end
                  AND normalization_rule = 'unmapped'
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'unmapped_distinct_names', (
                SELECT count(DISTINCT raw_geofence_name)
                FROM trip_geofence_events_normalized
                WHERE in_time >= p_start AND in_time < p_end
                  AND normalization_rule = 'unmapped'
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            )
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    UPDATE tat_refactor_runs
    SET status = 'failed',
        end_time = clock_timestamp(),
        error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;

ANALYZE trip_geofence_events_normalized;

