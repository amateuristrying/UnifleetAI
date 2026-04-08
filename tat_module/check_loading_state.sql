-- =============================================================
-- DIAGNOSTIC: Why is active_loading_started empty?
-- Run these in sequence — each narrows down the root cause.
-- =============================================================

-- ── 1. Does tat_trip_facts_v2 have ANY currently-loading trucks? ──────────
--    Expected: rows where loading_end IS NULL and status = 'loading'
--    If empty → daily rebuild hasn't written open sessions to facts table.
SELECT
    tracker_id,
    tracker_name,
    loading_terminal,
    loading_start,
    loading_end,
    loading_end::time AS loading_end_time,
    status
FROM tat_trip_facts_v2
WHERE loading_end IS NULL
  AND loading_start >= NOW() - INTERVAL '14 days'
ORDER BY loading_start DESC
LIMIT 30;

-- ── 2. What does the queue RPC actually classify each truck as? ───────────
--    If trucks exist in facts but don't appear as active_loading_started,
--    they're being classified differently (earlier WHEN branch wins).
SELECT
    t.tracker_id,
    t.tracker_name,
    t.loading_terminal,
    t.loading_start,
    t.loading_end,
    t.status,
    t.dest_entry,
    t.customer_entry,
    t.dest_exit,
    t.customer_exit,
    t.completion_time,
    t.trip_closed_at,
    t.next_loading_entry,
    CASE WHEN t.loading_end IS NOT NULL AND t.loading_end::time = '23:59:59' THEN NULL
         ELSE t.loading_end END AS effective_loading_end,
    -- Simulate the queue classification CASE
    CASE
        WHEN t.status IN ('completed','completed_missed_dest')
             AND t.next_loading_entry IS NULL
        THEN 'would_be → active_waiting_next_load'
        WHEN EXISTS (
            SELECT 1 FROM tat_trip_border_facts_v2 bf
            WHERE bf.trip_key = t.trip_key AND bf.entry_time IS NOT NULL AND bf.exit_time IS NULL
        ) THEN 'would_be → active_at_border'
        WHEN (t.dest_entry IS NOT NULL OR t.customer_entry IS NOT NULL)
             AND (t.dest_exit IS NULL OR t.dest_exit::time = '23:59:59')
             AND (t.customer_exit IS NULL OR t.customer_exit::time = '23:59:59')
        THEN 'would_be → active_awaiting_unloading'
        WHEN t.loading_start IS NOT NULL
             AND (t.loading_end IS NULL OR t.loading_end::time = '23:59:59')
        THEN 'would_be → active_loading_started ✓'
        WHEN t.loading_end IS NOT NULL AND t.loading_end::time != '23:59:59'
             AND t.dest_entry IS NULL AND t.customer_entry IS NULL
        THEN 'would_be → active_loading_completed'
        ELSE 'would_be → NULL (not in any queue)'
    END AS simulated_queue
FROM (
    SELECT DISTINCT ON (t.tracker_id) t.*
    FROM tat_trip_facts_v2 t
    WHERE t.loading_start >= NOW() - INTERVAL '90 days'
    ORDER BY t.tracker_id, t.loading_start DESC
) t
ORDER BY t.loading_start DESC
LIMIT 50;

-- ── 3. Does live_tracker_geofence_state have trucks at loading terminals? ──
--    Expected after Phase 72 is running: trackers present at origin_terminal geofences
SELECT
    ls.tracker_id,
    ls.tracker_name,
    ls.current_geofence_name,
    ls.session_start,
    ls.last_ping,
    NOW() - ls.last_ping AS staleness,
    gm.canonical_name    AS matched_canonical,
    gm.default_role_code AS role
FROM live_tracker_geofence_state ls
LEFT JOIN geofence_master gm
  ON UPPER(gm.canonical_name) = UPPER(ls.current_geofence_name)
WHERE ls.current_geofence_id IS NOT NULL
ORDER BY ls.last_ping DESC
LIMIT 30;

-- ── 4. Do ANY live state trackers match loading terminals? ────────────────
--    If this returns 0 rows but query 3 has rows → the geofence name
--    mismatch is the issue (Navixy name ≠ canonical name in geofence_master)
SELECT
    ls.tracker_id,
    ls.tracker_name,
    ls.current_geofence_name  AS navixy_name,
    gm.canonical_name         AS canonical_name,
    gm.default_role_code
FROM live_tracker_geofence_state ls
JOIN geofence_master gm
  ON UPPER(gm.canonical_name) = UPPER(ls.current_geofence_name)
 AND gm.default_role_code = 'origin_terminal'
WHERE ls.current_geofence_id IS NOT NULL;

-- ── 5. Is the Phase 72 engine running? Check watermark freshness ──────────
SELECT key, last_processed_id, updated_at, NOW() - updated_at AS age
FROM sys_telemetry_watermark
WHERE key = 'live_geofence_engine';

-- ── 6. Recent telemetry volume check ─────────────────────────────────────
SELECT
    COUNT(*) AS total_rows,
    MAX(id) AS max_id,
    MIN(ingested_at) AS oldest,
    MAX(ingested_at) AS newest,
    COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0) AS valid_coords
FROM vehicle_telemetry
WHERE ingested_at >= NOW() - INTERVAL '1 hour';
