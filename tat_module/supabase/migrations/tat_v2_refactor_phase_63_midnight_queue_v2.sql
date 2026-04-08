-- =============================================================
-- TAT V2 REFACTOR: Phase 63
-- Features:
--   1. Midnight Split Continuity Filter (LEAD-based suppression)
--   2. Refined "Await Next Load" Queue Engine (strict closure + is_returning)
--   3. get_active_queues_v2() RPC with geofence_master canonical_name join
--   4. Loading/Unloading zone RPCs respect midnight-stitched dwell
-- =============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HELPER: is_midnight_split_pair(exit_ts, next_entry_ts)
--    Returns TRUE when an exit at 23:59:59 is followed by an entry at 00:00:00
--    on the next calendar day for the same entity.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_midnight_split_pair(
    p_exit_ts  TIMESTAMPTZ,
    p_entry_ts TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT
        p_exit_ts IS NOT NULL
        AND p_entry_ts IS NOT NULL
        AND p_exit_ts::time = '23:59:59'::time
        AND p_entry_ts::time = '00:00:00'::time
        AND (p_entry_ts::date - p_exit_ts::date) = 1;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. VIEW: v_trip_state_events_midnight_filtered
--    Uses LEAD to detect midnight split pairs within the same trip_key + 
--    geofence (canonical_name). Suppresses the exit event at 23:59:59 and
--    the entry event at 00:00:00 from milestone consideration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_trip_state_events_midnight_filtered AS
WITH annotated AS (
    SELECT
        tse.*,
        LEAD(tse.event_time) OVER (
            PARTITION BY tse.trip_key, tse.canonical_name
            ORDER BY tse.event_time, tse.event_id
        ) AS next_event_time,
        LEAD(tse.event_code) OVER (
            PARTITION BY tse.trip_key, tse.canonical_name
            ORDER BY tse.event_time, tse.event_id
        ) AS next_event_code,
        LAG(tse.event_time) OVER (
            PARTITION BY tse.trip_key, tse.canonical_name
            ORDER BY tse.event_time, tse.event_id
        ) AS prev_event_time,
        LAG(tse.event_code) OVER (
            PARTITION BY tse.trip_key, tse.canonical_name
            ORDER BY tse.event_time, tse.event_id
        ) AS prev_event_code
    FROM public.trip_state_events tse
)
SELECT *,
    -- Flag: this exit is artificial (midnight boundary, next event is re-entry at 00:00:00)
    CASE 
        WHEN event_code LIKE '%_exit' 
             AND public.is_midnight_split_pair(event_time, next_event_time)
             AND next_event_code LIKE '%_entry'
        THEN TRUE
        ELSE FALSE
    END AS is_midnight_exit,
    -- Flag: this entry is artificial (follows a midnight split exit)
    CASE 
        WHEN event_code LIKE '%_entry'
             AND public.is_midnight_split_pair(prev_event_time, event_time)
             AND prev_event_code LIKE '%_exit'
        THEN TRUE
        ELSE FALSE
    END AS is_midnight_reentry
FROM annotated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: get_active_queues_v2()
--    Returns the live queue snapshot with:
--    - Strict "Await Next Load" logic (CLOSED + not returning)
--    - closure_geofence / last_destination from geofence_master
--    - Midnight-split aware dwell calculations
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_active_queues_v2();

CREATE OR REPLACE FUNCTION public.get_active_queues_v2()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH latest_trips AS (
        -- Grab the most recent trip per tracker (last 90 days)
        SELECT DISTINCT ON (t.tracker_id)
            t.*
        FROM tat_trip_facts_v2 t
        WHERE t.loading_start >= NOW() - INTERVAL '90 days'
        ORDER BY t.tracker_id, t.loading_start DESC
    ),
    enriched AS (
        SELECT
            lt.*,
            -- ── Midnight-split guard: nullify exits at exactly 23:59:59 ──
            CASE WHEN lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END
                AS effective_dest_exit,
            CASE WHEN lt.customer_exit::time = '23:59:59'::time THEN NULL ELSE lt.customer_exit END
                AS effective_customer_exit,
            -- Closure geofence: the canonical_name where the trip was finalized
            COALESCE(
                -- From trip_closed event
                (SELECT tse.canonical_name
                 FROM trip_state_events tse
                 WHERE tse.trip_key = lt.trip_key
                   AND tse.event_code = 'trip_closed'
                 ORDER BY tse.event_time DESC
                 LIMIT 1),
                -- Fallback: return_origin from context
                lt.loading_terminal
            ) AS closure_geofence,
            -- Last known destination
            COALESCE(lt.destination_name, lt.customer_name) AS last_destination,
            -- Determine is_returning: truck is between effective dest_exit and origin re-entry
            -- Midnight-boundary exits are NOT real exits
            CASE
                WHEN lt.status = 'returning'
                     AND lt.dest_exit::time = '23:59:59'::time
                     AND lt.dest_entry IS NOT NULL
                THEN FALSE  -- Status says returning but it's a midnight artifact
                WHEN lt.status = 'returning' THEN TRUE
                WHEN (CASE WHEN lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END) IS NOT NULL 
                     AND lt.completion_time IS NULL 
                     AND lt.trip_closed_at IS NULL
                     AND lt.next_loading_entry IS NULL
                THEN TRUE
                ELSE FALSE
            END AS is_returning,
            -- Classify queue status with strict rules + midnight guards
            CASE
                -- Await Next Load: Trip CLOSED + NOT returning
                WHEN lt.status IN ('completed', 'completed_missed_dest')
                     AND lt.next_loading_entry IS NULL
                     AND NOT (
                         lt.status = 'returning' 
                         OR ((CASE WHEN lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END) IS NOT NULL 
                             AND lt.completion_time IS NULL 
                             AND lt.trip_closed_at IS NULL)
                     )
                THEN 'active_waiting_next_load'
                -- At Border (open crossing)
                WHEN EXISTS (
                    SELECT 1 FROM tat_trip_border_facts_v2 bf
                    WHERE bf.trip_key = lt.trip_key
                      AND bf.entry_time IS NOT NULL
                      AND bf.exit_time IS NULL
                ) THEN 'active_at_border'
                -- Awaiting Unloading: at destination with NO real exit
                -- Midnight-boundary exits (23:59:59) = truck is still there
                WHEN (lt.dest_entry IS NOT NULL OR lt.customer_entry IS NOT NULL)
                     AND (CASE WHEN lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END) IS NULL
                     AND (CASE WHEN lt.customer_exit::time = '23:59:59'::time THEN NULL ELSE lt.customer_exit END) IS NULL
                THEN 'active_awaiting_unloading'
                -- Just Delivered (exited destination with a REAL exit, in returning phase)
                WHEN lt.status = 'returning'
                     AND (CASE WHEN lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END) IS NOT NULL
                THEN 'active_just_delivered'
                WHEN (CASE WHEN lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END) IS NOT NULL
                     AND lt.completion_time IS NULL AND lt.next_loading_entry IS NULL
                THEN 'active_just_delivered'
                -- Loading Live
                WHEN lt.loading_start IS NOT NULL AND lt.loading_end IS NULL
                THEN 'active_loading_started'
                -- Loaded (in transit)
                WHEN lt.loading_end IS NOT NULL 
                     AND lt.dest_entry IS NULL AND lt.customer_entry IS NULL
                THEN 'active_loading_completed'
                ELSE NULL
            END AS queue_status,
            -- Geofence master join for closure context
            gm_close.canonical_name AS closure_geofence_canonical,
            gm_dest.canonical_name AS last_destination_canonical
        FROM latest_trips lt
        LEFT JOIN geofence_master gm_close
          ON UPPER(gm_close.canonical_name) = UPPER(
                COALESCE(
                    (SELECT tse.canonical_name
                     FROM trip_state_events tse
                     WHERE tse.trip_key = lt.trip_key
                       AND tse.event_code = 'trip_closed'
                     ORDER BY tse.event_time DESC
                     LIMIT 1),
                    lt.loading_terminal
                )
             )
        LEFT JOIN geofence_master gm_dest
          ON UPPER(gm_dest.canonical_name) = UPPER(COALESCE(lt.destination_name, lt.customer_name))
    ),
    active_rows AS (
        SELECT * FROM enriched
        WHERE queue_status IS NOT NULL
    ),
    counts AS (
        SELECT
            COUNT(*) AS active_all,
            COUNT(*) FILTER (WHERE queue_status = 'active_loading_started') AS active_loading_started,
            COUNT(*) FILTER (WHERE queue_status = 'active_loading_completed') AS active_loading_completed,
            COUNT(*) FILTER (WHERE queue_status = 'active_at_border') AS active_at_border,
            COUNT(*) FILTER (WHERE queue_status = 'active_awaiting_unloading') AS active_awaiting_unloading,
            COUNT(*) FILTER (WHERE queue_status = 'active_just_delivered') AS active_just_delivered,
            COUNT(*) FILTER (WHERE queue_status = 'active_waiting_next_load') AS active_waiting_next_load
        FROM active_rows
    )
    SELECT json_build_object(
        'generated_at', NOW(),
        'active_queue_counts', (SELECT row_to_json(c) FROM counts c),
        'data', COALESCE(
            (SELECT json_agg(row_to_json(r) ORDER BY r.loading_start DESC)
             FROM (
                SELECT
                    ar.tracker_id,
                    ar.tracker_name,
                    ar.trip_key,
                    ar.status AS trip_status,
                    ar.trip_type,
                    ar.loading_terminal,
                    ar.origin_region,
                    ar.destination_name,
                    ar.customer_name,
                    ar.loading_start,
                    ar.loading_end,
                    ar.dest_entry,
                    ar.dest_exit,
                    ar.customer_entry,
                    ar.customer_exit,
                    ar.completion_time,
                    ar.trip_closed_at,
                    ar.next_loading_entry,
                    ar.total_tat_hrs,
                    ar.transit_hrs,
                    ar.loading_phase_hrs,
                    ar.post_loading_delay_hrs,
                    ar.return_hrs,
                    ar.closure_geofence,
                    ar.last_destination,
                    ar.is_returning,
                    ar.queue_status AS active_queue_status,
                    ar.closure_geofence_canonical,
                    ar.last_destination_canonical
                FROM active_rows ar
             ) r),
            '[]'::json
        )
    ) INTO v_result;

    RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.get_active_queues_v2() TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPDATE: get_loading_zone_stats_v2 — midnight-stitched metric
--    Uses the stitched visit_end (from the operational stream which already
--    performs per-geofence stitching) so split stays are one continuous block.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_loading_zone_stats_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT 
            loading_terminal AS zone_name,
            COUNT(*) AS trip_count,
            -- Use stitched dwell: loading_phase_hrs already computed from stitched stream
            ROUND(AVG(loading_phase_hrs)::NUMERIC, 1) AS avg_dwell_hrs,
            ROUND(AVG(waiting_for_orders_hrs)::NUMERIC, 1) AS avg_wait_hrs,
            COUNT(*) FILTER (WHERE loading_end IS NULL) AS queue_count,
            ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY loading_phase_hrs)::NUMERIC, 1) AS p90_dwell_hrs
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date 
          AND loading_start <= p_end_date
          AND loading_terminal IS NOT NULL
        GROUP BY loading_terminal
        ORDER BY trip_count DESC
    ) r;
    RETURN COALESCE(v_result, '[]'::json);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. UPDATE: get_unloading_zone_stats_v2 — midnight-stitched metric
--    destination_dwell_hrs is already computed from the stitched visit stream
--    where midnight splits are merged into single continuous stays.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_unloading_zone_stats_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT 
            COALESCE(destination_name, customer_name) AS zone_name,
            COUNT(*) AS trip_count,
            -- Stitched dwell: already midnight-continuous from the visit stream
            ROUND(AVG(COALESCE(destination_dwell_hrs, customer_dwell_hrs))::NUMERIC, 1) AS avg_dwell_hrs,
            ROUND(AVG(total_tat_hrs)::NUMERIC, 1) AS avg_tat_hrs,
            ROUND(AVG(transit_hrs)::NUMERIC, 1) AS avg_transit_hrs,
            COUNT(*) FILTER (WHERE dest_exit IS NULL AND dest_entry IS NOT NULL) AS queue_count,
            -- P90 for unloading (new)
            ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (
                ORDER BY COALESCE(destination_dwell_hrs, customer_dwell_hrs)
            )::NUMERIC, 1) AS p90_dwell_hrs
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date 
          AND loading_start <= p_end_date
          AND (destination_name IS NOT NULL OR customer_name IS NOT NULL)
        GROUP BY COALESCE(destination_name, customer_name)
        ORDER BY trip_count DESC
    ) r;
    RETURN COALESCE(v_result, '[]'::json);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GRANT permissions
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.is_midnight_split_pair(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;
