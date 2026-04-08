-- =============================================================
-- TAT V2 REFACTOR: Phase 51
-- Use effective dar_arrival (anchor clamped with previous closure)
-- for pre-loading split metrics.
--
-- Problem:
--   Phase 50 corrected output dar_arrival via prior-closure clamp, but
--   waiting_for_orders / dispatch_wait / reposition / queue were still
--   computed from raw a.dar_arrival. If raw anchor is null, metrics stay null.
--
-- Fix:
--   Recompute these four metrics using:
--     eff_dar := CASE
--                  WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
--                    THEN a.l_start
--                  ELSE GREATEST(COALESCE(a.dar_arrival, -inf),
--                                COALESCE(pc.prev_trip_closed, -inf))
--                END
-- =============================================================

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    v_new := REPLACE(
        v_new,
        $old$
        -- waiting_for_orders_hrs (parity 1B: dar_arrival -> loading_start)
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0, 2)
        END,

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
$old$,
        $new$
        -- waiting_for_orders_hrs (effective dar_arrival -> loading_start)
        CASE
            WHEN a.l_start IS NOT NULL
                THEN ROUND(
                    EXTRACT(EPOCH FROM (
                        a.l_start - (
                            CASE
                                WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                    THEN a.l_start
                                ELSE GREATEST(
                                    COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                    COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                )
                            END
                        )
                    ))/3600.0,
                    2
                )
        END,

        -- dispatch_wait_hrs: operational dwell before loading_start
        CASE
            WHEN a.l_start IS NOT NULL
                THEN ROUND(
                    LEAST(
                        public.union_interval_hours_v2(
                            a.tracker_id,
                            (
                                CASE
                                    WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                        THEN a.l_start
                                    ELSE GREATEST(
                                        COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                        COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                    )
                                END
                            ),
                            a.l_start,
                            ARRAY['operational_stop']::TEXT[],
                            ARRAY['ops_yard', 'origin_base', 'origin_gateway', 'origin_region']::TEXT[]
                        ),
                        GREATEST(
                            EXTRACT(EPOCH FROM (
                                a.l_start - (
                                    CASE
                                        WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                            THEN a.l_start
                                        ELSE GREATEST(
                                            COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                            COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                        )
                                    END
                                )
                            ))/3600.0
                            - public.union_interval_hours_v2(
                                a.tracker_id,
                                (
                                    CASE
                                        WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                            THEN a.l_start
                                        ELSE GREATEST(
                                            COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                            COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                        )
                                    END
                                ),
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
            WHEN a.l_start IS NOT NULL
                THEN ROUND(
                    GREATEST(
                        EXTRACT(EPOCH FROM (
                            a.l_start - (
                                CASE
                                    WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                        THEN a.l_start
                                    ELSE GREATEST(
                                        COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                        COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                    )
                                END
                            )
                        ))/3600.0
                        - public.union_interval_hours_v2(
                            a.tracker_id,
                            (
                                CASE
                                    WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                        THEN a.l_start
                                    ELSE GREATEST(
                                        COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                        COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                    )
                                END
                            ),
                            a.l_start,
                            ARRAY['origin_loading_stop']::TEXT[],
                            ARRAY['origin_terminal', 'origin_zone']::TEXT[]
                        )
                        - LEAST(
                            public.union_interval_hours_v2(
                                a.tracker_id,
                                (
                                    CASE
                                        WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                            THEN a.l_start
                                        ELSE GREATEST(
                                            COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                            COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                        )
                                    END
                                ),
                                a.l_start,
                                ARRAY['operational_stop']::TEXT[],
                                ARRAY['ops_yard', 'origin_base', 'origin_gateway', 'origin_region']::TEXT[]
                            ),
                            GREATEST(
                                EXTRACT(EPOCH FROM (
                                    a.l_start - (
                                        CASE
                                            WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                                THEN a.l_start
                                            ELSE GREATEST(
                                                COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                                COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                            )
                                        END
                                    )
                                ))/3600.0
                                - public.union_interval_hours_v2(
                                    a.tracker_id,
                                    (
                                        CASE
                                            WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                                THEN a.l_start
                                            ELSE GREATEST(
                                                COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                                COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                            )
                                        END
                                    ),
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
            WHEN a.l_start IS NOT NULL
                THEN ROUND(
                    public.union_interval_hours_v2(
                        a.tracker_id,
                        (
                            CASE
                                WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL
                                    THEN a.l_start
                                ELSE GREATEST(
                                    COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                                    COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
                                )
                            END
                        ),
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
        RAISE EXCEPTION 'Phase 51 patch did not match build_tat_trip_facts_v2 metric block.';
    END IF;

    -- Keep builder lineage tag current.
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase51_v1'', true);',
        'n'
    );

    EXECUTE v_new;
END;
$$;

