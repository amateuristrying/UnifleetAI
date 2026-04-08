-- =============================================================
-- TAT V2 REFACTOR: Phase 46
-- Pre-loading split metrics:
--   - dispatch_wait_hrs: operational waiting before loading
--   - origin_reposition_hrs: in-motion / non-dwell reposition before loading
--   - origin_queue_hrs: loading-origin dwell before loading_start
--
-- Goal:
--   Keep waiting_for_orders_hrs for backward compatibility, but expose
--   an industry-style split so origin->origin reposition is accounted
--   as pre-transit instead of dispatch waiting.
-- =============================================================

ALTER TABLE public.tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS dispatch_wait_hrs NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS origin_reposition_hrs NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS origin_queue_hrs NUMERIC(10,2);

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- 1) INSERT column list: add split metrics after waiting_for_orders_hrs.
    v_new := REPLACE(
        v_new,
        '        waiting_for_orders_hrs,
        loading_phase_hrs,',
        '        waiting_for_orders_hrs,
        dispatch_wait_hrs,
        origin_reposition_hrs,
        origin_queue_hrs,
        loading_phase_hrs,'
    );

    -- 2) SELECT projections: inject split metric expressions.
    v_new := REPLACE(
        v_new,
        $old$
        -- waiting_for_orders_hrs (parity 1B: dar_arrival → loading_start)
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0, 2)
        END,

        -- loading_phase_hrs
$old$,
        $new$
        -- waiting_for_orders_hrs (parity 1B: dar_arrival -> loading_start)
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0, 2)
        END,

        -- dispatch_wait_hrs: operational dwell before loading_start
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(
                    COALESCE((
                        SELECT SUM(
                            GREATEST(
                                EXTRACT(EPOCH FROM (
                                    LEAST(COALESCE(n.out_time, n.in_time), a.l_start)
                                    - GREATEST(n.in_time, a.dar_arrival)
                                )),
                                0
                            ) / 3600.0
                        )
                        FROM trip_geofence_events_normalized n
                        WHERE n.tracker_id = a.tracker_id
                          AND n.in_time < a.l_start
                          AND COALESCE(n.out_time, n.in_time) > a.dar_arrival
                          AND n.stop_state = 'operational_stop'
                          AND public.role_family_v2(n.role_code) IN (
                              'ops_yard', 'origin_base', 'origin_gateway', 'origin_region'
                          )
                    ), 0)::NUMERIC,
                    2
                )
        END,

        -- origin_reposition_hrs: non-dwell time between origin points before loading
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(
                    GREATEST(
                        EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0
                        - COALESCE((
                            SELECT SUM(
                                GREATEST(
                                    EXTRACT(EPOCH FROM (
                                        LEAST(COALESCE(n.out_time, n.in_time), a.l_start)
                                        - GREATEST(n.in_time, a.dar_arrival)
                                    )),
                                    0
                                ) / 3600.0
                            )
                            FROM trip_geofence_events_normalized n
                            WHERE n.tracker_id = a.tracker_id
                              AND n.in_time < a.l_start
                              AND COALESCE(n.out_time, n.in_time) > a.dar_arrival
                              AND n.stop_state = 'operational_stop'
                              AND public.role_family_v2(n.role_code) IN (
                                  'ops_yard', 'origin_base', 'origin_gateway', 'origin_region'
                              )
                        ), 0)
                        - COALESCE((
                            SELECT SUM(
                                GREATEST(
                                    EXTRACT(EPOCH FROM (
                                        LEAST(COALESCE(n.out_time, n.in_time), a.l_start)
                                        - GREATEST(n.in_time, a.dar_arrival)
                                    )),
                                    0
                                ) / 3600.0
                            )
                            FROM trip_geofence_events_normalized n
                            WHERE n.tracker_id = a.tracker_id
                              AND n.in_time < a.l_start
                              AND COALESCE(n.out_time, n.in_time) > a.dar_arrival
                              AND n.stop_state = 'origin_loading_stop'
                              AND public.role_family_v2(n.role_code) IN ('origin_terminal', 'origin_zone')
                        ), 0),
                        0
                    )::NUMERIC,
                    2
                )
        END,

        -- origin_queue_hrs: loading-origin dwell before loading_start
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(
                    COALESCE((
                        SELECT SUM(
                            GREATEST(
                                EXTRACT(EPOCH FROM (
                                    LEAST(COALESCE(n.out_time, n.in_time), a.l_start)
                                    - GREATEST(n.in_time, a.dar_arrival)
                                )),
                                0
                            ) / 3600.0
                        )
                        FROM trip_geofence_events_normalized n
                        WHERE n.tracker_id = a.tracker_id
                          AND n.in_time < a.l_start
                          AND COALESCE(n.out_time, n.in_time) > a.dar_arrival
                          AND n.stop_state = 'origin_loading_stop'
                          AND public.role_family_v2(n.role_code) IN ('origin_terminal', 'origin_zone')
                    ), 0)::NUMERIC,
                    2
                )
        END,

        -- loading_phase_hrs
$new$
    );

    -- 3) Upsert update list: maintain split metrics on rebuild.
    v_new := REPLACE(
        v_new,
        '        waiting_for_orders_hrs    = EXCLUDED.waiting_for_orders_hrs,
        loading_phase_hrs         = EXCLUDED.loading_phase_hrs,',
        '        waiting_for_orders_hrs    = EXCLUDED.waiting_for_orders_hrs,
        dispatch_wait_hrs         = EXCLUDED.dispatch_wait_hrs,
        origin_reposition_hrs     = EXCLUDED.origin_reposition_hrs,
        origin_queue_hrs          = EXCLUDED.origin_queue_hrs,
        loading_phase_hrs         = EXCLUDED.loading_phase_hrs,'
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

