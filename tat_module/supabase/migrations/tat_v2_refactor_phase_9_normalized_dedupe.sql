-- =============================================================
-- TAT V2 REFACTOR: Phase 9 — Normalized Event Dedupe Hardening
-- Purpose:
--   1) Remove existing duplicate normalized rows that represent
--      the same logical visit.
--   2) Enforce uniqueness so future Phase 2 refresh runs remain
--      idempotent even when source data contains alias-overlap rows.
-- =============================================================

-- 1) Deduplicate mapped rows (same tracker/time/canonical/role).
WITH ranked_mapped AS (
    SELECT
        event_id,
        ROW_NUMBER() OVER (
            PARTITION BY
                tracker_id,
                in_time,
                out_time,
                canonical_geofence_id,
                COALESCE(role_code, '')
            ORDER BY
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

-- 2) Deduplicate unmapped rows (same tracker/time/raw_name).
WITH ranked_unmapped AS (
    SELECT
        event_id,
        ROW_NUMBER() OVER (
            PARTITION BY
                tracker_id,
                in_time,
                out_time,
                raw_geofence_name
            ORDER BY
                created_at ASC,
                event_id ASC
        ) AS rn
    FROM trip_geofence_events_normalized
    WHERE canonical_geofence_id IS NULL
)
DELETE FROM trip_geofence_events_normalized t
USING ranked_unmapped r
WHERE t.event_id = r.event_id
  AND r.rn > 1;

-- 3) Enforce uniqueness for mapped visits.
--    role_code is coalesced so NULL role mappings are also protected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tgen_mapped_visit
ON trip_geofence_events_normalized (
    tracker_id,
    in_time,
    out_time,
    canonical_geofence_id,
    COALESCE(role_code, '')
)
WHERE canonical_geofence_id IS NOT NULL;

-- 4) Enforce uniqueness for unmapped visits.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tgen_unmapped_visit
ON trip_geofence_events_normalized (
    tracker_id,
    in_time,
    out_time,
    raw_geofence_name
)
WHERE canonical_geofence_id IS NULL;

-- Refresh planner stats after large delete/create-index operations.
ANALYZE trip_geofence_events_normalized;

