-- =============================================================
-- TAT V2 REFACTOR: Phase 64
-- Midnight Split Hardening — Full Coverage
--
-- Problem:
--   Daily data populations end at 23:59:59 UTC. Any geofence visit
--   still open at that moment receives an artificial out_time of
--   23:59:59. This is NOT a physical exit. Downstream RPCs that
--   read tat_trip_facts_v2 directly (without the Phase 63 stream
--   guard) were treating these artificial exits as real ones, causing:
--     - False "Destination Exit" classifications
--     - Under-counted queue_count in loading/unloading zone stats
--     - "returning" status on trucks still physically at destination
--     - Incorrect queue age anchors (showing midnight boundary
--       instead of original arrival time)
--
-- Fixes applied in this phase:
--   1. get_active_queues_v2() — add loading_end midnight guard,
--      expose is_midnight_split_state + effective_trip_status per row
--   2. get_unloading_zone_stats_v2() — queue_count now counts trucks
--      whose dest_exit IS NULL OR is at 23:59:59 (midnight artifact)
--   3. get_loading_zone_stats_v2() — same safety guard on loading_end
--
-- Test case: Tracker 3024823 should appear in active_awaiting_unloading
-- with queue age measured from its original dest_entry, not from 23:59.
-- =============================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENHANCED: get_active_queues_v2()
--    Additions over Phase 63:
--      a) loading_end midnight guard in queue classification
--      b) is_midnight_split_state column in each data row
--      c) effective_trip_status column (overrides 'returning' → 'at_destination'
--         when the exit that triggered that status was a midnight artifact)
--      d) live_dwell_hrs: hours since the relevant entry timestamp (computed
--         server-side for the front-end to display without extra round-trips)
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
            -- ── Midnight-split guard: nullify exits at exactly 23:59:59 ──────
            CASE WHEN lt.dest_exit IS NOT NULL
                      AND lt.dest_exit::time = '23:59:59'::time
                 THEN NULL
                 ELSE lt.dest_exit
            END AS effective_dest_exit,
            CASE WHEN lt.customer_exit IS NOT NULL
                      AND lt.customer_exit::time = '23:59:59'::time
                 THEN NULL
                 ELSE lt.customer_exit
            END AS effective_customer_exit,
            CASE WHEN lt.loading_end IS NOT NULL
                      AND lt.loading_end::time = '23:59:59'::time
                 THEN NULL
                 ELSE lt.loading_end
            END AS effective_loading_end,

            -- ── Midnight-split state flag ─────────────────────────────────────
            -- TRUE when the most relevant "exit" timestamp is an artificial
            -- midnight boundary, meaning the truck is physically still present.
            (
                (lt.dest_exit     IS NOT NULL AND lt.dest_exit::time     = '23:59:59'::time)
             OR (lt.customer_exit IS NOT NULL AND lt.customer_exit::time = '23:59:59'::time)
             OR (lt.loading_end   IS NOT NULL AND lt.loading_end::time   = '23:59:59'::time)
            ) AS is_midnight_split_state,

            -- ── Effective trip status (override midnight artifacts) ────────────
            -- When the 'returning' status was set because of a midnight-split exit,
            -- report the true operational state instead.
            CASE
                WHEN lt.status = 'returning'
                     AND (
                         (lt.dest_exit     IS NOT NULL AND lt.dest_exit::time     = '23:59:59'::time)
                      OR (lt.customer_exit IS NOT NULL AND lt.customer_exit::time = '23:59:59'::time)
                     )
                THEN 'at_destination'
                WHEN lt.status = 'pre_transit'
                     AND lt.loading_end IS NOT NULL
                     AND lt.loading_end::time = '23:59:59'::time
                THEN 'loading'
                ELSE lt.status
            END AS effective_trip_status,

            -- ── Closure geofence: the canonical_name where the trip was finalized ──
            COALESCE(
                (SELECT tse.canonical_name
                 FROM trip_state_events tse
                 WHERE tse.trip_key = lt.trip_key
                   AND tse.event_code = 'trip_closed'
                 ORDER BY tse.event_time DESC
                 LIMIT 1),
                lt.loading_terminal
            ) AS closure_geofence,

            -- ── Last known destination ────────────────────────────────────────
            COALESCE(lt.destination_name, lt.customer_name) AS last_destination,

            -- ── is_returning: suppress if midnight artifact ────────────────────
            CASE
                WHEN lt.status = 'returning'
                     AND (
                         (lt.dest_exit::time = '23:59:59'::time AND lt.dest_entry IS NOT NULL)
                      OR (lt.customer_exit::time = '23:59:59'::time AND lt.customer_entry IS NOT NULL)
                     )
                THEN FALSE
                WHEN lt.status = 'returning'
                THEN TRUE
                WHEN (
                         CASE WHEN lt.dest_exit IS NOT NULL AND lt.dest_exit::time = '23:59:59'::time THEN NULL ELSE lt.dest_exit END
                         IS NOT NULL
                      OR CASE WHEN lt.customer_exit IS NOT NULL AND lt.customer_exit::time = '23:59:59'::time THEN NULL ELSE lt.customer_exit END
                         IS NOT NULL
                     )
                     AND lt.completion_time IS NULL
                     AND lt.trip_closed_at IS NULL
                     AND lt.next_loading_entry IS NULL
                THEN TRUE
                ELSE FALSE
            END AS is_returning,

            -- Geofence master joins for closure context
            gm_close.canonical_name AS closure_geofence_canonical,
            gm_dest.canonical_name  AS last_destination_canonical
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
    classified AS (
        SELECT
            e.*,
            -- ── Queue status classification ─────────────────────────────────
            CASE
                -- 1. Await Next Load: trip CLOSED and NOT returning
                WHEN e.status IN ('completed', 'completed_missed_dest')
                     AND e.next_loading_entry IS NULL
                     AND NOT (
                         e.status = 'returning'
                         OR (e.effective_dest_exit    IS NOT NULL AND e.completion_time IS NULL AND e.trip_closed_at IS NULL)
                         OR (e.effective_customer_exit IS NOT NULL AND e.completion_time IS NULL AND e.trip_closed_at IS NULL)
                     )
                THEN 'active_waiting_next_load'

                -- 2. At Border: open crossing in border facts
                WHEN EXISTS (
                    SELECT 1 FROM tat_trip_border_facts_v2 bf
                    WHERE bf.trip_key  = e.trip_key
                      AND bf.entry_time IS NOT NULL
                      AND bf.exit_time  IS NULL
                ) THEN 'active_at_border'

                -- 3. Awaiting Unloading: at destination, no REAL exit
                --    Midnight-boundary exits (23:59:59) do NOT count as exits.
                WHEN (e.dest_entry IS NOT NULL OR e.customer_entry IS NOT NULL)
                     AND e.effective_dest_exit     IS NULL
                     AND e.effective_customer_exit IS NULL
                THEN 'active_awaiting_unloading'

                -- 4. Just Delivered: has a REAL exit and is in returning phase
                WHEN e.status = 'returning'
                     AND (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                THEN 'active_just_delivered'
                WHEN (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                     AND e.completion_time IS NULL
                     AND e.next_loading_entry IS NULL
                THEN 'active_just_delivered'

                -- 5. Loading Live: loading started, NOT ended (or ended at midnight — still loading)
                WHEN e.loading_start IS NOT NULL
                     AND e.effective_loading_end IS NULL
                THEN 'active_loading_started'

                -- 6. Loaded / In Transit: loading completed with REAL end, no dest yet
                WHEN e.effective_loading_end IS NOT NULL
                     AND e.dest_entry IS NULL
                     AND e.customer_entry IS NULL
                THEN 'active_loading_completed'

                ELSE NULL
            END AS queue_status,

            -- ── Live dwell hours (server-side, from the correct anchor) ────────
            -- For awaiting-unload: (NOW - first entry); midnight boundary exits
            -- are ignored so this accumulates correctly across day boundaries.
            CASE
                WHEN e.dest_entry IS NOT NULL OR e.customer_entry IS NOT NULL
                THEN ROUND(
                    EXTRACT(EPOCH FROM (
                        NOW() - COALESCE(e.dest_entry, e.customer_entry)
                    )) / 3600.0
                , 2)
                ELSE NULL
            END AS live_dest_dwell_hrs,

            -- For loading: (NOW - loading_start)
            CASE
                WHEN e.loading_start IS NOT NULL AND e.effective_loading_end IS NULL
                THEN ROUND(
                    EXTRACT(EPOCH FROM (NOW() - e.loading_start)) / 3600.0
                , 2)
                ELSE NULL
            END AS live_loading_dwell_hrs
        FROM enriched e
    ),
    active_rows AS (
        SELECT * FROM classified
        WHERE queue_status IS NOT NULL
    ),
    counts AS (
        SELECT
            COUNT(*)                                                            AS active_all,
            COUNT(*) FILTER (WHERE queue_status = 'active_loading_started')    AS active_loading_started,
            COUNT(*) FILTER (WHERE queue_status = 'active_loading_completed')  AS active_loading_completed,
            COUNT(*) FILTER (WHERE queue_status = 'active_at_border')          AS active_at_border,
            COUNT(*) FILTER (WHERE queue_status = 'active_awaiting_unloading') AS active_awaiting_unloading,
            COUNT(*) FILTER (WHERE queue_status = 'active_just_delivered')     AS active_just_delivered,
            COUNT(*) FILTER (WHERE queue_status = 'active_waiting_next_load')  AS active_waiting_next_load
        FROM active_rows
    )
    SELECT json_build_object(
        'generated_at',        NOW(),
        'active_queue_counts', (SELECT row_to_json(c) FROM counts c),
        'data', COALESCE(
            (SELECT json_agg(row_to_json(r) ORDER BY r.loading_start DESC)
             FROM (
                SELECT
                    ar.tracker_id,
                    ar.tracker_name,
                    ar.trip_key,
                    ar.status                  AS trip_status,
                    ar.effective_trip_status,
                    ar.trip_type,
                    ar.loading_terminal,
                    ar.origin_region,
                    ar.destination_name,
                    ar.customer_name,
                    ar.loading_start,
                    ar.loading_end,
                    ar.effective_loading_end,
                    ar.dest_entry,
                    ar.dest_exit,
                    ar.effective_dest_exit,
                    ar.customer_entry,
                    ar.customer_exit,
                    ar.effective_customer_exit,
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
                    ar.is_midnight_split_state,
                    ar.queue_status            AS active_queue_status,
                    ar.live_dest_dwell_hrs,
                    ar.live_loading_dwell_hrs,
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
-- 2. FIX: get_unloading_zone_stats_v2()
--    queue_count now correctly counts trucks whose dest_exit is either NULL
--    (truck still present with no data yet) OR at 23:59:59 (midnight artifact,
--    truck physically still present). Previously midnight-split exits were
--    treated as real exits, causing queue under-counting.
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
            ROUND(AVG(total_tat_hrs)::NUMERIC, 1)   AS avg_tat_hrs,
            ROUND(AVG(transit_hrs)::NUMERIC, 1)     AS avg_transit_hrs,
            -- Midnight-split guard: a dest_exit at 23:59:59 is NOT a real exit.
            -- Count trucks where dest_exit is NULL (no data yet) OR is a midnight
            -- boundary (truck still physically present at the destination).
            COUNT(*) FILTER (WHERE
                (dest_exit IS NULL OR dest_exit::time = '23:59:59'::time)
                AND (dest_entry IS NOT NULL OR customer_entry IS NOT NULL)
            ) AS queue_count,
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
-- 3. FIX: get_loading_zone_stats_v2()
--    queue_count safety guard: loading_end at 23:59:59 means the truck was
--    still in the loading terminal when the daily data window closed — it is
--    NOT confirmed as having finished loading. Treat it as still loading.
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
            ROUND(AVG(loading_phase_hrs)::NUMERIC, 1) AS avg_dwell_hrs,
            ROUND(AVG(waiting_for_orders_hrs)::NUMERIC, 1) AS avg_wait_hrs,
            -- Midnight-split guard: loading_end at 23:59:59 = still loading
            COUNT(*) FILTER (WHERE
                loading_end IS NULL
                OR loading_end::time = '23:59:59'::time
            ) AS queue_count,
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
-- 4. GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_loading_zone_stats_v2(TIMESTAMPTZ, TIMESTAMPTZ)   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unloading_zone_stats_v2(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;
