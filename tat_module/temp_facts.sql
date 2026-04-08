CREATE OR REPLACE FUNCTION public.build_tat_trip_facts_v2(p_start timestamp with time zone DEFAULT (NOW() - INTERVAL '30 days'), p_end timestamp with time zone DEFAULT (NOW() + INTERVAL '1 day'), p_tracker_id integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_run_id UUID;
BEGIN
    SET LOCAL statement_timeout = 0;

    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_4_FACTS_V2', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    PERFORM set_config('tat.current_build_run_id', v_run_id::text, true);
    PERFORM set_config('tat.current_rule_version', 'phase51_v1', true);

    -- Purge facts for this build window.
    -- We delete by loading_start range AND by trip_key ownership (from loading_start
    -- events in-window) so stale rows with drifted milestones cannot survive rebuilds.
    DELETE FROM tat_trip_facts_v2 f
    WHERE (
            f.loading_start >= p_start
        AND f.loading_start  < p_end
        AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
    )
       OR EXISTS (
            SELECT 1
            FROM trip_state_events e
            WHERE e.trip_key   = f.trip_key
              AND e.event_code = 'loading_start'
              AND e.event_time >= p_start
              AND e.event_time  < p_end
              AND (p_tracker_id IS NULL OR e.tracker_id = p_tracker_id)
       );

    INSERT INTO tat_trip_facts_v2 (
        trip_key, tracker_id, tracker_name,
        loading_terminal, origin_region, destination_name, customer_name,
        trip_type, status, closure_reason, lifecycle_confidence,
        dar_arrival, loading_start, loading_end, origin_exit, next_loading_entry,
        dest_entry, dest_exit,
        customer_entry, customer_exit,
        customs_entry, customs_exit,
        border_entry, border_exit,
        return_border_entry, return_border_exit,
        drc_region_entry, drc_region_exit,
        trip_closed_at,
        completion_time,
        waiting_for_orders_hrs,
        dispatch_wait_hrs,
        origin_reposition_hrs,
        origin_queue_hrs,
        loading_phase_hrs,
        post_loading_delay_hrs,
        transit_hrs,
        border_total_hrs,
        outbound_border_total_hrs,
        return_border_total_hrs,
        outbound_border_count,
        return_border_count,
        customs_hrs,
        destination_dwell_hrs,
        dest_stop_count,
        last_dest_exit,
        last_dest_name,
        customer_dwell_hrs,
        return_hrs,
        total_tat_hrs,
        has_corridor_event,
        has_border_event,
        has_customs_event,
        has_destination_region_only,
        missed_destination,
        missed_destination_flag,
        low_confidence_flag,
        exception_flags
    )
    WITH active_trips AS (
        -- Phase 76: active_trips_gateway_exclusion
        -- RULE: loading_start events with role_code = 'origin_gateway' must NEVER
        -- anchor a trip in the facts builder. origin_gateway geofences (DAR GEOFENCE,
        -- KILUVYA, ASAS KIBAHA YARD) are large perimeter zones used only for
        -- return_origin / dar_arrival detection, not for loading session anchoring.
        -- The state machine (build_trip_state_events_v2) should not emit loading_start
        -- with origin_gateway role after Phase 76, but we guard here as belt-and-suspenders.
        SELECT DISTINCT trip_key, tracker_id
        FROM trip_state_events
        WHERE event_code = 'loading_start'
          AND (LOWER(role_code) LIKE 'origin_terminal%' OR LOWER(role_code) LIKE 'origin_zone%')
          AND LOWER(role_code) NOT LIKE 'origin_gateway%'
          AND event_time >= p_start
          AND event_time  < p_end
          AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
    ),
    -- Canonical loading_start per trip key
    loading_events AS (
        SELECT
            e.trip_key,
            e.tracker_id,
            MIN(e.event_time) AS loading_start_time,
            (
                SELECT MAX(le.event_time)
                FROM trip_state_events le
                WHERE le.trip_key   = e.trip_key
                  AND le.tracker_id = e.tracker_id
                  AND le.event_code = 'loading_end'
            ) AS loading_end_time
        FROM trip_state_events e
        WHERE e.event_code = 'loading_start'
          AND (p_tracker_id IS NULL OR e.tracker_id = p_tracker_id)
        GROUP BY e.trip_key, e.tracker_id
    ),
    -- Trip-local boundaries used to fence event aggregation:
    -- previous loading start .. next loading start.
    trip_bounds AS (
        SELECT
            le.trip_key,
            le.tracker_id,
            le.loading_start_time,
            le.loading_end_time,
            LAG(le.loading_start_time) OVER (
                PARTITION BY le.tracker_id
                ORDER BY le.loading_start_time, le.trip_key
            ) AS prev_loading_start_time,
            (
                SELECT MIN(le2.loading_start_time)
                FROM loading_events le2
                WHERE le2.tracker_id = le.tracker_id
                  AND le2.loading_start_time > COALESCE(
                        le.loading_end_time,
                        le.loading_start_time
                  )
            ) AS next_loading_start_time,
            ROW_NUMBER() OVER (
                PARTITION BY le.tracker_id
                ORDER BY le.loading_start_time, le.trip_key
            ) AS trip_seq
        FROM loading_events le
    ),
    agg AS (
        SELECT
            e.trip_key,
            e.tracker_id,

            -- ── Parity-critical timestamps ──────────────────────────────────
            -- dar_arrival (parity 1B): earliest trip_anchor_start in window.
            -- trip_anchor_start is now restricted to ops_yard/origin_region/
            -- origin_gateway only (fixed in step 3).
            MIN(e.event_time) FILTER (WHERE e.event_code = 'trip_anchor_start')   AS dar_arrival,
            MIN(e.event_time) FILTER (WHERE e.event_code = 'loading_start')       AS l_start,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'loading_end')         AS l_end,
            -- origin_exit (parity 1C): from origin_region/origin_gateway only.
            MIN(e.event_time) FILTER (WHERE e.event_code = 'origin_exit')         AS ox,
            -- destination evidence — Tier 1 (site-level)
            MIN(e.event_time) FILTER (WHERE e.event_code = 'destination_entry')   AS d_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'destination_exit')    AS d_exit,
            -- destination evidence — Tier 2 (region-level)
            MIN(e.event_time) FILTER (WHERE e.event_code = 'destination_region_entry') AS dr_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'destination_region_exit')  AS dr_exit,
            -- customer
            MIN(e.event_time) FILTER (WHERE e.event_code = 'customer_entry')      AS c_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'customer_exit')       AS c_exit,
            -- customs
            MIN(e.event_time) FILTER (WHERE e.event_code = 'customs_entry')       AS cus_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'customs_exit')        AS cus_exit,
            -- border summary timestamps (first entry / last exit across all borders)
            -- kept for backward compat; per-border detail lives in child table
            MIN(e.event_time) FILTER (WHERE e.event_code = 'border_entry')        AS b_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'border_exit')         AS b_exit,
            MIN(e.event_time) FILTER (WHERE e.event_code = 'return_border_entry') AS rb_entry,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'return_border_exit')  AS rb_exit,
            MAX(e.event_time) FILTER (WHERE e.event_code = 'trip_closed')         AS t_closed,

            -- ── Metadata ─────────────────────────────────────────────────────
            -- PARITY 1A: terminal_name from canonical_name of loading_start
            -- event (which holds the winning-role canonical name after step 3).
            MAX(e.canonical_name)
                FILTER (WHERE e.event_code = 'loading_start'
                           AND e.role_code  = 'origin_terminal')    AS terminal_name_prim,
            MAX(e.canonical_name)
                FILTER (WHERE e.event_code = 'loading_start')        AS terminal_name_any,
            MAX(e.canonical_name)
                FILTER (WHERE e.event_code = 'trip_anchor_start'
                           AND UPPER(COALESCE(e.canonical_name, '')) <> 'ASAS IRINGA YARD') AS origin_region_name,
            MAX(e.canonical_name)
                FILTER (WHERE e.event_code = 'destination_entry')    AS dest_name,
            MAX(e.canonical_name)
                FILTER (WHERE e.event_code = 'customer_entry')       AS cust_name,
            MAX(e.event_meta->>'reason')
                FILTER (WHERE e.event_code = 'trip_closed')          AS closure_rsn,

            -- ── Lifecycle confidence (weighted) ──────────────────────────────
            (
                SUM(e.event_confidence * CASE
                    WHEN e.event_code IN ('loading_start','loading_end') THEN 2.0
                    WHEN e.event_code = 'trip_closed'                   THEN 3.0
                    ELSE 1.0
                END)
                /
                NULLIF(SUM(CASE
                    WHEN e.event_code IN ('loading_start','loading_end') THEN 2.0
                    WHEN e.event_code = 'trip_closed'                   THEN 3.0
                    ELSE 1.0
                END), 0)
            )                                                        AS lifecycle_conf,

            -- ── Feature flags ─────────────────────────────────────────────────
            BOOL_OR(e.event_code IN (
                'border_entry','border_exit',
                'return_border_entry','return_border_exit',
                'customs_entry','customs_exit',
                'corridor_entry'
            ))                                                       AS has_corridor,
            BOOL_OR(e.event_code IN (
                'border_entry','border_exit','return_border_entry','return_border_exit'
            ))                                                       AS has_border,
            BOOL_OR(e.event_code IN ('customs_entry','customs_exit')) AS has_customs,
            -- Tier 2 destination exists
            BOOL_OR(e.event_code = 'destination_region_entry')       AS has_dest_region

        FROM trip_state_events e
        JOIN active_trips at
          ON at.trip_key = e.trip_key
         AND at.tracker_id = e.tracker_id
        JOIN trip_bounds tb
          ON tb.trip_key = e.trip_key
         AND tb.tracker_id = e.tracker_id
        WHERE (
                e.event_time < COALESCE(tb.next_loading_start_time, 'infinity'::TIMESTAMPTZ)
             OR (
                    e.event_code = 'trip_closed'
                AND e.event_time <= COALESCE(tb.next_loading_start_time, 'infinity'::TIMESTAMPTZ)
             )
        )
          AND (
                e.event_code = 'trip_anchor_start'
                OR e.event_time >= tb.loading_start_time
          )
          AND (
                e.event_code <> 'trip_anchor_start'
                OR (
                    e.event_time <= tb.loading_start_time
                    AND e.event_time >= COALESCE(tb.prev_loading_start_time, '-infinity'::TIMESTAMPTZ)
                )
          )
        GROUP BY e.trip_key, e.tracker_id
    ),
    -- ── next_loading_entry ────────────────────────────────────────────────────
    next_trips AS (
        SELECT
            trip_key,
            next_loading_start_time AS next_loading_entry
        FROM trip_bounds
    ),
    -- ── next_dar_arrival: when truck arrived back at origin before next trip ──
    -- = trip_anchor_start of the NEXT trip (ops_yard / origin_region arrival).
    -- Used to end return_hrs at origin arrival, not next loading_start.
    trip_anchor_events AS (
        SELECT
            e.trip_key,
            e.tracker_id,
            MIN(e.event_time) AS trip_anchor_time
        FROM trip_state_events e
        WHERE e.event_code = 'trip_anchor_start'
          AND (p_tracker_id IS NULL OR e.tracker_id = p_tracker_id)
        GROUP BY e.trip_key, e.tracker_id
    ),
    next_anchor AS (
        SELECT
            tb.trip_key,
            (
                SELECT tae.trip_anchor_time
                FROM trip_bounds tb_next
                JOIN trip_anchor_events tae
                  ON tae.trip_key = tb_next.trip_key
                 AND tae.tracker_id = tb_next.tracker_id
                WHERE tb_next.tracker_id = tb.tracker_id
                  AND tb_next.loading_start_time = tb.next_loading_start_time
                ORDER BY tb_next.trip_key
                LIMIT 1
            ) AS next_dar_arrival
        FROM trip_bounds tb
    ),
    -- ── ASAS return fallback ────────────────────────────────────────────────
    -- If exact closure is missing, use first ASAS ops/yard origin signal
    -- after return started and before next loading.
    asas_return AS (
        SELECT
            a.trip_key,
            (
                SELECT MIN(n.in_time)
                FROM trip_geofence_events_normalized n
                WHERE n.tracker_id = a.tracker_id
                  AND n.in_time > COALESCE(
                        a.d_exit, a.c_exit, a.d_entry, a.c_entry,
                        a.cus_exit, a.cus_entry,
                        a.rb_exit, a.b_exit,
                        a.ox, a.l_end, a.l_start
                  )
                  AND n.in_time < COALESCE(nt.next_loading_entry, 'infinity'::TIMESTAMPTZ)
                  AND n.role_code IN ('ops_yard','origin_base', 'origin_zone','origin_gateway')
                  AND n.canonical_name ILIKE '%ASAS%'
                  AND n.canonical_name NOT ILIKE '%IRINGA%'
                  AND n.canonical_name NOT ILIKE '%KIBAHA%'
            ) AS asas_return_entry
        FROM agg a
        LEFT JOIN next_trips nt
          ON nt.trip_key = a.trip_key
    ),
    -- Unified closure fallback used by status + duration metrics.
    -- Priority: exact trip_closed -> next_dar_arrival -> ASAS return -> next_loading.
    closure_fallback AS (
        SELECT
            a.trip_key,
            CASE
                WHEN na.next_dar_arrival > COALESCE(a.d_exit, a.c_exit, a.l_start)
                    THEN na.next_dar_arrival
            END AS next_dar_after_trip,
            ar.asas_return_entry,
            COALESCE(
                a.t_closed,
                CASE
                    WHEN na.next_dar_arrival > COALESCE(a.d_exit, a.c_exit, a.l_start)
                        THEN na.next_dar_arrival
                END,
                ar.asas_return_entry,
                nt.next_loading_entry
            ) AS closure_proxy_time
        FROM agg a
        LEFT JOIN next_trips nt
          ON nt.trip_key = a.trip_key
        LEFT JOIN next_anchor na
          ON na.trip_key = a.trip_key
        LEFT JOIN asas_return ar
          ON ar.trip_key = a.trip_key
    ),
    -- ── tracker_name ─────────────────────────────────────────────────────────
    tracker_names AS (
        SELECT DISTINCT ON (tracker_id)
            tracker_id, tracker_name
        FROM public.geofence_visits
        ORDER BY tracker_id, in_time_dt DESC
    ),
    -- ── Border summaries from child table ────────────────────────────────────
    -- Pull per-direction sums and counts for trips in this window.
    -- This is the authoritative source for border_total_hrs in v2.
    border_summary AS (
        SELECT
            trip_key,
            ROUND(SUM(dwell_hrs) FILTER (WHERE leg_direction = 'outbound'), 2)
                AS outbound_border_total_hrs,
            ROUND(SUM(dwell_hrs) FILTER (WHERE leg_direction = 'return'), 2)
                AS return_border_total_hrs,
            COUNT(*) FILTER (WHERE leg_direction = 'outbound')
                AS outbound_border_count,
            COUNT(*) FILTER (WHERE leg_direction = 'return')
                AS return_border_count
        FROM tat_trip_border_facts_v2
        WHERE trip_key IN (SELECT trip_key FROM active_trips)
        GROUP BY trip_key
    )
    SELECT
        a.trip_key,
        a.tracker_id,
        tn.tracker_name,

        -- Origin (parity 1A: highest-priority role canonical_name)
        COALESCE(a.terminal_name_prim, a.terminal_name_any),
        COALESCE(
            a.origin_region_name,
            (
                SELECT n.canonical_name
                FROM trip_geofence_events_normalized n
                WHERE n.tracker_id = a.tracker_id
                  AND n.in_time <= COALESCE(a.l_end, a.l_start)
                  AND COALESCE(n.out_time, n.in_time) >= a.l_start
                  AND LOWER(COALESCE(n.role_code, '')) LIKE 'origin_zone%'
                ORDER BY COALESCE(n.out_time, n.in_time) DESC, n.in_time DESC
                LIMIT 1
            ),
            (
                SELECT n.canonical_name
                FROM trip_geofence_events_normalized n
                WHERE n.tracker_id = a.tracker_id
                  AND n.in_time <= COALESCE(a.l_end, a.l_start)
                  AND COALESCE(n.out_time, n.in_time) >= a.l_start
                  AND LOWER(COALESCE(n.role_code, '')) LIKE 'origin_gateway%'
                ORDER BY COALESCE(n.out_time, n.in_time) DESC, n.in_time DESC
                LIMIT 1
            )
        ),

        -- Destination / customer
        a.dest_name,
        a.cust_name,

        -- Trip type (mirror v1 exactly)
        CASE
            WHEN a.dest_name ILIKE '%LPG%' THEN 'lpg_delivery'
            WHEN a.has_corridor            THEN 'long_haul'
            ELSE                                'local_ops'
        END,

        -- Status (parity: priority order mirrors v1 exactly)
        CASE
            WHEN a.dest_name IS NOT NULL
                 AND cf.closure_proxy_time IS NOT NULL
                THEN 'completed'
            WHEN cf.closure_proxy_time IS NOT NULL
                 AND a.dest_name IS NULL
                THEN 'completed_missed_dest'
            WHEN a.d_exit IS NOT NULL
                 AND cf.closure_proxy_time IS NULL
                THEN 'returning'
            WHEN a.d_entry IS NOT NULL AND a.d_exit IS NULL
                THEN 'at_destination'
            WHEN a.ox IS NOT NULL OR a.b_entry IS NOT NULL
                THEN 'in_transit'
            WHEN a.l_end IS NOT NULL
                THEN 'pre_transit'
            ELSE 'loading'
        END,

        -- Closure reason from trip_closed event_meta
        a.closure_rsn,
        ROUND(a.lifecycle_conf::NUMERIC, 2),

        -- ── Parity-critical timestamps ────────────────────────────────────────
        -- dar_arrival (parity 1B): fallback to l_start if no anchor event
        CASE
            WHEN a.dar_arrival IS NULL AND pc.prev_trip_closed IS NULL THEN a.l_start
            ELSE GREATEST(
                COALESCE(a.dar_arrival, '-infinity'::TIMESTAMPTZ),
                COALESCE(pc.prev_trip_closed, '-infinity'::TIMESTAMPTZ)
            )
        END,
        a.l_start,
        a.l_end,
        -- origin_exit = dar_exit (parity 1C)
        a.ox,
        nt.next_loading_entry,
        a.d_entry,
        a.d_exit,
        a.c_entry,
        a.c_exit,
        a.cus_entry,
        a.cus_exit,
        -- backward compat: first outbound border entry / last exit
        a.b_entry,
        a.b_exit,
        a.rb_entry,
        a.rb_exit,

        -- DRC region from normalized events
        (
            SELECT MIN(n.in_time)
            FROM trip_geofence_events_normalized n
            WHERE n.tracker_id  = a.tracker_id
              AND n.in_time     > a.l_start
              AND n.in_time     < COALESCE(nt.next_loading_entry, 'infinity'::TIMESTAMPTZ)
              AND n.role_code   = 'destination_region'
              AND n.canonical_name = 'DRC REGION'
        ),
        (
            SELECT MAX(n.out_time)
            FROM trip_geofence_events_normalized n
            WHERE n.tracker_id  = a.tracker_id
              AND n.in_time     > a.l_start
              AND n.in_time     < COALESCE(nt.next_loading_entry, 'infinity'::TIMESTAMPTZ)
              AND n.role_code   = 'destination_region'
              AND n.canonical_name = 'DRC REGION'
        ),

        a.t_closed,

        -- completion_time: first conclusive destination signal
        CASE
            WHEN a.d_exit  IS NOT NULL THEN a.d_exit
            WHEN a.c_exit  IS NOT NULL THEN a.c_exit
            WHEN a.d_entry IS NOT NULL THEN a.d_entry
            WHEN a.c_entry IS NOT NULL THEN a.c_entry
            ELSE NULL
        END,

        -- ── Duration metrics ─────────────────────────────────────────────────
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

        -- loading_phase_hrs
        CASE
            WHEN a.l_end IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.l_end - a.l_start))/3600.0, 2)
        END,

        -- post_loading_delay_hrs (parity 1C: loading_end → origin_exit)
        CASE
            WHEN a.ox IS NOT NULL AND a.l_end IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.ox - a.l_end))/3600.0, 2)
        END,

        -- transit_hrs: origin_exit (or loading_end fallback) → dest_entry
        CASE
            WHEN a.d_entry IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (
                    a.d_entry - COALESCE(a.ox, a.l_end)
                ))/3600.0, 2)
        END,

        -- border_total_hrs: sum of outbound + return dwell from child table
        ROUND(
            COALESCE(bs.outbound_border_total_hrs, 0) +
            COALESCE(bs.return_border_total_hrs, 0),
            2
        ),
        COALESCE(bs.outbound_border_total_hrs, 0),
        COALESCE(bs.return_border_total_hrs, 0),
        COALESCE(bs.outbound_border_count, 0),
        COALESCE(bs.return_border_count, 0),

        -- customs_hrs
        CASE
            WHEN a.cus_entry IS NOT NULL AND a.cus_exit IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.cus_exit - a.cus_entry))/3600.0, 2)
        END,

        -- destination_dwell_hrs
        CASE
            WHEN a.d_entry IS NOT NULL AND a.d_exit IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.d_exit - a.d_entry))/3600.0, 2)
        END,

        -- dest_stop_count (populated by post-correction)
        0,
        -- last_dest_exit (populated by post-correction)
        a.d_exit,
        -- last_dest_name (populated by post-correction)
        a.dest_name,

        -- customer_dwell_hrs
        CASE
            WHEN a.c_entry IS NOT NULL AND a.c_exit IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.c_exit - a.c_entry))/3600.0, 2)
        END,

        -- return_hrs: dest/customer exit → closure signal.
        -- Fallback priority: exact trip_closed -> next_dar_arrival -> ASAS return -> next_loading.
        CASE
            WHEN COALESCE(a.d_exit, a.c_exit) IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (
                    COALESCE(cf.closure_proxy_time, NOW())
                    - COALESCE(a.d_exit, a.c_exit)
                ))/3600.0, 2)
        END,

        -- total_tat_hrs: dar_arrival/loading_start → closure signal.
        -- Start at dar_arrival when available, otherwise loading_start.
        ROUND(EXTRACT(EPOCH FROM (
            COALESCE(cf.closure_proxy_time, NOW())
            - COALESCE(a.dar_arrival, a.l_start)
        ))/3600.0, 2),

        -- Feature flags
        a.has_corridor, -- has_corridor_event (parity with v1 corridor semantics)
        a.has_border,   -- has_border_event
        a.has_customs,

        -- Parity 1D: has only Tier 2 destination evidence
        (a.has_dest_region AND a.d_entry IS NULL AND a.c_entry IS NULL),

        -- missed_destination
        (
            cf.closure_proxy_time IS NOT NULL
            AND a.dest_name IS NULL
            AND a.cust_name IS NULL
        ),
        -- missed_destination_flag alias
        (
            cf.closure_proxy_time IS NOT NULL
            AND a.dest_name IS NULL
            AND a.cust_name IS NULL
        ),
        -- low_confidence_flag
        (ROUND(a.lifecycle_conf::NUMERIC, 2) < 0.50),

        -- exception_flags JSONB (summary bag)
        jsonb_strip_nulls(jsonb_build_object(
            'low_confidence',
                CASE WHEN ROUND(a.lifecycle_conf::NUMERIC, 2) < 0.50 THEN TRUE END,
            'missed_destination',
                CASE WHEN a.dest_name IS NULL AND a.cust_name IS NULL
                          AND cf.closure_proxy_time IS NOT NULL
                     THEN TRUE END,
            'has_destination_region_only',
                CASE WHEN a.has_dest_region AND a.d_entry IS NULL AND a.c_entry IS NULL
                     THEN TRUE END
        ))

    FROM agg a
    LEFT JOIN next_trips    nt ON nt.trip_key    = a.trip_key
    LEFT JOIN next_anchor   na ON na.trip_key    = a.trip_key
    LEFT JOIN closure_fallback cf ON cf.trip_key = a.trip_key
    LEFT JOIN LATERAL (
        SELECT MAX(e.event_time) AS prev_trip_closed
        FROM trip_state_events e
        WHERE e.tracker_id = a.tracker_id
          AND e.event_code = 'trip_closed'
          AND e.event_time < COALESCE(a.l_start, 'infinity'::TIMESTAMPTZ)
    ) pc ON true
    LEFT JOIN tracker_names tn ON tn.tracker_id  = a.tracker_id
    LEFT JOIN border_summary bs ON bs.trip_key   = a.trip_key

    -- Shunt filter (v1 parity): only real trips. 
    -- Relaxed to include trips with at least a loading_start to support live loading dash.
    WHERE (a.ox IS NOT NULL OR a.dest_name IS NOT NULL OR a.has_corridor OR a.l_start IS NOT NULL)

    ON CONFLICT (trip_key) DO UPDATE SET
        tracker_name              = EXCLUDED.tracker_name,
        loading_terminal          = EXCLUDED.loading_terminal,
        origin_region             = EXCLUDED.origin_region,
        destination_name          = EXCLUDED.destination_name,
        customer_name             = EXCLUDED.customer_name,
        trip_type                 = EXCLUDED.trip_type,
        status                    = EXCLUDED.status,
        closure_reason            = EXCLUDED.closure_reason,
        lifecycle_confidence      = EXCLUDED.lifecycle_confidence,
        dar_arrival               = EXCLUDED.dar_arrival,
        loading_start             = EXCLUDED.loading_start,
        loading_end               = EXCLUDED.loading_end,
        origin_exit               = EXCLUDED.origin_exit,
        next_loading_entry        = EXCLUDED.next_loading_entry,
        dest_entry                = EXCLUDED.dest_entry,
        dest_exit                 = EXCLUDED.dest_exit,
        customer_entry            = EXCLUDED.customer_entry,
        customer_exit             = EXCLUDED.customer_exit,
        customs_entry             = EXCLUDED.customs_entry,
        customs_exit              = EXCLUDED.customs_exit,
        border_entry              = EXCLUDED.border_entry,
        border_exit               = EXCLUDED.border_exit,
        return_border_entry       = EXCLUDED.return_border_entry,
        return_border_exit        = EXCLUDED.return_border_exit,
        drc_region_entry          = EXCLUDED.drc_region_entry,
        drc_region_exit           = EXCLUDED.drc_region_exit,
        trip_closed_at            = EXCLUDED.trip_closed_at,
        completion_time           = EXCLUDED.completion_time,
        waiting_for_orders_hrs    = EXCLUDED.waiting_for_orders_hrs,
        dispatch_wait_hrs         = EXCLUDED.dispatch_wait_hrs,
        origin_reposition_hrs     = EXCLUDED.origin_reposition_hrs,
        origin_queue_hrs          = EXCLUDED.origin_queue_hrs,
        loading_phase_hrs         = EXCLUDED.loading_phase_hrs,
        post_loading_delay_hrs    = EXCLUDED.post_loading_delay_hrs,
        transit_hrs               = EXCLUDED.transit_hrs,
        border_total_hrs          = EXCLUDED.border_total_hrs,
        outbound_border_total_hrs = EXCLUDED.outbound_border_total_hrs,
        return_border_total_hrs   = EXCLUDED.return_border_total_hrs,
        outbound_border_count     = EXCLUDED.outbound_border_count,
        return_border_count       = EXCLUDED.return_border_count,
        customs_hrs               = EXCLUDED.customs_hrs,
        destination_dwell_hrs     = EXCLUDED.destination_dwell_hrs,
        dest_stop_count           = EXCLUDED.dest_stop_count,
        last_dest_exit            = EXCLUDED.last_dest_exit,
        last_dest_name            = EXCLUDED.last_dest_name,
        customer_dwell_hrs        = EXCLUDED.customer_dwell_hrs,
        return_hrs                = EXCLUDED.return_hrs,
        total_tat_hrs             = EXCLUDED.total_tat_hrs,
        has_corridor_event        = EXCLUDED.has_corridor_event,
        has_border_event          = EXCLUDED.has_border_event,
        has_customs_event         = EXCLUDED.has_customs_event,
        has_destination_region_only = EXCLUDED.has_destination_region_only,
        missed_destination        = EXCLUDED.missed_destination,
        missed_destination_flag   = EXCLUDED.missed_destination_flag,
        low_confidence_flag       = EXCLUDED.low_confidence_flag,
        exception_flags           = EXCLUDED.exception_flags,
        updated_at                = NOW();

    -- ── QA: log low-confidence trips ─────────────────────────────────────────
    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, trip_key, issue_type, severity, description, context
    )
    SELECT
        v_run_id, tracker_id, trip_key,
        'low_trip_confidence', 'high',
        'Trip lifecycle_confidence below 0.50 — inferences unreliable',
        jsonb_build_object(
            'lifecycle_confidence', lifecycle_confidence,
            'status', status
        )
    FROM tat_trip_facts_v2
    WHERE lifecycle_confidence < 0.50
      AND loading_start >= p_start AND loading_start < p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND NOT EXISTS (
          SELECT 1
          FROM tat_data_quality_issues dq
          WHERE dq.run_id      = v_run_id
            AND dq.issue_type  = 'low_trip_confidence'
            AND dq.tracker_id  = tat_trip_facts_v2.tracker_id
            AND dq.trip_key    = tat_trip_facts_v2.trip_key
            AND dq.description = 'Trip lifecycle_confidence below 0.50 — inferences unreliable'
      )
    ON CONFLICT DO NOTHING;

    -- ── QA: log closure before any destination ───────────────────────────────
    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, trip_key, issue_type, severity, description, context
    )
    SELECT
        v_run_id, tracker_id, trip_key,
        'closure_before_destination', 'medium',
        'Trip was closed_by_return_origin but has no destination evidence',
        jsonb_build_object('closure_reason', closure_reason, 'status', status)
    FROM tat_trip_facts_v2
    WHERE closure_reason = 'closed_by_return_origin'
      AND destination_name IS NULL
      AND customer_name IS NULL
      AND loading_start >= p_start AND loading_start < p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND NOT EXISTS (
          SELECT 1
          FROM tat_data_quality_issues dq
          WHERE dq.run_id      = v_run_id
            AND dq.issue_type  = 'closure_before_destination'
            AND dq.tracker_id  = tat_trip_facts_v2.tracker_id
            AND dq.trip_key    = tat_trip_facts_v2.trip_key
            AND dq.description = 'Trip was closed_by_return_origin but has no destination evidence'
      )
    ON CONFLICT DO NOTHING;

        -- ══ Phase 66b: correct dest columns from dest facts ══════════
    -- Now that facts are INSERTed, fix destination_name, dest_exit,
    -- destination_dwell_hrs, and dest_stop_count using the authoritative
    -- tat_trip_destination_facts_v2 table.
    PERFORM public.correct_facts_destination_columns_v2(p_start, p_end, p_tracker_id);

    UPDATE tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'facts_written',      (SELECT count(*) FROM tat_trip_facts_v2
                                    WHERE loading_start >= p_start AND loading_start < p_end
                                      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)),
            'completed',          (SELECT count(*) FROM tat_trip_facts_v2
                                    WHERE status = 'completed'
                                      AND loading_start >= p_start AND loading_start < p_end),
            'completed_missed',   (SELECT count(*) FROM tat_trip_facts_v2
                                    WHERE missed_destination = true
                                      AND loading_start >= p_start AND loading_start < p_end),
            'low_confidence',     (SELECT count(*) FROM tat_trip_facts_v2
                                    WHERE lifecycle_confidence < 0.50
                                      AND loading_start >= p_start AND loading_start < p_end),
            'with_border',        (SELECT count(*) FROM tat_trip_facts_v2
                                    WHERE has_border_event = true
                                      AND loading_start >= p_start AND loading_start < p_end)
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    UPDATE tat_refactor_runs
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $function$
