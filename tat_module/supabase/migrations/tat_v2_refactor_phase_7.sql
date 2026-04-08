-- =============================================================
-- TAT V2 REFACTOR: Phase 7 — Rebuild Wrapper + Validation
-- =============================================================
--
-- TIMEOUT STRATEGY — why phases cannot all be chunked the same way:
--
--   Long-haul trips (Dar → DRC) span 20–35 days. Phase 3 builds
--   trip state events using LATERAL JOINs on trip_geofence_events_normalized,
--   bounded by [loading_start, next_loading_start). If Phase 3 runs in
--   small chunks, the last open trip in each chunk has window_end = 'infinity'
--   but future normalized events don't yet exist — they'll be written by
--   a later Phase 2 chunk. Then when the NEXT Phase 3 chunk runs, it
--   DELETEs events in that event_time range and never re-inserts them
--   (the trip's loading_start is outside the new anchor window).
--   Result: silent milestone loss. Trips show closed_by_timeout.
--
--   CORRECT ORDER:
--     1. Phase 2 in monthly chunks  → fully populates trip_geofence_events_normalized
--     2. Phase 3 for the full range → LATERAL JOINs see the complete trip lifecycle
--     3. Phase 4 in monthly chunks  → safe, loading_start bounded DELETEs
--     4. Phase 5 for the full range → exception flags
--
--   Use rebuild_v2_historical.js for the historical load.
--   Use rebuild_tat_v2_full() only for narrow re-processing (< 2 weeks).
-- =============================================================

-- ─── Single-call wrapper (for narrow windows only) ─────────────────────────
-- WARNING: Calling this over > 2 weeks of data will likely hit Supabase's
-- statement timeout. Use rebuild_v2_historical.js instead.
CREATE OR REPLACE FUNCTION rebuild_tat_v2_full(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- Disable statement_timeout so the full rebuild can run uninterrupted
    -- regardless of the service-role timeout set on this connection.
    SET LOCAL statement_timeout = 0;
    IF NOT pg_try_advisory_xact_lock(5142, 2) THEN
        RAISE EXCEPTION 'TAT V2 rebuild already running in another session';
    END IF;
    PERFORM refresh_trip_geofence_events_normalized(p_start, p_end);
    PERFORM build_trip_state_events_v2(p_start, p_end);
    PERFORM build_tat_trip_border_facts_v2(p_start, p_end);
    PERFORM build_tat_trip_facts_v2(p_start, p_end);
    PERFORM generate_tat_v2_exceptions(p_start, p_end);
END $$;


-- ─── QUARTERLY FALLBACK (run in SQL Editor if Phase 3 times out via JS) ────
--
-- Run each block separately — each is a distinct statement with its own
-- timeout clock. Q1 = Oct–Dec 2025, Q2 = Jan–Mar 2026.
-- IMPORTANT: Run ALL of Phase 2 first, THEN run Phase 3 quarters, THEN Phase 4.
--
-- Step A — Phase 2, all data:
--   SELECT refresh_trip_geofence_events_normalized('2025-10-01', '2026-01-01');
--   SELECT refresh_trip_geofence_events_normalized('2026-01-01', '2026-04-01');
--
-- Step B — Phase 3, quarterly (run each separately):
--   SELECT build_trip_state_events_v2('2025-10-01', '2026-01-01');
--   SELECT build_trip_state_events_v2('2026-01-01', '2026-04-01');
--
-- WHY quarterly is safe for Phase 3:
--   3 months is longer than any single trip lifecycle (longest observed ~35 days).
--   The only edge case is the LAST open trip in a quarter — but it will be
--   correctly anchored (loading_start in Q1 range), and its window_end = 'infinity'
--   means its December milestone events will be found in trip_geofence_events_normalized
--   (already loaded in Step A). Phase 3 cleanup is trip_key-scoped, so Q2 reruns
--   do not delete Q1-anchored trips; only trips anchored in the active chunk are
--   rebuilt. This avoids cross-chunk milestone loss.
--
-- Step C — Phase 4 border facts, monthly:
--   SELECT build_tat_trip_border_facts_v2('2025-10-01', '2025-11-01');
--   SELECT build_tat_trip_border_facts_v2('2025-11-01', '2025-12-01');
--   SELECT build_tat_trip_border_facts_v2('2025-12-01', '2026-01-01');
--   SELECT build_tat_trip_border_facts_v2('2026-01-01', '2026-02-01');
--   SELECT build_tat_trip_border_facts_v2('2026-02-01', '2026-03-01');
--   SELECT build_tat_trip_border_facts_v2('2026-03-01', '2026-04-01');
--
-- Step D — Phase 4 trip facts, monthly:
--   SELECT build_tat_trip_facts_v2('2025-10-01', '2025-11-01');
--   SELECT build_tat_trip_facts_v2('2025-11-01', '2025-12-01');
--   SELECT build_tat_trip_facts_v2('2025-12-01', '2026-01-01');
--   SELECT build_tat_trip_facts_v2('2026-01-01', '2026-02-01');
--   SELECT build_tat_trip_facts_v2('2026-02-01', '2026-03-01');
--   SELECT build_tat_trip_facts_v2('2026-03-01', '2026-04-01');
--
-- Step E — Phase 5 (exceptions):
--   SELECT generate_tat_v2_exceptions('2025-10-01', '2026-04-01');


-- ─── VALIDATION QUERIES ─────────────────────────────────────────────────────

-- 1. Trip count parity between v1 and v2
/*
SELECT
    'v1' AS version, count(*) AS trip_count,
    min(loading_start) AS first_trip, max(loading_start) AS latest_trip
FROM tat_trips_data
WHERE loading_start >= '2025-10-01'
UNION ALL
SELECT
    'v2' AS version, count(*) AS trip_count,
    min(loading_start) AS first_trip, max(loading_start) AS latest_trip
FROM tat_trip_facts_v2
WHERE loading_start >= '2025-10-01';
*/

-- 2. Status distribution
/*
SELECT status, trip_type, count(*), ROUND(AVG(total_tat_hrs),1) avg_tat
FROM tat_trip_facts_v2
GROUP BY status, trip_type
ORDER BY count DESC;
*/

-- 3. Destination parity
/*
SELECT * FROM v_tat_v1_v2_parity
WHERE first_trip >= '2025-10-01'
ORDER BY destination, version;
*/

-- 4. Unmapped geofences still remaining
/*
SELECT raw_geofence_name, count(*) AS visit_count
FROM trip_geofence_events_normalized
WHERE normalization_rule = 'unmapped'
GROUP BY raw_geofence_name
ORDER BY visit_count DESC
LIMIT 30;
*/

-- 5. Run log — confirm all phases completed successfully
/*
SELECT phase, status, ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::NUMERIC, 1) AS secs,
       metrics, error_message
FROM tat_refactor_runs
ORDER BY start_time DESC
LIMIT 20;
*/
