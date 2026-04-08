-- =============================================================
-- TAT V2 REFACTOR: Phase 71
-- Active Queue UI Data Enhancements
--
-- 1. Injects `border_crossings` array mapping from `tat_trip_border_facts_v2` 
--    so the At Border queue has its timestamps populated.
-- 2. Calculates live transit_hrs if still in transit.
-- 3. Calculates live loading_phase_hrs and TAT if still active.
-- =============================================================

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
                lt.loading_terminal
            ) AS closure_geofence,

            COALESCE(lt.last_dest_name, lt.destination_name, lt.customer_name) AS last_destination,

            -- ABSOLUTE LAST LIVE GEOFENCE
            (
                SELECT tse.canonical_name 
                FROM trip_state_events tse 
                WHERE tse.trip_key = lt.trip_key 
                  AND tse.canonical_name IS NOT NULL
                  AND tse.canonical_name != ''
                ORDER BY tse.event_time DESC 
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
          ON UPPER(gm_dest.canonical_name) = UPPER(COALESCE(lt.last_dest_name, lt.destination_name, lt.customer_name))
    ),
    classified AS (
        SELECT
            e.*,
            CASE
                WHEN e.status IN ('completed', 'completed_missed_dest')
                     AND e.next_loading_entry IS NULL
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
                THEN 'active_loading_started'

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
                    ar.live_tat_hrs            AS total_tat_hrs,
                    ar.live_transit_hrs        AS transit_hrs,
                    ar.live_loading_phase_hrs  AS loading_phase_hrs,
                    ar.post_loading_delay_hrs,
                    ar.effective_return_hrs    AS return_hrs,
                    ar.closure_geofence,
                    ar.last_destination,
                    ar.last_known_geofence,
                    ar.is_returning,
                    ar.is_midnight_split_state,
                    ar.queue_status            AS active_queue_status,
                    ar.live_dest_dwell_hrs,
                    ar.live_loading_dwell_hrs,
                    ar.dest_stop_count,
                    ar.destinations_array,
                    ar.border_crossings,
                    ar.closure_geofence_canonical,
                    ar.last_destination_canonical
                FROM active_rows ar
             ) r),
            '[]'::json
        )
    ) INTO v_result;

    RETURN v_result;
END $$;
