-- =============================================================
-- TAT V2 REFACTOR: Phase 47
-- Fix overlap double-counting in Phase 46 pre-loading split metrics.
--
-- Why:
--   Raw normalized geofence rows can overlap in time across aliases/zones.
--   Simple SUM(dwell overlap) can overcount and make:
--     dispatch_wait_hrs > waiting_for_orders_hrs.
--
-- What:
--   1) Add a reusable interval-union helper:
--      public.union_interval_hours_v2(...)
--   2) Patch build_tat_trip_facts_v2 to use unioned intervals with precedence:
--      queue first, dispatch capped to remaining time, reposition = residual.
-- =============================================================

CREATE OR REPLACE FUNCTION public.union_interval_hours_v2(
    p_tracker_id INTEGER,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_stop_states TEXT[],
    p_role_families TEXT[]
) RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $fn$
WITH intervals AS (
    SELECT
        GREATEST(n.in_time, p_start) AS s,
        LEAST(COALESCE(n.out_time, n.in_time), p_end) AS e
    FROM public.trip_geofence_events_normalized n
    WHERE n.tracker_id = p_tracker_id
      AND n.in_time < p_end
      AND COALESCE(n.out_time, n.in_time) > p_start
      AND (p_stop_states IS NULL OR n.stop_state = ANY(p_stop_states))
      AND (p_role_families IS NULL OR public.role_family_v2(n.role_code) = ANY(p_role_families))
),
valid AS (
    SELECT s, e
    FROM intervals
    WHERE e > s
),
ordered AS (
    SELECT
        s,
        e,
        MAX(e) OVER (
            ORDER BY s, e
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prev_max_e
    FROM valid
),
grp AS (
    SELECT
        s,
        e,
        SUM(
            CASE
                WHEN prev_max_e IS NULL OR s > prev_max_e THEN 1
                ELSE 0
            END
        ) OVER (ORDER BY s, e) AS g
    FROM ordered
),
merged AS (
    SELECT g, MIN(s) AS s, MAX(e) AS e
    FROM grp
    GROUP BY g
)
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (e - s)) / 3600.0), 0)::NUMERIC
FROM merged;
$fn$;

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- Replace phase46 SUM-overlap block with union-based metrics.
    v_new := REPLACE(
        v_new,
        $old$
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
$old$,
        $new$
        -- dispatch_wait_hrs: operational dwell before loading_start
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(
                    LEAST(
                        public.union_interval_hours_v2(
                            a.tracker_id,
                            a.dar_arrival,
                            a.l_start,
                            ARRAY['operational_stop']::TEXT[],
                            ARRAY['ops_yard', 'origin_base', 'origin_gateway', 'origin_region']::TEXT[]
                        ),
                        GREATEST(
                            EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0
                            - public.union_interval_hours_v2(
                                a.tracker_id,
                                a.dar_arrival,
                                a.l_start,
                                ARRAY['origin_loading_stop']::TEXT[],
                                ARRAY['origin_terminal', 'origin_zone']::TEXT[]
                            ),
                            0
                        )
                    )::NUMERIC,
                    2
                )
        END,

        -- origin_reposition_hrs: non-dwell time between origin points before loading
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(
                    GREATEST(
                        EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0
                        - public.union_interval_hours_v2(
                            a.tracker_id,
                            a.dar_arrival,
                            a.l_start,
                            ARRAY['origin_loading_stop']::TEXT[],
                            ARRAY['origin_terminal', 'origin_zone']::TEXT[]
                        )
                        - LEAST(
                            public.union_interval_hours_v2(
                                a.tracker_id,
                                a.dar_arrival,
                                a.l_start,
                                ARRAY['operational_stop']::TEXT[],
                                ARRAY['ops_yard', 'origin_base', 'origin_gateway', 'origin_region']::TEXT[]
                            ),
                            GREATEST(
                                EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0
                                - public.union_interval_hours_v2(
                                    a.tracker_id,
                                    a.dar_arrival,
                                    a.l_start,
                                    ARRAY['origin_loading_stop']::TEXT[],
                                    ARRAY['origin_terminal', 'origin_zone']::TEXT[]
                                ),
                                0
                            )
                        ),
                        0
                    )::NUMERIC,
                    2
                )
        END,

        -- origin_queue_hrs: loading-origin dwell before loading_start
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(
                    public.union_interval_hours_v2(
                        a.tracker_id,
                        a.dar_arrival,
                        a.l_start,
                        ARRAY['origin_loading_stop']::TEXT[],
                        ARRAY['origin_terminal', 'origin_zone']::TEXT[]
                    )::NUMERIC,
                    2
                )
        END,
$new$
    );

    IF v_new = v_def THEN
        RAISE EXCEPTION 'Phase 47 patch did not match build_tat_trip_facts_v2; no changes applied.';
    END IF;

    EXECUTE v_new;
END;
$$;
