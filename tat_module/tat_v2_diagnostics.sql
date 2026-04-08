-- ═══════════════════════════════════════════════════════════════════════════
-- TAT V2  —  ADVANCED INSPECTION & ANOMALY DIAGNOSTICS
-- Run against Supabase SQL editor or via apply_migrations.js
-- Each section is independent; run individually or all at once via UNION block
-- at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────
-- § 0.  SYSTEM HEALTH SNAPSHOT
-- Quick overview: row counts, date coverage, last build run timestamps.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    'trip_state_events'          AS tbl,
    count(*)                     AS rows,
    min(event_time)::DATE        AS earliest,
    max(event_time)::DATE        AS latest,
    count(DISTINCT trip_key)     AS distinct_trips,
    count(DISTINCT tracker_id)   AS distinct_trackers
FROM trip_state_events
UNION ALL
SELECT 'tat_trip_facts_v2',
    count(*), min(loading_start)::DATE, max(loading_start)::DATE,
    count(DISTINCT trip_key), count(DISTINCT tracker_id)
FROM tat_trip_facts_v2
UNION ALL
SELECT 'tat_trip_border_facts_v2',
    count(*), min(entry_time)::DATE, max(exit_time)::DATE,
    count(DISTINCT trip_key), count(DISTINCT tracker_id)
FROM tat_trip_border_facts_v2
UNION ALL
SELECT 'trip_geofence_events_normalized',
    count(*), min(in_time)::DATE, max(out_time)::DATE,
    NULL, count(DISTINCT tracker_id)
FROM trip_geofence_events_normalized;


-- ──────────────────────────────────────────────────────────────────────────
-- § 0b.  BUILD RUN LOG  (last 10 runs per phase)
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    phase,
    status,
    start_time::TIMESTAMPTZ      AS started_at,
    end_time::TIMESTAMPTZ        AS ended_at,
    ROUND(EXTRACT(EPOCH FROM (end_time - start_time))/60.0, 1) AS duration_min,
    parameters,
    error_message
FROM tat_refactor_runs
ORDER BY start_time DESC
LIMIT 20;


-- ──────────────────────────────────────────────────────────────────────────
-- § 1.  PARITY: V1 vs V2 TRIP COUNTS BY MONTH
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    TO_CHAR(DATE_TRUNC('month', loading_start), 'YYYY-MM')  AS month,
    'v1'                                                     AS version,
    count(*)                                                 AS trips,
    count(*) FILTER (WHERE dest_name IS NOT NULL)            AS with_dest,
    ROUND(AVG(
        EXTRACT(EPOCH FROM (
            COALESCE(next_loading_entry, next_dar_entry, now()) - loading_start
        )) / 3600.0
    )::NUMERIC, 1)                                           AS avg_tat_hrs
FROM tat_trips_data
WHERE loading_start >= '2025-10-01'
GROUP BY 1

UNION ALL

SELECT
    TO_CHAR(DATE_TRUNC('month', loading_start), 'YYYY-MM'),
    'v2',
    count(*),
    count(*) FILTER (WHERE destination_name IS NOT NULL),
    ROUND(AVG(total_tat_hrs), 1)
FROM tat_trip_facts_v2
WHERE loading_start >= '2025-10-01'
GROUP BY 1
ORDER BY month, version;


-- ──────────────────────────────────────────────────────────────────────────
-- § 2.  PARITY: CRITICAL FIELD DELTAS (loading_start, dar_arrival, origin_exit)
-- Trips in both v1 and v2 — compare parity-contract timestamps.
-- Flag any drift > 1 hour as a contract violation.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    v2.trip_key,
    v2.tracker_name,
    v2.loading_start,
    -- loading_start delta
    ROUND(EXTRACT(EPOCH FROM (v2.loading_start - v1.loading_start))/3600.0, 3)
                                AS loading_start_delta_hrs,
    -- dar_arrival delta (parity contract: v2.dar_arrival = v1.dar_arrival)
    ROUND(EXTRACT(EPOCH FROM (v2.dar_arrival - v1.dar_arrival))/3600.0, 3)
                                AS dar_arrival_delta_hrs,
    -- dar_exit / origin_exit delta (parity contract)
    ROUND(EXTRACT(EPOCH FROM (v2.origin_exit - v1.dar_exit))/3600.0, 3)
                                AS dar_exit_delta_hrs,
    -- dest_entry delta
    ROUND(EXTRACT(EPOCH FROM (v2.dest_entry - v1.dest_entry))/3600.0, 3)
                                AS dest_entry_delta_hrs,
    -- flag any contract violation (> 1h drift on parity fields)
    (   ABS(EXTRACT(EPOCH FROM (v2.dar_arrival - v1.dar_arrival))) > 3600
     OR ABS(EXTRACT(EPOCH FROM (v2.origin_exit  - v1.dar_exit)))   > 3600
    )                           AS parity_contract_violated
FROM tat_trip_facts_v2 v2
JOIN tat_trips_data v1
     ON  v1.tracker_id = v2.tracker_id
     AND ABS(EXTRACT(EPOCH FROM (v1.loading_start - v2.loading_start))) < 7200
WHERE v2.loading_start >= '2025-10-01'
  AND (
      ABS(EXTRACT(EPOCH FROM (v2.dar_arrival - v1.dar_arrival))) > 3600
   OR ABS(EXTRACT(EPOCH FROM (v2.origin_exit  - v1.dar_exit)))   > 3600
   OR ABS(EXTRACT(EPOCH FROM (v2.loading_start - v1.loading_start))) > 3600
  )
ORDER BY ABS(EXTRACT(EPOCH FROM (v2.dar_arrival - v1.dar_arrival))) DESC NULLS LAST
LIMIT 50;


-- ──────────────────────────────────────────────────────────────────────────
-- § 3.  TRIP FACTS: IMPOSSIBLE / NEGATIVE DURATIONS
-- Any computed duration that is negative indicates chronology corruption.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_key,
    tracker_name,
    loading_start::DATE         AS loaded,
    trip_status,
    trip_type,
    -- Flag each impossible duration
    CASE WHEN loading_phase_hrs       < 0 THEN 'loading_phase_hrs<0 '       ELSE '' END
 || CASE WHEN waiting_for_orders_hrs  < 0 THEN 'waiting_for_orders<0 '      ELSE '' END
 || CASE WHEN transit_hrs             < 0 THEN 'transit_hrs<0 '             ELSE '' END
 || CASE WHEN border_total_hrs        < 0 THEN 'border_total_hrs<0 '        ELSE '' END
 || CASE WHEN destination_dwell_hrs   < 0 THEN 'dest_dwell<0 '              ELSE '' END
 || CASE WHEN return_hrs              < 0 THEN 'return_hrs<0 '              ELSE '' END
 || CASE WHEN total_tat_hrs           < 0 THEN 'total_tat<0 '               ELSE '' END
 || CASE WHEN loading_end < loading_start THEN 'loading_end<loading_start ' ELSE '' END
 || CASE WHEN origin_exit < loading_start THEN 'origin_exit<loading_start ' ELSE '' END
 || CASE WHEN dest_entry  < origin_exit   THEN 'dest_entry<origin_exit '    ELSE '' END
                                AS flags,
    loading_phase_hrs,
    waiting_for_orders_hrs,
    transit_hrs,
    total_tat_hrs
FROM tat_trip_facts_v2
WHERE loading_phase_hrs       < 0
   OR waiting_for_orders_hrs  < 0
   OR transit_hrs             < 0
   OR border_total_hrs        < 0
   OR destination_dwell_hrs   < 0
   OR return_hrs              < 0
   OR total_tat_hrs           < 0
   OR loading_end  < loading_start
   OR origin_exit  < loading_start
   OR (dest_entry IS NOT NULL AND origin_exit IS NOT NULL AND dest_entry < origin_exit)
ORDER BY total_tat_hrs ASC NULLS LAST
LIMIT 100;


-- ──────────────────────────────────────────────────────────────────────────
-- § 4.  TRIP FACTS: EXTREME DURATION OUTLIERS
-- TAT > 60 days or loading_phase > 7 days is almost certainly bad data.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_key,
    tracker_name,
    trip_type,
    trip_status,
    loading_start::DATE         AS loaded,
    ROUND(total_tat_hrs / 24.0, 1)          AS total_tat_days,
    ROUND(loading_phase_hrs / 24.0, 1)      AS loading_days,
    ROUND(transit_hrs / 24.0, 1)            AS transit_days,
    ROUND(border_total_hrs / 24.0, 1)       AS border_days,
    ROUND(outbound_border_total_hrs, 1)     AS ob_border_hrs,
    ROUND(return_border_total_hrs, 1)       AS ret_border_hrs,
    lifecycle_confidence,
    trip_closure_reason
FROM tat_trip_facts_v2
WHERE total_tat_hrs > 24 * 60   -- > 60 days
   OR loading_phase_hrs > 24 * 7  -- > 7 days at loading terminal
   OR transit_hrs > 24 * 30       -- > 30 days in transit
   OR border_total_hrs > 24 * 14  -- > 14 days at borders
ORDER BY total_tat_hrs DESC NULLS LAST
LIMIT 50;


-- ──────────────────────────────────────────────────────────────────────────
-- § 5.  TRIP FACTS: MISSING CRITICAL MILESTONES BY STATUS
-- In-transit trips should have loading_start + origin_exit.
-- Completed trips should have dest_entry + dest_exit.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_status,
    trip_type,
    count(*)                                        AS trips,
    -- Required fields by status
    count(*) FILTER (WHERE loading_start IS NULL)   AS missing_loading_start,
    count(*) FILTER (WHERE loading_end   IS NULL)   AS missing_loading_end,
    count(*) FILTER (WHERE dar_arrival   IS NULL)   AS missing_dar_arrival,
    count(*) FILTER (WHERE origin_exit   IS NULL)   AS missing_origin_exit,
    count(*) FILTER (WHERE dest_entry    IS NULL
                        AND trip_status IN ('completed','completed_missed_dest'))
                                                    AS completed_no_dest_entry,
    count(*) FILTER (WHERE trip_closed_at IS NULL)  AS missing_closure_time,
    count(*) FILTER (WHERE lifecycle_confidence < 0.80) AS low_confidence,
    -- Status-specific anomalies
    count(*) FILTER (WHERE trip_status = 'completed'
                        AND (dest_entry IS NULL OR dest_exit IS NULL))
                                                    AS completed_missing_dest_ts,
    count(*) FILTER (WHERE trip_status = 'returning'
                        AND return_border_entry IS NULL
                        AND has_border_event = TRUE)
                                                    AS returning_no_return_border
FROM tat_trip_facts_v2
GROUP BY trip_status, trip_type
ORDER BY trips DESC;


-- ──────────────────────────────────────────────────────────────────────────
-- § 6.  BORDER FACTS: FULL ANOMALY MATRIX
-- Missing exits, negative dwell, impossibly long dwell, midnight artifacts.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    border_code,
    border_family,
    leg_direction,
    count(*)                                                AS total_crossings,
    count(DISTINCT trip_key)                                AS distinct_trips,
    -- Missing exits
    count(*) FILTER (WHERE exit_time IS NULL)               AS missing_exit,
    ROUND(100.0 * count(*) FILTER (WHERE exit_time IS NULL)
          / NULLIF(count(*), 0), 1)                        AS missing_exit_pct,
    -- Negative dwell (exit before entry — data corruption)
    count(*) FILTER (WHERE exit_time < entry_time)          AS negative_dwell,
    -- Suspiciously short (< 5 min — likely false positive crossing)
    count(*) FILTER (WHERE dwell_hrs < 0.083
                       AND exit_time IS NOT NULL)           AS dwell_lt_5min,
    -- Long dwell tiers
    count(*) FILTER (WHERE dwell_hrs BETWEEN 24 AND 72)     AS dwell_1_3days,
    count(*) FILTER (WHERE dwell_hrs > 72)                  AS dwell_gt_3days,
    -- Dwell stats
    ROUND(MIN(dwell_hrs) FILTER (WHERE exit_time IS NOT NULL AND dwell_hrs > 0), 2)
                                                            AS min_dwell_hrs,
    ROUND(AVG(dwell_hrs) FILTER (WHERE exit_time IS NOT NULL), 2)
                                                            AS avg_dwell_hrs,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dwell_hrs)
          FILTER (WHERE exit_time IS NOT NULL), 2)          AS median_dwell_hrs,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY dwell_hrs)
          FILTER (WHERE exit_time IS NOT NULL), 2)          AS p95_dwell_hrs,
    ROUND(MAX(dwell_hrs) FILTER (WHERE exit_time IS NOT NULL), 2)
                                                            AS max_dwell_hrs,
    -- Avg source events per crossing (jitter indicator: >2 = collapsed duplicates)
    ROUND(AVG(array_length(source_event_ids, 1)), 1)        AS avg_src_events,
    -- Multi-crossing trips (same border seen > once per trip per leg)
    count(*) FILTER (WHERE trip_key IN (
        SELECT trip_key FROM tat_trip_border_facts_v2 b2
        WHERE b2.border_code   = tat_trip_border_facts_v2.border_code
          AND b2.leg_direction = tat_trip_border_facts_v2.leg_direction
        GROUP BY b2.trip_key, b2.border_code, b2.leg_direction
        HAVING count(*) > 1
    ))                                                      AS from_multi_crossing_trips
FROM tat_trip_border_facts_v2
GROUP BY border_code, border_family, leg_direction
ORDER BY border_code, leg_direction;


-- ──────────────────────────────────────────────────────────────────────────
-- § 7.  BORDER FACTS: CHRONOLOGY VIOLATIONS
-- Border events must be within the trip window and in logical order.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    bf.trip_key,
    bf.tracker_name,
    bf.border_code,
    bf.leg_direction,
    bf.entry_time,
    bf.exit_time,
    ROUND(bf.dwell_hrs, 2)          AS dwell_hrs,
    f.loading_start,
    f.loading_end,
    f.dest_entry,
    f.trip_closed_at,
    -- Classify the violation
    CASE
        WHEN bf.exit_time < bf.entry_time
            THEN 'negative_dwell'
        WHEN bf.entry_time < f.loading_start
            THEN 'border_before_loading_start'
        WHEN bf.leg_direction = 'outbound'
             AND f.loading_end IS NOT NULL
             AND bf.entry_time < f.loading_end
            THEN 'outbound_border_before_loading_end'
        WHEN bf.leg_direction = 'outbound'
             AND f.dest_entry IS NOT NULL
             AND bf.entry_time > f.dest_entry
            THEN 'outbound_border_after_dest_entry'
        WHEN bf.leg_direction = 'return'
             AND f.dest_exit IS NOT NULL
             AND bf.entry_time < f.dest_exit
            THEN 'return_border_before_dest_exit'
        WHEN bf.exit_time IS NOT NULL
             AND f.trip_closed_at IS NOT NULL
             AND bf.exit_time > f.trip_closed_at + INTERVAL '24 hours'
            THEN 'exit_well_after_trip_closed'
        ELSE 'other'
    END                             AS violation_type
FROM tat_trip_border_facts_v2 bf
JOIN tat_trip_facts_v2 f ON f.trip_key = bf.trip_key
WHERE
    -- negative dwell
    (bf.exit_time < bf.entry_time)
    -- border before trip started
 OR (bf.entry_time < f.loading_start)
    -- outbound border before leaving the terminal
 OR (bf.leg_direction = 'outbound'
     AND f.loading_end IS NOT NULL
     AND bf.entry_time < f.loading_end)
    -- outbound border timestamped after destination arrival
 OR (bf.leg_direction = 'outbound'
     AND f.dest_entry IS NOT NULL
     AND bf.entry_time > f.dest_entry)
    -- return border before truck left the destination
 OR (bf.leg_direction = 'return'
     AND f.dest_exit IS NOT NULL
     AND bf.entry_time < f.dest_exit)
ORDER BY violation_type, bf.trip_key
LIMIT 200;


-- ──────────────────────────────────────────────────────────────────────────
-- § 8.  EVENT LEDGER: CHRONOLOGY VIOLATIONS PER TRIP
-- Events must follow: loading_start → loading_end → origin_exit
--   → (border_entry → border_exit) → destination_entry → destination_exit
--   → (return_border_entry → return_border_exit) → trip_closed
-- ──────────────────────────────────────────────────────────────────────────

WITH milestones AS (
    SELECT
        trip_key,
        tracker_id,
        MIN(event_time) FILTER (WHERE event_code = 'loading_start')         AS t_load_start,
        MAX(event_time) FILTER (WHERE event_code = 'loading_end')           AS t_load_end,
        MIN(event_time) FILTER (WHERE event_code = 'origin_exit')           AS t_origin_exit,
        MIN(event_time) FILTER (WHERE event_code = 'border_entry')          AS t_ob_border_entry,
        MIN(event_time) FILTER (WHERE event_code = 'destination_entry')     AS t_dest_entry,
        MAX(event_time) FILTER (WHERE event_code = 'destination_exit')      AS t_dest_exit,
        MIN(event_time) FILTER (WHERE event_code = 'return_border_entry')   AS t_ret_border_entry,
        MAX(event_time) FILTER (WHERE event_code = 'trip_closed')           AS t_trip_closed
    FROM trip_state_events
    GROUP BY trip_key, tracker_id
)
SELECT
    m.trip_key,
    m.tracker_id,
    f.tracker_name,
    f.loading_start::DATE,
    f.trip_status,
    -- List all violations in this trip
    ARRAY_REMOVE(ARRAY[
        CASE WHEN t_load_end    <= t_load_start                            THEN 'loading_end≤loading_start'                END,
        CASE WHEN t_origin_exit <= t_load_start                            THEN 'origin_exit≤loading_start'                END,
        CASE WHEN t_origin_exit IS NOT NULL AND t_load_end IS NOT NULL
              AND t_origin_exit < t_load_end                               THEN 'origin_exit<loading_end'                  END,
        CASE WHEN t_ob_border_entry IS NOT NULL AND t_origin_exit IS NOT NULL
              AND t_ob_border_entry < t_origin_exit                        THEN 'ob_border_before_origin_exit'             END,
        CASE WHEN t_dest_entry IS NOT NULL AND t_ob_border_entry IS NOT NULL
              AND t_dest_entry < t_ob_border_entry                         THEN 'dest_before_ob_border'                    END,
        CASE WHEN t_dest_exit IS NOT NULL AND t_dest_entry IS NOT NULL
              AND t_dest_exit <= t_dest_entry                              THEN 'dest_exit≤dest_entry'                     END,
        CASE WHEN t_ret_border_entry IS NOT NULL AND t_dest_exit IS NOT NULL
              AND t_ret_border_entry < t_dest_exit                         THEN 'return_border_before_dest_exit'           END,
        CASE WHEN t_trip_closed IS NOT NULL AND t_load_start IS NOT NULL
              AND t_trip_closed < t_load_start                             THEN 'trip_closed_before_loading_start'         END
    ], NULL)                    AS violations,
    t_load_start,
    t_load_end,
    t_origin_exit,
    t_ob_border_entry,
    t_dest_entry,
    t_dest_exit,
    t_ret_border_entry,
    t_trip_closed
FROM milestones m
JOIN tat_trip_facts_v2 f ON f.trip_key = m.trip_key
WHERE
    (t_load_end    <= t_load_start)
 OR (t_origin_exit <= t_load_start)
 OR (t_origin_exit IS NOT NULL AND t_load_end IS NOT NULL AND t_origin_exit < t_load_end)
 OR (t_ob_border_entry IS NOT NULL AND t_origin_exit IS NOT NULL AND t_ob_border_entry < t_origin_exit)
 OR (t_dest_entry IS NOT NULL AND t_ob_border_entry IS NOT NULL AND t_dest_entry < t_ob_border_entry)
 OR (t_dest_exit  IS NOT NULL AND t_dest_entry IS NOT NULL AND t_dest_exit <= t_dest_entry)
 OR (t_ret_border_entry IS NOT NULL AND t_dest_exit IS NOT NULL AND t_ret_border_entry < t_dest_exit)
 OR (t_trip_closed IS NOT NULL AND t_load_start IS NOT NULL AND t_trip_closed < t_load_start)
ORDER BY array_length(ARRAY_REMOVE(ARRAY[
    CASE WHEN t_load_end <= t_load_start THEN 'x' END,
    CASE WHEN t_origin_exit <= t_load_start THEN 'x' END,
    CASE WHEN t_dest_exit <= t_dest_entry THEN 'x' END
], NULL), 1) DESC NULLS LAST
LIMIT 100;


-- ──────────────────────────────────────────────────────────────────────────
-- § 9.  EVENT LEDGER: BACKFILL COVERAGE GAPS
-- New typed columns (canonical_name, role_code, border_code etc.) should be
-- populated. NULL where not expected = phase 3 function gap.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    event_code,
    count(*)                                                    AS total,
    count(*) FILTER (WHERE canonical_name   IS NOT NULL)        AS has_canonical,
    count(*) FILTER (WHERE role_code        IS NOT NULL)        AS has_role_code,
    count(*) FILTER (WHERE trip_stage       IS NOT NULL)        AS has_trip_stage,
    count(*) FILTER (WHERE border_code      IS NOT NULL)        AS has_border_code,
    count(*) FILTER (WHERE source_visit_id  IS NOT NULL)        AS has_source_visit,
    -- Coverage rates
    ROUND(100.0 * count(*) FILTER (WHERE canonical_name IS NOT NULL)
          / NULLIF(count(*),0), 1)                             AS canonical_pct,
    ROUND(100.0 * count(*) FILTER (WHERE role_code IS NOT NULL)
          / NULLIF(count(*),0), 1)                             AS role_code_pct,
    -- Unexpected NULLs (role_code must exist for all non-closure events)
    count(*) FILTER (WHERE role_code IS NULL
                       AND event_code NOT IN ('trip_closed','trip_anchor_start'))
                                                                AS unexpected_null_role_code
FROM trip_state_events
GROUP BY event_code
ORDER BY total DESC;


-- ──────────────────────────────────────────────────────────────────────────
-- § 10. CLOSURE REASON ANALYSIS
-- Distribution of why trips closed + downstream quality impact.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_closure_reason,
    trip_status,
    trip_type,
    count(*)                                            AS trips,
    ROUND(AVG(total_tat_hrs), 1)                        AS avg_tat_hrs,
    ROUND(AVG(lifecycle_confidence), 3)                 AS avg_confidence,
    count(*) FILTER (WHERE missed_destination_flag)     AS n_missed_dest,
    count(*) FILTER (WHERE low_confidence_flag)         AS n_low_conf,
    count(*) FILTER (WHERE has_destination_region_only) AS n_region_only,
    count(*) FILTER (WHERE outbound_border_count = 0
                       AND trip_type = 'long_haul')     AS long_haul_no_border,
    -- P50 / P95 TAT
    ROUND(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY total_tat_hrs), 1)
                                                        AS p50_tat_hrs,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_tat_hrs), 1)
                                                        AS p95_tat_hrs
FROM tat_trip_facts_v2
GROUP BY trip_closure_reason, trip_status, trip_type
ORDER BY trips DESC;


-- ──────────────────────────────────────────────────────────────────────────
-- § 11. TRACKER-LEVEL ANOMALY RATES
-- Identify specific trackers with disproportionate data quality problems.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    f.tracker_id,
    f.tracker_name,
    count(*)                                                AS trips,
    -- TAT outliers
    count(*) FILTER (WHERE total_tat_hrs > 24 * 60)        AS tat_gt_60days,
    count(*) FILTER (WHERE total_tat_hrs < 0)              AS tat_negative,
    -- Confidence problems
    ROUND(AVG(lifecycle_confidence), 3)                    AS avg_conf,
    count(*) FILTER (WHERE lifecycle_confidence < 0.80)    AS low_conf_trips,
    -- Destination coverage
    count(*) FILTER (WHERE missed_destination_flag)        AS missed_dest,
    ROUND(100.0 * count(*) FILTER (WHERE missed_destination_flag)
          / NULLIF(count(*), 0), 1)                        AS missed_dest_pct,
    -- Border coverage (long-haul only)
    count(*) FILTER (WHERE trip_type = 'long_haul')        AS long_haul_trips,
    count(*) FILTER (WHERE trip_type = 'long_haul'
                       AND outbound_border_count = 0)      AS long_haul_no_border,
    -- Open trips (still in_transit / returning > 45 days ago)
    count(*) FILTER (WHERE trip_status IN ('in_transit','returning')
                       AND loading_start < now() - INTERVAL '45 days')
                                                            AS stale_open_trips
FROM tat_trip_facts_v2 f
GROUP BY f.tracker_id, f.tracker_name
HAVING
    count(*) FILTER (WHERE total_tat_hrs < 0) > 0
    OR count(*) FILTER (WHERE lifecycle_confidence < 0.80) > 2
    OR ROUND(100.0 * count(*) FILTER (WHERE missed_destination_flag)
             / NULLIF(count(*), 0), 1) > 50
    OR count(*) FILTER (WHERE trip_status IN ('in_transit','returning')
                          AND loading_start < now() - INTERVAL '45 days') > 0
ORDER BY tat_negative DESC, missed_dest_pct DESC, stale_open_trips DESC
LIMIT 50;


-- ──────────────────────────────────────────────────────────────────────────
-- § 12. STALE OPEN TRIPS
-- Trips stuck in in_transit / returning for > 45 days.
-- Could be a tracker malfunction, trip never closed, or missed next-load event.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_key,
    tracker_id,
    tracker_name,
    trip_status,
    trip_type,
    loading_start::DATE                             AS loaded,
    loading_terminal,
    destination_name,
    ROUND(EXTRACT(EPOCH FROM (now() - loading_start)) / 86400.0, 1)
                                                    AS age_days,
    ROUND(total_tat_hrs, 1)                         AS current_tat_hrs,
    lifecycle_confidence,
    outbound_border_count,
    return_border_count,
    trip_closure_reason
FROM tat_trip_facts_v2
WHERE trip_status IN ('in_transit', 'returning', 'loading')
  AND loading_start < now() - INTERVAL '45 days'
ORDER BY age_days DESC
LIMIT 50;


-- ──────────────────────────────────────────────────────────────────────────
-- § 13. BORDER CROSSING: TUNDUMA / NAKONDE FAMILY AUDIT
-- These two borders serve the same physical crossing (TZ ↔ ZM).
-- A well-formed long-haul trip to Zambia/DRC should show BOTH on the same leg.
-- ──────────────────────────────────────────────────────────────────────────

WITH tunduma_trips AS (
    SELECT
        trip_key,
        -- Outbound
        bool_or(border_code = 'tunduma'  AND leg_direction = 'outbound') AS has_tunduma_out,
        bool_or(border_code = 'nakonde'  AND leg_direction = 'outbound') AS has_nakonde_out,
        -- Return
        bool_or(border_code = 'tunduma'  AND leg_direction = 'return')   AS has_tunduma_ret,
        bool_or(border_code = 'nakonde'  AND leg_direction = 'return')   AS has_nakonde_ret,
        -- Dwell times
        MAX(dwell_hrs) FILTER (WHERE border_code = 'tunduma' AND leg_direction = 'outbound')
                                                                          AS tunduma_out_dwell,
        MAX(dwell_hrs) FILTER (WHERE border_code = 'nakonde' AND leg_direction = 'outbound')
                                                                          AS nakonde_out_dwell
    FROM tat_trip_border_facts_v2
    WHERE border_code IN ('tunduma','nakonde')
    GROUP BY trip_key
)
SELECT
    has_tunduma_out,
    has_nakonde_out,
    has_tunduma_ret,
    has_nakonde_ret,
    count(*)                                            AS trips,
    ROUND(AVG(tunduma_out_dwell), 2)                    AS avg_tunduma_dwell,
    ROUND(AVG(nakonde_out_dwell), 2)                    AS avg_nakonde_dwell,
    -- Expectation: most trips should have BOTH tunduma AND nakonde on each leg
    CASE
        WHEN has_tunduma_out AND has_nakonde_out THEN 'both_sides_outbound'
        WHEN has_tunduma_out AND NOT has_nakonde_out THEN 'tz_side_only'
        WHEN NOT has_tunduma_out AND has_nakonde_out THEN 'zm_side_only'
        ELSE 'neither_outbound'
    END                                                 AS crossing_pattern
FROM tunduma_trips
GROUP BY has_tunduma_out, has_nakonde_out, has_tunduma_ret, has_nakonde_ret,
         crossing_pattern
ORDER BY trips DESC;


-- ──────────────────────────────────────────────────────────────────────────
-- § 14. GEOFENCE NORMALIZATION: UNMAPPED NAMES & LOW CONFIDENCE
-- Raw geofence names that failed mapping → potential missing role assignments
-- causing missed milestones in Phase 3.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    raw_geofence_name,
    normalization_rule,
    count(*)                        AS visits,
    count(DISTINCT tracker_id)      AS trackers,
    ROUND(AVG(normalization_confidence), 3) AS avg_conf,
    min(in_time)::DATE              AS first_seen,
    max(out_time)::DATE             AS last_seen
FROM trip_geofence_events_normalized
WHERE normalization_rule IN ('unmapped', 'low_confidence', 'fuzzy_match')
   OR normalization_confidence < 0.80
GROUP BY raw_geofence_name, normalization_rule
ORDER BY visits DESC
LIMIT 40;


-- ──────────────────────────────────────────────────────────────────────────
-- § 15. DATA QUALITY ISSUE LOG SUMMARY
-- Aggregated view of issues logged during the last build run.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    dqi.issue_type,
    dqi.severity,
    count(*)                        AS occurrences,
    count(DISTINCT dqi.tracker_id)  AS trackers_affected,
    count(DISTINCT dqi.trip_key)    AS trips_affected,
    max(dqi.created_at)::DATE       AS last_seen
FROM tat_data_quality_issues dqi
JOIN tat_refactor_runs r ON r.run_id = dqi.run_id
WHERE r.start_time = (
    SELECT MAX(r2.start_time) FROM tat_refactor_runs r2
    WHERE r2.phase = 'PHASE_BORDER_FACTS' AND r2.status = 'completed'
)
GROUP BY dqi.issue_type, dqi.severity
ORDER BY occurrences DESC;


-- ──────────────────────────────────────────────────────────────────────────
-- § 16. LOADING SESSION QUALITY
-- A loading session should have loading_start < loading_end < dar_arrival.
-- Sessions with dar_arrival before loading_end suggest wrong role priority.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_key,
    tracker_name,
    loading_terminal,
    loading_start,
    loading_end,
    dar_arrival,
    origin_exit,
    ROUND(loading_phase_hrs, 2)          AS loading_hrs,
    ROUND(waiting_for_orders_hrs, 2)     AS wait_hrs,
    CASE
        WHEN dar_arrival < loading_end
            THEN 'dar_arrival_before_loading_end'
        WHEN loading_end = loading_start
            THEN 'zero_duration_loading'
        WHEN loading_phase_hrs > 24 * 5
            THEN 'loading_gt_5days'
        WHEN dar_arrival IS NULL
            THEN 'no_dar_arrival'
        WHEN origin_exit IS NULL
            THEN 'no_origin_exit'
    END                                  AS anomaly,
    lifecycle_confidence
FROM tat_trip_facts_v2
WHERE
    (dar_arrival IS NOT NULL AND dar_arrival < loading_end)
 OR (loading_end = loading_start)
 OR (loading_phase_hrs > 24 * 5)
 OR dar_arrival IS NULL
 OR origin_exit IS NULL
ORDER BY anomaly, loading_start DESC
LIMIT 100;


-- ──────────────────────────────────────────────────────────────────────────
-- § 17. DESTINATION PROOF QUALITY
-- Tier 1 = destination_site/customer_site (strong)
-- Tier 2 = destination_region only (weak — has_destination_region_only=TRUE)
-- Tier 3 = missed entirely
-- ──────────────────────────────────────────────────────────────────────────

SELECT
    trip_type,
    destination_name,
    CASE
        WHEN has_destination_region_only                THEN 'tier2_region_only'
        WHEN dest_entry IS NOT NULL                     THEN 'tier1_site_confirmed'
        WHEN missed_destination_flag                    THEN 'tier3_missed'
        ELSE 'in_progress'
    END                                                 AS proof_tier,
    count(*)                                            AS trips,
    ROUND(AVG(total_tat_hrs), 1)                        AS avg_tat_hrs,
    ROUND(AVG(lifecycle_confidence), 3)                 AS avg_conf,
    count(*) FILTER (WHERE trip_status = 'completed')   AS completed
FROM tat_trip_facts_v2
WHERE trip_type = 'long_haul'
  AND destination_name IS NOT NULL
GROUP BY trip_type, destination_name, proof_tier
ORDER BY trips DESC, destination_name
LIMIT 60;


-- ──────────────────────────────────────────────────────────────────────────
-- § 18. CROSS-TABLE CONSISTENCY: FACTS vs EVENTS
-- Border totals in trip_facts must match summed border_facts child rows.
-- ──────────────────────────────────────────────────────────────────────────

WITH border_agg AS (
    SELECT
        trip_key,
        ROUND(SUM(dwell_hrs) FILTER (WHERE leg_direction = 'outbound'), 2)
                                    AS computed_ob_border_hrs,
        ROUND(SUM(dwell_hrs) FILTER (WHERE leg_direction = 'return'), 2)
                                    AS computed_ret_border_hrs,
        count(*) FILTER (WHERE leg_direction = 'outbound')
                                    AS computed_ob_count,
        count(*) FILTER (WHERE leg_direction = 'return')
                                    AS computed_ret_count
    FROM tat_trip_border_facts_v2
    GROUP BY trip_key
)
SELECT
    f.trip_key,
    f.tracker_name,
    f.loading_start::DATE,
    -- Outbound border hours
    f.outbound_border_total_hrs     AS fact_ob_hrs,
    ba.computed_ob_border_hrs       AS child_ob_hrs,
    ROUND(f.outbound_border_total_hrs - COALESCE(ba.computed_ob_border_hrs, 0), 2)
                                    AS ob_hrs_delta,
    -- Outbound border count
    f.outbound_border_count         AS fact_ob_count,
    ba.computed_ob_count            AS child_ob_count,
    -- Return border hours
    f.return_border_total_hrs       AS fact_ret_hrs,
    ba.computed_ret_border_hrs      AS child_ret_hrs,
    ROUND(f.return_border_total_hrs - COALESCE(ba.computed_ret_border_hrs, 0), 2)
                                    AS ret_hrs_delta
FROM tat_trip_facts_v2 f
LEFT JOIN border_agg ba ON ba.trip_key = f.trip_key
WHERE
    -- Facts say there are border hours but child table disagrees
    ABS(f.outbound_border_total_hrs - COALESCE(ba.computed_ob_border_hrs, 0)) > 0.5
 OR ABS(f.return_border_total_hrs   - COALESCE(ba.computed_ret_border_hrs, 0)) > 0.5
 OR f.outbound_border_count != COALESCE(ba.computed_ob_count, 0)
 OR f.return_border_count   != COALESCE(ba.computed_ret_count, 0)
ORDER BY ABS(f.outbound_border_total_hrs - COALESCE(ba.computed_ob_border_hrs, 0)) DESC
LIMIT 50;


-- ──────────────────────────────────────────────────────────────────────────
-- § 19. SAMPLE DRILL-DOWN: FULL LIFECYCLE FOR A SINGLE TRIP
-- Replace the trip_key literal to inspect any specific trip end-to-end.
-- ──────────────────────────────────────────────────────────────────────────

-- ① Trip facts summary
SELECT
    trip_key, tracker_name, loading_terminal, destination_name,
    trip_status, trip_type, trip_closure_reason,
    loading_start, loading_end, dar_arrival, origin_exit,
    dest_entry, dest_exit, trip_closed_at, completion_time,
    loading_phase_hrs, waiting_for_orders_hrs, transit_hrs,
    outbound_border_total_hrs, return_border_total_hrs,
    outbound_border_count, return_border_count,
    total_tat_hrs, lifecycle_confidence,
    missed_destination_flag, low_confidence_flag, has_destination_region_only
FROM tat_trip_facts_v2
WHERE trip_key = '3042058:1762850881';

-- ② All border crossings for this trip
SELECT
    border_code, border_name, leg_direction,
    entry_time, exit_time, dwell_hrs,
    event_confidence, inference_rule,
    array_length(source_event_ids, 1) AS src_event_count
FROM tat_trip_border_facts_v2
WHERE trip_key = '3042058:1762850881'
ORDER BY COALESCE(entry_time, exit_time);

-- ③ Full event timeline for this trip
SELECT
    event_time,
    event_code,
    canonical_name,
    role_code,
    trip_stage,
    leg_direction,
    border_code,
    ROUND(event_confidence, 2) AS conf,
    inference_rule
FROM trip_state_events
WHERE trip_key = '3042058:1762850881'
ORDER BY event_time;


-- ──────────────────────────────────────────────────────────────────────────
-- § 20. COMBINED DIAGNOSTIC SUMMARY  (run this for a quick health report)
-- One-shot overview: paste into SQL editor for a complete health snapshot.
-- ──────────────────────────────────────────────────────────────────────────

WITH

sys AS (
    SELECT
        (SELECT count(*) FROM tat_trip_facts_v2)            AS v2_trips,
        (SELECT count(*) FROM tat_trip_facts_v2 WHERE trip_status = 'completed')
                                                            AS completed,
        (SELECT count(*) FROM tat_trip_facts_v2 WHERE trip_status = 'completed_missed_dest')
                                                            AS missed_dest,
        (SELECT count(*) FROM tat_trip_facts_v2 WHERE low_confidence_flag) AS low_conf,
        (SELECT count(*) FROM tat_trip_facts_v2
         WHERE trip_status IN ('in_transit','returning')
           AND loading_start < now() - INTERVAL '45 days') AS stale_open,
        (SELECT count(*) FROM tat_trip_border_facts_v2)     AS border_crossings,
        (SELECT count(*) FROM tat_trip_border_facts_v2 WHERE exit_time IS NULL)
                                                            AS border_missing_exit,
        (SELECT count(*) FROM tat_trip_border_facts_v2 WHERE exit_time < entry_time)
                                                            AS border_negative_dwell,
        (SELECT count(*) FROM trip_state_events)            AS events_total,
        (SELECT count(DISTINCT trip_key) FROM trip_state_events) AS events_trips
),
v1v2 AS (
    SELECT
        (SELECT count(*) FROM tat_trips_data WHERE loading_start >= '2025-10-01') AS v1_trips,
        (SELECT count(*) FROM tat_trip_facts_v2 WHERE loading_start >= '2025-10-01') AS v2_trips
)

SELECT
    'v2_trips'              AS metric, v2_trips::TEXT            AS value FROM sys
UNION ALL SELECT 'completed',          completed::TEXT            FROM sys
UNION ALL SELECT 'missed_dest',        missed_dest::TEXT          FROM sys
UNION ALL SELECT 'low_conf',           low_conf::TEXT             FROM sys
UNION ALL SELECT 'stale_open_45d',     stale_open::TEXT           FROM sys
UNION ALL SELECT 'border_crossings',   border_crossings::TEXT     FROM sys
UNION ALL SELECT 'border_missing_exit',border_missing_exit::TEXT  FROM sys
UNION ALL SELECT 'border_neg_dwell',   border_negative_dwell::TEXT FROM sys
UNION ALL SELECT 'events_total',       events_total::TEXT         FROM sys
UNION ALL SELECT 'v1_trips_oct25+',    v1_trips::TEXT             FROM v1v2
UNION ALL SELECT 'v2_trips_oct25+',    v2_trips::TEXT             FROM v1v2
UNION ALL SELECT 'missing_exit_pct',
    ROUND(100.0 * border_missing_exit / NULLIF(border_crossings,0), 2)::TEXT || '%'
    FROM sys;
