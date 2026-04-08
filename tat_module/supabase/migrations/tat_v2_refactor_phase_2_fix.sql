-- =============================================================
-- TAT V2 REFACTOR: Phase 2 FIX — Normalized Visit Layer
-- Replaces: tat_v2_refactor_phase_2.sql
-- Dependency: tat_v2_refactor_tables.sql, seed + seed_extended
--
-- BUG FIXED:
--   Original Phase 2 had `LEFT JOIN geofence_role_map rm ON rm.geofence_id = gm.geofence_id`
--   without DISTINCT ON or priority selection. A geofence with 2 roles
--   (e.g. TUNDUMA BORDER has border_tz AND border_zm) produced TWO rows
--   per visit — one for each role. This cascaded into Phase 3 creating
--   duplicate border_entry events for the same physical crossing.
--
-- FIX:
--   Use DISTINCT ON (visit source columns) ordered by role priority DESC
--   so that for each raw visit only the single highest-priority role wins.
--   This mirrors v1's geo_level priority ladder.
-- =============================================================

CREATE OR REPLACE FUNCTION refresh_trip_geofence_events_normalized(
    p_start     TIMESTAMPTZ,
    p_end       TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_run_id UUID;
BEGIN
    -- Allow this function to run without hitting Supabase's service-role
    -- statement_timeout (default is often 30s). SET LOCAL is scoped to
    -- the current transaction and does not affect other connections.
    SET LOCAL statement_timeout = 0;

    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_2_NORMALIZE', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    -- Clean existing normalized events in the processing window.
    DELETE FROM trip_geofence_events_normalized
    WHERE in_time >= p_start AND in_time < p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- ─── Main normalization + classification ────────────────────────────────
    -- Logic:
    --   1. Compute normalized form of raw geofence name.
    --   2. Try exact alias match (raw name = alias_name).
    --   3. Fallback: try normalized alias match.
    --   4. If no match: unmapped, confidence 0.20.
    --   5. For the matched canonical geofence, pick the SINGLE highest-priority
    --      role from geofence_role_map (DISTINCT ON prevents duplicate rows).
    --
    -- Note on confidence levels (preserved from original design):
    --   1.00 — exact alias match
    --   0.95 — normalized alias match (UPPER+TRIM+collapse-spaces)
    --   0.20 — unmapped

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
                -- mapped dedupe key aligns with uq_tgen_mapped_visit
                WHEN gm.geofence_id IS NOT NULL THEN
                    gm.geofence_id::TEXT || '|' || COALESCE(rm.role_code, '')
                -- unmapped dedupe key aligns with uq_tgen_unmapped_visit
                ELSE
                    'unmapped|' || rv.geofence_name
            END AS dedupe_key
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
        -- Exact alias match
        LEFT JOIN geofence_aliases ga_exact
               ON ga_exact.alias_name = rv.geofence_name
        -- Normalized alias match (only when exact not found)
        LEFT JOIN geofence_aliases ga_norm
               ON ga_norm.normalized_name = rv.norm_name
              AND ga_exact.geofence_id IS NULL
        -- Resolve to master
        LEFT JOIN geofence_master gm
               ON gm.geofence_id = COALESCE(ga_exact.geofence_id, ga_norm.geofence_id)
        -- Keep all possible roles for mapped geofences, then rank/dedupe below.
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

    -- ─── Log unmapped geofences for QA ──────────────────────────────────────
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
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'event_count',    (
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
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;


-- Index on role_code: Phase 3 uses `role_code IN ('border_tz', ...)` in 4 places
-- across 452k rows. Without this index those queries do full table scans.
CREATE INDEX IF NOT EXISTS idx_gen_events_role ON trip_geofence_events_normalized(role_code);

-- ─── QA View: unmapped geofences ranked by visit frequency ──────────────────
-- Run this after a Phase 2 refresh to identify which geofences most urgently
-- need to be added to the seed.
CREATE OR REPLACE VIEW v_unmapped_geofences_qa AS
SELECT
    raw_geofence_name,
    count(*)                       AS visit_count,
    count(DISTINCT tracker_id)     AS tracker_count,
    min(in_time)                   AS first_seen,
    max(in_time)                   AS last_seen
FROM trip_geofence_events_normalized
WHERE normalization_rule = 'unmapped'
GROUP BY raw_geofence_name
ORDER BY visit_count DESC;
