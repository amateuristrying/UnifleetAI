-- =============================================================
-- TAT V2 REFACTOR: Phase 73
-- Hybrid Live Loading Supplement for get_active_queues_v2
--
-- Fixes two bugs discovered via diagnostic queries (2026-04-05):
--
-- BUG 1 — active_waiting_next_load steals trucks that are still loading:
--   A truck can have status = 'completed_missed_dest' AND loading_end IS NULL
--   (e.g., trip closed by timeout/next-session proximity while still at terminal).
--   The original WHEN order puts active_waiting_next_load BEFORE
--   active_loading_started, so these trucks land in the wrong queue.
--   Fix: add guard `AND e.effective_loading_end IS NOT NULL` to the
--   active_waiting_next_load branch — if loading is still open, skip it.
--
-- BUG 2 — live supplement never finds loading terminals:
--   The Supabase `geofences` table (used by Phase 72) has broad zone polygons
--   (e.g., "Dar Geofence") but NOT the small loading terminal polygons
--   (TIPER DEPOT, ORYX, etc.). Phase 72 picks the smallest matching polygon,
--   so trucks at loading terminals only match the broad zone → they appear in
--   live_tracker_geofence_state as 'Dar Geofence' (origin_gateway), never as
--   the specific terminal. Joining on origin_terminal finds zero rows.
--   Fix: also match origin_gateway zones. Use the tracker's last known
--   loading_terminal from tat_trip_facts_v2 as the terminal name, and require
--   session_start > last loading_end to confirm this is a NEW loading session.
--
-- Changes vs Phase 71:
--   1. active_waiting_next_load WHEN gains: AND e.effective_loading_end IS NOT NULL
--   2. live_loading_supplement joins origin_gateway + origin_terminal, uses
--      last known terminal as fallback, guards on session_start > loading_end
-- =============================================================

INSERT INTO geofence_master (canonical_name, default_role_code, site_type, country_code, is_active)
VALUES 
  ('Mtwara GF', 'origin_zone_mtwara', 'zone', 'TZ', TRUE),
  ('DAR GEOFENCE', 'origin_gateway', 'gateway', 'TZ', TRUE),
  ('KILUVYA GATEWAY', 'origin_gateway', 'gateway', 'TZ', TRUE)
ON CONFLICT (canonical_name) DO UPDATE SET 
    default_role_code = EXCLUDED.default_role_code,
    site_type = EXCLUDED.site_type;

CREATE OR REPLACE FUNCTION public.get_active_queues_v2()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH latest_trips AS (
        SELECT DISTINCT ON (t.tracker_id)
            t.*
        FROM tat_trip_facts_v2 t
        WHERE t.loading_start >= NOW() - INTERVAL '90 days'
        ORDER BY t.tracker_id, t.loading_start DESC
    ),
    enriched AS (
        SELECT
            lt.*,
            -- MULTI-STOP FIX:
            CASE
                 WHEN (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END) IS NOT NULL
                      AND (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)::time = '23:59:59'::time
                 THEN NULL
                 ELSE (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)
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

            (
                ((CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END) IS NOT NULL
                 AND (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)::time = '23:59:59'::time)
             OR (lt.customer_exit IS NOT NULL AND lt.customer_exit::time = '23:59:59'::time)
             OR (lt.loading_end   IS NOT NULL AND lt.loading_end::time   = '23:59:59'::time)
            ) AS is_midnight_split_state,

            CASE
                WHEN lt.status = 'returning'
                     AND (
                         ((CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END) IS NOT NULL
                          AND (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)::time = '23:59:59'::time)
                      OR (lt.customer_exit IS NOT NULL AND lt.customer_exit::time = '23:59:59'::time)
                     )
                THEN 'at_destination'
                WHEN lt.status = 'pre_transit'
                     AND lt.loading_end IS NOT NULL
                     AND lt.loading_end::time = '23:59:59'::time
                THEN 'loading'
                ELSE lt.status
            END AS effective_trip_status,

            COALESCE(
                (SELECT tse.canonical_name
                 FROM trip_state_events tse
                 WHERE tse.trip_key = lt.trip_key
                   AND tse.event_code = 'trip_closed'
                 ORDER BY tse.event_time DESC
                 LIMIT 1),
                lt.last_dest_name,
                lt.destination_name,
                lt.customer_name,
                lt.loading_terminal
            ) AS closure_geofence,

            COALESCE(lt.last_dest_name, lt.destination_name, lt.customer_name) AS last_destination,

            -- ABSOLUTE LAST LIVE GEOFENCE (Cross-trip aware)
            (
                SELECT n.canonical_name
                FROM trip_geofence_events_normalized n
                WHERE n.tracker_id = lt.tracker_id
                ORDER BY n.in_time DESC
                LIMIT 1
            ) AS last_known_geofence,

            CASE
                WHEN lt.status = 'returning'
                     AND (
                         ((CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)::time = '23:59:59'::time AND lt.dest_entry IS NOT NULL)
                      OR (lt.customer_exit::time = '23:59:59'::time AND lt.customer_entry IS NOT NULL)
                     )
                THEN FALSE
                WHEN lt.status = 'returning'
                THEN TRUE
                WHEN (
                         CASE WHEN (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END) IS NOT NULL
                              AND (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)::time = '23:59:59'::time
                              THEN NULL
                              ELSE (CASE WHEN lt.dest_stop_count > 0 THEN lt.last_dest_exit ELSE lt.dest_exit END)
                         END IS NOT NULL
                      OR CASE WHEN lt.customer_exit IS NOT NULL AND lt.customer_exit::time = '23:59:59'::time THEN NULL ELSE lt.customer_exit END
                         IS NOT NULL
                     )
                     AND lt.completion_time IS NULL
                     AND lt.trip_closed_at IS NULL
                     AND lt.next_loading_entry IS NULL
                THEN TRUE
                ELSE FALSE
            END AS is_returning,

            -- Inject multi-stop array directly from facts
            (
                SELECT json_agg(json_build_object(
                    'name', df.canonical_name,
                    'dwell_hrs', ROUND(COALESCE(df.dwell_hrs, EXTRACT(EPOCH FROM (NOW() - df.entry_time)) / 3600.0)::numeric, 2),
                    'is_current', df.is_current,
                    'sequence', df.dest_sequence
                ) ORDER BY df.dest_sequence)
                FROM public.tat_trip_destination_facts_v2 df
                WHERE df.trip_key = lt.trip_key
            ) AS destinations_array,

            -- INJECT BORDER CROSSINGS (Phase 71 fix)
            (
                SELECT json_agg(json_build_object(
                    'border_name', COALESCE(bf.border_name, 'Border checkpoint'),
                    'entry_time', bf.entry_time,
                    'exit_time', bf.exit_time
                ) ORDER BY bf.entry_time ASC)
                FROM public.tat_trip_border_facts_v2 bf
                WHERE bf.trip_key = lt.trip_key
            ) AS border_crossings,

            -- LIVE METRICS FIX (Phase 71): computed properties if currently active
            CASE
                WHEN lt.transit_hrs IS NULL AND lt.loading_end IS NOT NULL THEN
                    ROUND(EXTRACT(EPOCH FROM (
                        COALESCE(lt.dest_entry, lt.customer_entry, NOW()) - lt.loading_end
                    )) / 3600.0, 2)
                ELSE lt.transit_hrs
            END AS live_transit_hrs,

            CASE
                WHEN lt.loading_phase_hrs IS NULL AND lt.loading_start IS NOT NULL THEN
                    ROUND(EXTRACT(EPOCH FROM (
                        COALESCE(lt.loading_end, NOW()) - lt.loading_start
                    )) / 3600.0, 2)
                ELSE lt.loading_phase_hrs
            END AS live_loading_phase_hrs,

            CASE
                WHEN lt.total_tat_hrs IS NULL AND lt.loading_start IS NOT NULL THEN
                    ROUND(EXTRACT(EPOCH FROM (NOW() - lt.loading_start)) / 3600.0, 2)
                ELSE lt.total_tat_hrs
            END AS live_tat_hrs,

            gm_close.canonical_name AS closure_geofence_canonical,
            gm_dest.canonical_name  AS last_destination_canonical,
            gm_close.default_role_code AS closure_geofence_role,
            gm_dest.default_role_code  AS last_destination_role
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
          ON UPPER(gm_dest.canonical_name) = UPPER(COALESCE(lt.last_dest_name, lt.destination_name, lt.customer_name))
    ),
    classified AS (
        SELECT
            e.*,
            CASE
                -- BUG 1 FIX: guard with effective_loading_end IS NOT NULL so trucks
                -- whose loading is still open (loading_end IS NULL or 23:59:59 boundary)
                -- are not stolen by this branch and correctly reach active_loading_started.
                WHEN e.status IN ('completed', 'completed_missed_dest')
                     AND e.next_loading_entry IS NULL
                     AND e.effective_loading_end IS NOT NULL
                     AND NOT (
                         e.status = 'returning'
                         OR (e.effective_dest_exit    IS NOT NULL AND e.completion_time IS NULL AND e.trip_closed_at IS NULL)
                         OR (e.effective_customer_exit IS NOT NULL AND e.completion_time IS NULL AND e.trip_closed_at IS NULL)
                     )
                THEN 'active_waiting_next_load'

                WHEN EXISTS (
                    SELECT 1 FROM tat_trip_border_facts_v2 bf
                    WHERE bf.trip_key  = e.trip_key
                      AND bf.entry_time IS NOT NULL
                      AND bf.exit_time  IS NULL
                ) THEN 'active_at_border'

                WHEN (e.dest_entry IS NOT NULL OR e.customer_entry IS NOT NULL)
                     AND e.effective_dest_exit     IS NULL
                     AND e.effective_customer_exit IS NULL
                THEN 'active_awaiting_unloading'

                WHEN e.status = 'returning'
                     AND (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                THEN 'active_just_delivered'

                WHEN (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                     AND e.completion_time IS NULL
                     AND e.next_loading_entry IS NULL
                THEN 'active_just_delivered'

                WHEN e.loading_start IS NOT NULL
                     AND e.effective_loading_end IS NULL
                     AND (e.closure_geofence_role LIKE 'origin_terminal%' OR e.closure_geofence_role LIKE 'origin_zone%')
                THEN 'active_loading_started'
                
                -- Catch-all for other origin-based active states mapping to waiting
                WHEN e.loading_start IS NOT NULL
                     AND e.effective_loading_end IS NULL
                THEN 'active_waiting_next_load'

                WHEN e.effective_loading_end IS NOT NULL
                     AND e.dest_entry IS NULL
                     AND e.customer_entry IS NULL
                THEN 'active_loading_completed'

                ELSE NULL
            END AS queue_status,

            CASE
                WHEN e.dest_entry IS NOT NULL OR e.customer_entry IS NOT NULL
                THEN ROUND(
                    EXTRACT(EPOCH FROM (
                        NOW() - COALESCE(e.dest_entry, e.customer_entry)
                    )) / 3600.0
                , 2)
                ELSE NULL
            END AS live_dest_dwell_hrs,

            CASE
                WHEN e.loading_start IS NOT NULL AND e.effective_loading_end IS NULL
                THEN ROUND(
                    EXTRACT(EPOCH FROM (NOW() - e.loading_start)) / 3600.0
                , 2)
                ELSE NULL
            END AS live_loading_dwell_hrs,

            CASE
                WHEN e.effective_dest_exit IS NULL THEN NULL
                ELSE e.return_hrs
            END AS effective_return_hrs
        FROM enriched e
    ),

    -- ── PHASE 73: Live loading supplement ────────────────────────────────────
    -- Trackers already captured as active_loading_started by the daily rebuild.
    -- Used to avoid duplicating them in the live supplement.
    daily_loading_trackers AS (
        SELECT tracker_id
        FROM classified
        WHERE queue_status = 'active_loading_started'
    ),
    -- BUG 2 FIX: Trucks at loading terminals show up as 'origin_gateway' broad zones
    -- (e.g., "Dar Geofence") in live_tracker_geofence_state because the Supabase
    -- `geofences` table has large zone polygons but not the small terminal polygons.
    --
    -- Strategy: match on BOTH origin_terminal AND origin_gateway roles.
    -- For origin_gateway trucks, use their last known loading_terminal from
    -- tat_trip_facts_v2 as the terminal name (best-guess for display).
    -- Guard: session_start must be AFTER the last loading_end to confirm this is
    -- a NEW session (not the same truck still parked from a previous load).
    -- Debounce: session must be > 30 minutes old to exclude drive-through pings.
    last_completed_loading AS (
        SELECT DISTINCT ON (tracker_id)
            tracker_id,
            loading_terminal,
            loading_end,
            destination_name,
            customer_name,
            trip_type,
            origin_region
        FROM tat_trip_facts_v2
        WHERE loading_end IS NOT NULL
        ORDER BY tracker_id, loading_start DESC
    ),
    live_loading_supplement AS (
        SELECT
            ls.tracker_id,
            ls.tracker_name,
            -- Synthetic trip_key prefixed 'live:' — ephemeral, not in trip_state_events
            'live:' || ls.tracker_id::TEXT AS trip_key,
            -- For origin_terminal match: use matched canonical name directly
            -- For origin_gateway match: fall back to last known loading terminal
            COALESCE(
                CASE WHEN gm.default_role_code = 'origin_terminal' THEN gm.canonical_name END,
                lcl.loading_terminal,
                gm.canonical_name
            ) AS loading_terminal,
            ls.session_start               AS loading_start,
            ROUND(
                EXTRACT(EPOCH FROM (NOW() - ls.session_start)) / 3600.0
            , 2)                           AS live_loading_dwell_hrs,
            -- Smart fallbacks for trip properties from last completed load
            lcl.trip_type,
            lcl.destination_name,
            lcl.customer_name,
            lcl.origin_region
        FROM live_tracker_geofence_state ls
        -- Match origin_terminal OR origin_gateway zones
        JOIN geofence_master gm
          ON UPPER(gm.canonical_name) = UPPER(ls.current_geofence_name)
         AND (gm.default_role_code LIKE 'origin_terminal%' OR gm.default_role_code LIKE 'origin_zone%')
        -- Last completed loading session for this tracker (to infer terminal and guard)
        LEFT JOIN last_completed_loading lcl
          ON lcl.tracker_id = ls.tracker_id
        WHERE ls.current_geofence_id IS NOT NULL
          AND ls.session_start IS NOT NULL
          -- Stale session guard: ignore sessions older than 5 days
          AND ls.session_start >= NOW() - INTERVAL '5 days'
          AND (lcl.loading_end IS NULL OR ls.session_start > lcl.loading_end)
          -- Debounce: must be in zone for at least 30 min (not passing through)
          AND ls.session_start <= NOW() - INTERVAL '30 minutes'
          -- Exclude trackers already covered by the daily rebuild
          AND NOT EXISTS (
              SELECT 1 FROM daily_loading_trackers dlt
              WHERE dlt.tracker_id = ls.tracker_id
          )
    ),
    -- ─────────────────────────────────────────────────────────────────────────

    active_rows AS (
        -- Original active rows from daily rebuild
        SELECT
            tracker_id,
            tracker_name,
            trip_key,
            status            AS trip_status,
            effective_trip_status,
            trip_type,
            loading_terminal,
            origin_region,
            destination_name,
            customer_name,
            loading_start,
            loading_end,
            effective_loading_end,
            dest_entry,
            dest_exit,
            effective_dest_exit,
            customer_entry,
            customer_exit,
            effective_customer_exit,
            completion_time,
            trip_closed_at,
            next_loading_entry,
            live_tat_hrs            AS total_tat_hrs,
            live_transit_hrs        AS transit_hrs,
            live_loading_phase_hrs  AS loading_phase_hrs,
            post_loading_delay_hrs,
            effective_return_hrs    AS return_hrs,
            closure_geofence,
            last_destination,
            last_known_geofence,
            is_returning,
            is_midnight_split_state,
            queue_status            AS active_queue_status,
            live_dest_dwell_hrs,
            live_loading_dwell_hrs,
            dest_stop_count,
            destinations_array,
            border_crossings,
            closure_geofence_canonical,
            last_destination_canonical,
            closure_geofence_role,
            last_destination_role
        FROM classified
        WHERE queue_status IS NOT NULL

        UNION ALL

        -- PHASE 73: Synthetic rows for trucks live-loading but not yet in daily rebuild
        SELECT
            lls.tracker_id,
            lls.tracker_name,
            lls.trip_key,
            'loading'             AS trip_status,
            'loading'             AS effective_trip_status,
            lls.trip_type,
            lls.loading_terminal,
            lls.origin_region,
            lls.destination_name,
            lls.customer_name,
            lls.loading_start,
            NULL                  AS loading_end,
            NULL                  AS effective_loading_end,
            NULL                  AS dest_entry,
            NULL                  AS dest_exit,
            NULL                  AS effective_dest_exit,
            NULL                  AS customer_entry,
            NULL                  AS customer_exit,
            NULL                  AS effective_customer_exit,
            NULL                  AS completion_time,
            NULL                  AS trip_closed_at,
            NULL                  AS next_loading_entry,
            lls.live_loading_dwell_hrs AS total_tat_hrs,
            NULL                  AS transit_hrs,
            lls.live_loading_dwell_hrs AS loading_phase_hrs,
            NULL                  AS post_loading_delay_hrs,
            NULL                  AS return_hrs,
            lls.loading_terminal  AS closure_geofence,
            NULL                  AS last_destination,
            lls.loading_terminal  AS last_known_geofence,
            FALSE                 AS is_returning,
            FALSE                 AS is_midnight_split_state,
            'active_loading_started' AS active_queue_status,
            NULL                  AS live_dest_dwell_hrs,
            lls.live_loading_dwell_hrs,
            NULL                  AS dest_stop_count,
            NULL                  AS destinations_array,
            NULL                  AS border_crossings,
            NULL                  AS closure_geofence_canonical,
            NULL                  AS last_destination_canonical,
            'origin_terminal'     AS closure_geofence_role,
            NULL                  AS last_destination_role
        FROM live_loading_supplement lls
    ),
    counts AS (
        SELECT
            COUNT(*)                                                            AS active_all,
            COUNT(*) FILTER (WHERE active_queue_status = 'active_loading_started')    AS active_loading_started,
            COUNT(*) FILTER (WHERE active_queue_status = 'active_loading_completed')  AS active_loading_completed,
            COUNT(*) FILTER (WHERE active_queue_status = 'active_at_border')          AS active_at_border,
            COUNT(*) FILTER (WHERE active_queue_status = 'active_awaiting_unloading') AS active_awaiting_unloading,
            COUNT(*) FILTER (WHERE active_queue_status = 'active_just_delivered')     AS active_just_delivered,
            COUNT(*) FILTER (WHERE active_queue_status = 'active_waiting_next_load')  AS active_waiting_next_load
        FROM active_rows
    )
    SELECT json_build_object(
        'generated_at',        NOW(),
        'active_queue_counts', (SELECT row_to_json(c) FROM counts c),
        'data', COALESCE(
            (SELECT json_agg(row_to_json(r) ORDER BY r.loading_start DESC)
             FROM (SELECT * FROM active_rows) r),
            '[]'::json
        )
    ) INTO v_result;

    RETURN v_result;
END $$;
