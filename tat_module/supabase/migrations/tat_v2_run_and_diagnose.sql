-- =============================================================
-- TAT V2: Run Pipeline + Diagnose Empty Tables
-- Run this in Supabase SQL Editor to populate v2 tables and
-- verify each phase produced output.
-- =============================================================

-- ─── STEP 0: Check source data availability ──────────────────
-- Make sure geofence_visits has data before running the pipeline.
SELECT
    count(*)                   AS total_visits,
    count(DISTINCT tracker_id) AS tracker_count,
    min(in_time_dt)            AS earliest_visit,
    max(in_time_dt)            AS latest_visit
FROM public.geofence_visits;

-- ─── STEP 1: Check current state of all v2 tables ────────────
SELECT 'geofence_master'                   AS tbl, count(*) AS rows FROM geofence_master
UNION ALL
SELECT 'geofence_aliases',                         count(*) FROM geofence_aliases
UNION ALL
SELECT 'geofence_role_map',                        count(*) FROM geofence_role_map
UNION ALL
SELECT 'trip_geofence_events_normalized',          count(*) FROM trip_geofence_events_normalized
UNION ALL
SELECT 'trip_state_events',                        count(*) FROM trip_state_events
UNION ALL
SELECT 'tat_trip_facts_v2',                        count(*) FROM tat_trip_facts_v2
UNION ALL
SELECT 'tat_data_quality_issues',                  count(*) FROM tat_data_quality_issues
UNION ALL
SELECT 'tat_refactor_runs',                        count(*) FROM tat_refactor_runs;

-- ─── STEP 2: Run the full pipeline ───────────────────────────
-- Adjust the date range to match your actual data window.
-- Start narrow (1 month) to validate before doing multi-year history.
SELECT rebuild_tat_v2_full(
    '2025-01-01 00:00:00+00',
    '2025-03-21 23:59:59+00'
);

-- ─── STEP 3: Check run log — did phases complete or fail? ─────
SELECT
    phase,
    status,
    start_time,
    end_time,
    ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::NUMERIC, 1) AS seconds,
    metrics,
    error_message
FROM tat_refactor_runs
ORDER BY start_time DESC
LIMIT 20;

-- ─── STEP 4: Check Phase 2 output ────────────────────────────
SELECT
    normalization_rule,
    count(*)                           AS event_count,
    count(DISTINCT tracker_id)         AS trackers,
    count(DISTINCT raw_geofence_name)  AS distinct_geofences
FROM trip_geofence_events_normalized
GROUP BY normalization_rule
ORDER BY event_count DESC;

-- Top unmapped geofences (feed these back into seed_extended)
SELECT
    raw_geofence_name,
    count(*) AS visit_count
FROM trip_geofence_events_normalized
WHERE normalization_rule = 'unmapped'
GROUP BY raw_geofence_name
ORDER BY visit_count DESC
LIMIT 30;

-- ─── STEP 5: Check Phase 3 output ────────────────────────────
SELECT
    event_code,
    count(*)                       AS event_count,
    count(DISTINCT trip_key)       AS trip_count,
    ROUND(AVG(event_confidence), 2) AS avg_confidence
FROM trip_state_events
GROUP BY event_code
ORDER BY event_count DESC;

-- How many trips were anchored vs closed?
SELECT
    count(DISTINCT trip_key) FILTER (WHERE event_code = 'loading_start') AS trips_anchored,
    count(DISTINCT trip_key) FILTER (WHERE event_code = 'trip_closed')   AS trips_closed,
    count(DISTINCT trip_key) FILTER (WHERE event_code = 'destination_entry') AS trips_with_dest,
    count(DISTINCT trip_key) FILTER (WHERE event_code = 'border_entry')  AS trips_with_border
FROM trip_state_events;

-- ─── STEP 6: Check Phase 4 output ────────────────────────────
SELECT
    status,
    trip_type,
    count(*)                          AS trips,
    ROUND(AVG(total_tat_hrs), 1)      AS avg_tat_hrs,
    ROUND(AVG(lifecycle_confidence), 2) AS avg_confidence
FROM tat_trip_facts_v2
GROUP BY status, trip_type
ORDER BY trips DESC;

-- Sample a few trips to eyeball correctness
SELECT
    trip_key,
    tracker_id,
    tracker_name,
    loading_terminal,
    destination_name,
    customer_name,
    status,
    trip_type,
    loading_start,
    loading_end,
    dest_entry,
    dest_exit,
    total_tat_hrs,
    lifecycle_confidence,
    closure_reason
FROM tat_trip_facts_v2
ORDER BY loading_start DESC
LIMIT 20;

-- ─── STEP 7: Parity vs v1 ────────────────────────────────────
SELECT * FROM v_tat_v1_v2_parity
WHERE first_trip >= '2025-01-01'
ORDER BY destination, version;

-- ─── STEP 8: Fail-fast parity gate (throws if thresholds are breached) ──────
SELECT validate_tat_v2_parity_gate(
    '2025-01-01 00:00:00+00',
    '2025-03-21 23:59:59+00'
);
