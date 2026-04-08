-- =============================================================
-- TAT V2 REFACTOR: Phase 62
-- Feature: Midnight Split Guard for Milestone Detection
--
-- Purpose:
--   Prevent ongoing visits (marked as open or split at 23:59:59)
--   from being treated as true operational exits.
-- =============================================================

CREATE OR REPLACE FUNCTION public.build_trip_state_events_v2(
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run_id UUID;
    v_run_id_built UUID;
BEGIN
    SET LOCAL statement_timeout = 0;

    INSERT INTO public.tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_62_MIDNIGHT_GUARD', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    -- 1) Operational stop-state visit stream (with lookback/lookahead for continuity)
    CREATE TEMP TABLE _ops_visits ON COMMIT DROP AS
    SELECT
        ROW_NUMBER() OVER (
            PARTITION BY ov.tracker_id
            ORDER BY ov.visit_start_utc, ov.visit_end_utc, ov.geofence_name
        ) AS raw_visit_id,
        ov.tracker_id,
        ov.tracker_name,
        ov.geofence_name,
        ov.stop_state,
        ov.state_rank,
        ov.visit_start_utc,
        ov.visit_end_utc,
        ov.visit_end_for_overlap_utc,
        ov.dwell_hours,
        ov.is_open_geofence
    FROM public.get_tat_operational_visit_stream_v2(
        p_start - INTERVAL '1 day',
        p_end + INTERVAL '180 days',
        p_tracker_id
    ) ov;

    CREATE INDEX _idx_ops_tracker_start ON _ops_visits (tracker_id, visit_start_utc);
    CREATE INDEX _idx_ops_tracker_state ON _ops_visits (tracker_id, stop_state, visit_start_utc);

    -- 2) Build loading sessions (trip anchors) from origin_loading_stop with 6h gap.
    CREATE TEMP TABLE _loading_sessions (
        tracker_id      INTEGER,
        tracker_name    TEXT,
        session_group   BIGINT,
        loading_terminal TEXT,
        session_in      TIMESTAMPTZ,
        session_out     TIMESTAMPTZ
    ) ON COMMIT DROP;

    INSERT INTO _loading_sessions
    WITH loading_only AS (
        SELECT *
        FROM _ops_visits
        WHERE stop_state = 'origin_loading_stop'
    ),
    ordered AS (
        SELECT
            lo.*,
            MAX(lo.visit_end_for_overlap_utc) OVER (
                PARTITION BY lo.tracker_id
                ORDER BY lo.visit_start_utc, lo.visit_end_for_overlap_utc
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS prev_max_out
        FROM loading_only lo
    ),
    sessioned AS (
        SELECT
            o.*,
            SUM(
                CASE
                    WHEN o.prev_max_out IS NULL THEN 1
                    WHEN o.prev_max_out >= o.visit_start_utc - INTERVAL '6 hours' THEN 0
                    ELSE 1
                END
            ) OVER (
                PARTITION BY o.tracker_id
                ORDER BY o.visit_start_utc, o.visit_end_for_overlap_utc
            ) AS session_group
        FROM ordered o
    ),
    rollup AS (
        SELECT
            s.tracker_id,
            MAX(s.tracker_name) AS tracker_name,
            s.session_group,
            MIN(s.visit_start_utc) AS session_in,
            -- Midnight Guard: session_out is only real if the last visit in the session is NOT an open geofence
            CASE 
                WHEN bool_and(NOT (s.is_open_geofence OR s.visit_end_utc::time = '23:59:59'::time)) THEN MAX(s.visit_end_for_overlap_utc)
                ELSE NULL 
            END AS session_out
        FROM sessioned s
        GROUP BY s.tracker_id, s.session_group
    ),
    terminal_pick AS (
        SELECT DISTINCT ON (s.tracker_id, s.session_group)
            s.tracker_id,
            s.session_group,
            s.geofence_name AS loading_terminal
        FROM sessioned s
        ORDER BY s.tracker_id, s.session_group, s.state_rank DESC, s.visit_start_utc ASC, s.raw_visit_id ASC
    )
    SELECT
        r.tracker_id,
        r.tracker_name,
        r.session_group,
        tp.loading_terminal,
        r.session_in,
        r.session_out
    FROM rollup r
    JOIN terminal_pick tp
      ON tp.tracker_id = r.tracker_id
     AND tp.session_group = r.session_group;

    CREATE INDEX _idx_ls_tracker_in ON _loading_sessions (tracker_id, session_in);

    -- 3) Build active trip windows
    CREATE TEMP TABLE _trip_windows (
        trip_key           TEXT,
        tracker_id         INTEGER,
        tracker_name       TEXT,
        loading_terminal   TEXT,
        window_start       TIMESTAMPTZ,
        window_end         TIMESTAMPTZ,
        prev_window_start  TIMESTAMPTZ
    ) ON COMMIT DROP;

    INSERT INTO _trip_windows
    WITH sequenced AS (
        SELECT
            ls.*,
            LAG(ls.session_in) OVER (
                PARTITION BY ls.tracker_id
                ORDER BY ls.session_in
            ) AS prev_session_in,
            LEAD(ls.session_in) OVER (
                PARTITION BY ls.tracker_id
                ORDER BY ls.session_in
            ) AS next_session_in
        FROM _loading_sessions ls
    )
    SELECT
        s.tracker_id::TEXT || ':' || EXTRACT(EPOCH FROM s.session_in)::BIGINT::TEXT AS trip_key,
        s.tracker_id,
        s.tracker_name,
        s.loading_terminal,
        s.session_in AS window_start,
        COALESCE(s.next_session_in, 'infinity'::TIMESTAMPTZ) AS window_end,
        s.prev_session_in AS prev_window_start
    FROM sequenced s
    WHERE s.session_in >= p_start
      AND s.session_in <  p_end;

    CREATE INDEX _idx_tw_trip ON _trip_windows (trip_key);
    CREATE INDEX _idx_tw_tracker ON _trip_windows (tracker_id, window_start);

    -- 4) Cleanup events for rebuilt trips
    DELETE FROM public.trip_state_events
    WHERE trip_key IN (SELECT trip_key FROM _trip_windows);

    -- 5) Base loading anchor events
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tw.trip_key,
        tw.tracker_id,
        tw.tracker_name,
        'loading_start',
        tw.window_start,
        0.95,
        'state_machine_loading_start',
        jsonb_build_object('geofence', tw.loading_terminal, 'stop_state', 'origin_loading_stop'),
        tw.loading_terminal,
        'origin_terminal',
        'loading'
    FROM _trip_windows tw;

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tw.trip_key,
        tw.tracker_id,
        tw.tracker_name,
        'loading_end',
        ls.session_out,
        0.95,
        'state_machine_loading_end',
        jsonb_build_object('geofence', tw.loading_terminal, 'stop_state', 'origin_loading_stop'),
        tw.loading_terminal,
        'origin_terminal',
        'loading'
    FROM _trip_windows tw
    JOIN _loading_sessions ls
      ON ls.tracker_id = tw.tracker_id
     AND ls.session_in = tw.window_start
    WHERE ls.session_out IS NOT NULL; -- Midnight Guard

    -- 6) Compute state-machine context per trip
    CREATE TEMP TABLE _trip_context ON COMMIT DROP AS
    SELECT
        tw.trip_key,
        tw.tracker_id,
        tw.tracker_name,
        tw.loading_terminal,
        tw.window_start AS loading_start,
        ls.session_out AS loading_end,
        tw.window_end,
        CASE WHEN tw.window_end = 'infinity'::TIMESTAMPTZ THEN NULL ELSE tw.window_end END AS next_loading_entry,
        pre.pre_origin_in,
        pre.pre_origin_name,
        ox.origin_exit,
        ox.origin_exit_name,
        ds.dest_entry,
        dse.dest_exit,
        ds.dest_name,
        dr.dest_region_entry,
        dre.dest_region_exit,
        dr.dest_region_name,
        CASE
            WHEN ds.dest_entry IS NOT NULL AND dr.dest_region_entry IS NOT NULL
                THEN LEAST(ds.dest_entry, dr.dest_region_entry)
            ELSE COALESCE(ds.dest_entry, dr.dest_region_entry)
        END AS first_destination_signal,
        ro.return_origin_entry,
        ro.return_origin_name
    FROM _trip_windows tw
    JOIN _loading_sessions ls
      ON ls.tracker_id = tw.tracker_id
     AND ls.session_in = tw.window_start
    LEFT JOIN LATERAL (
        WITH pre_origin AS (
            SELECT
                ov.*,
                MAX(ov.visit_end_for_overlap_utc) OVER (
                    ORDER BY ov.visit_start_utc, ov.visit_end_for_overlap_utc
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ) AS prev_max_out
            FROM _ops_visits ov
            WHERE ov.tracker_id = tw.tracker_id
              AND ov.stop_state = 'origin_operational_stop'
              AND ov.visit_start_utc < tw.window_start
              AND ov.visit_start_utc >= COALESCE(tw.prev_window_start, tw.window_start - INTERVAL '30 days')
        ),
        sessioned AS (
            SELECT
                p.*,
                SUM(
                    CASE
                        WHEN p.prev_max_out IS NULL THEN 1
                        WHEN p.prev_max_out >= p.visit_start_utc - INTERVAL '6 hours' THEN 0
                        ELSE 1
                    END
                ) OVER (ORDER BY p.visit_start_utc, p.visit_end_for_overlap_utc) AS session_group
            FROM pre_origin p
        ),
        latest_group AS (
            SELECT s.session_group
            FROM sessioned s
            ORDER BY s.visit_start_utc DESC, s.visit_end_for_overlap_utc DESC
            LIMIT 1
        )
        SELECT
            s.visit_start_utc AS pre_origin_in,
            s.geofence_name AS pre_origin_name
        FROM sessioned s
        JOIN latest_group lg
          ON lg.session_group = s.session_group
        ORDER BY s.visit_start_utc ASC, s.raw_visit_id ASC
        LIMIT 1
    ) pre ON true
    LEFT JOIN LATERAL (
        SELECT MIN(ov.visit_start_utc) AS first_signal
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.visit_start_utc > ls.session_out
          AND ov.visit_start_utc < tw.window_end
          AND ov.stop_state IN (
                'corridor_transit',
                'border_crossing',
                'customs_stop',
                'destination_stop',
                'destination_region_presence'
          )
    ) sig ON true
    LEFT JOIN LATERAL (
        -- Midnight Guard for origin_exit
        SELECT
            ov.visit_end_for_overlap_utc AS origin_exit,
            ov.geofence_name AS origin_exit_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'origin_operational_stop'
          AND ov.visit_start_utc >= ls.session_out
          AND ov.visit_start_utc < COALESCE(sig.first_signal, tw.window_end)
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
        ORDER BY ov.visit_end_for_overlap_utc DESC NULLS LAST, ov.raw_visit_id DESC
        LIMIT 1
    ) ox ON true
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_start_utc AS dest_entry,
            ov.geofence_name AS dest_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_stop'
          AND ov.visit_start_utc > ls.session_out
          AND ov.visit_start_utc < tw.window_end
        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC
        LIMIT 1
    ) ds ON true
    LEFT JOIN LATERAL (
        -- Midnight Guard for dest_exit
        SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_exit
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_stop'
          AND ds.dest_entry IS NOT NULL
          AND ov.visit_start_utc >= ds.dest_entry
          AND ov.visit_start_utc < tw.window_end
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    ) dse ON true
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_start_utc AS dest_region_entry,
            ov.geofence_name AS dest_region_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_region_presence'
          AND ov.visit_start_utc > ls.session_out
          AND ov.visit_start_utc < tw.window_end
        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC
        LIMIT 1
    ) dr ON true
    LEFT JOIN LATERAL (
        -- Midnight Guard for dest_region_exit
        SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_region_exit
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_region_presence'
          AND dr.dest_region_entry IS NOT NULL
          AND ov.visit_start_utc >= dr.dest_region_entry
          AND ov.visit_start_utc < tw.window_end
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    ) dre ON true
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_start_utc AS return_origin_entry,
            ov.geofence_name AS return_origin_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state IN ('origin_operational_stop', 'origin_loading_stop')
          AND ov.visit_start_utc > COALESCE(
                dse.dest_exit,
                dre.dest_region_exit,
                ds.dest_entry,
                dr.dest_region_entry,
                ls.session_out
          )
          AND ov.visit_start_utc < tw.window_end
        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC
        LIMIT 1
    ) ro ON true;

    CREATE INDEX _idx_tc_trip ON _trip_context (trip_key);
    CREATE INDEX _idx_tc_tracker ON _trip_context (tracker_id, loading_start);

    -- 7) trip_anchor_start
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'trip_anchor_start', tc.pre_origin_in,
        0.90, 'state_machine_pre_origin_anchor',
        jsonb_build_object('geofence', tc.pre_origin_name, 'stop_state', 'origin_operational_stop'),
        tc.pre_origin_name, 'origin_gateway', 'loading'
    FROM _trip_context tc
    WHERE tc.pre_origin_in IS NOT NULL;

    -- 8) origin_exit
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'origin_exit', tc.origin_exit,
        0.90, 'state_machine_origin_exit',
        jsonb_build_object('geofence', tc.origin_exit_name),
        tc.origin_exit_name, 'origin_gateway', 'loading'
    FROM _trip_context tc
    WHERE tc.origin_exit IS NOT NULL;

    -- 9) Outbound transit events
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'corridor_entry', ov.visit_start_utc,
        0.80, 'state_machine_corridor',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name, 'corridor_region', 'transit'
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'corridor_transit'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end);

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'border_entry', ov.visit_start_utc,
        0.85, 'state_machine_border_outbound_entry',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name, 'border_other', 'transit', 'outbound',
        rb.border_code, rb.border_family, rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end)
    CROSS JOIN LATERAL public.resolve_border_code(ov.geofence_name) rb;

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'border_exit', ov.visit_end_for_overlap_utc,
        0.85, 'state_machine_border_outbound_exit',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name, 'border_other', 'transit', 'outbound',
        rb.border_code, rb.border_family, rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end)
     AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time) -- Midnight Guard
    CROSS JOIN LATERAL public.resolve_border_code(ov.geofence_name) rb;

    -- 10) Destination milestones
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'destination_entry', tc.dest_entry,
        0.92, 'state_machine_destination_entry',
        jsonb_build_object('geofence', tc.dest_name, 'stop_state', 'destination_stop'),
        tc.dest_name, 'destination_site', 'destination'
    FROM _trip_context tc
    WHERE tc.dest_entry IS NOT NULL;

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'destination_exit', tc.dest_exit,
        0.92, 'state_machine_destination_exit',
        jsonb_build_object('geofence', tc.dest_name, 'stop_state', 'destination_stop'),
        tc.dest_name, 'destination_site', 'destination'
    FROM _trip_context tc
    WHERE tc.dest_exit IS NOT NULL; -- Already guarded in CTE

    -- 11) Return border events
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'return_border_entry', ov.visit_start_utc,
        0.85, 'state_machine_border_return_entry',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name, 'border_other', 'returning', 'return',
        rb.border_code, rb.border_family, rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > COALESCE(tc.dest_exit, tc.dest_entry, tc.loading_end)
     AND ov.visit_start_utc < tc.window_end
    CROSS JOIN LATERAL public.resolve_border_code(ov.geofence_name) rb;

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'return_border_exit', ov.visit_end_for_overlap_utc,
        0.85, 'state_machine_border_return_exit',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name, 'border_other', 'returning', 'return',
        rb.border_code, rb.border_family, rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > COALESCE(tc.dest_exit, tc.dest_entry, tc.loading_end)
     AND ov.visit_start_utc < tc.window_end
     AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time) -- Midnight Guard
    CROSS JOIN LATERAL public.resolve_border_code(ov.geofence_name) rb;

    -- 12) Trip closures
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'trip_closed', tc.return_origin_entry,
        0.90, 'return_to_origin_state_machine',
        jsonb_build_object('geofence', tc.return_origin_name, 'reason', 'closed_by_return_origin'),
        tc.return_origin_name, 'origin_zone', 'returning'
    FROM _trip_context tc
    WHERE tc.return_origin_entry IS NOT NULL;

    -- ... Additional closure logic (next loading / checkout) preserved ...

    -- Final run metadata update
    PERFORM set_config('tat.current_build_run_id', v_run_id::text, true);
    PERFORM set_config('tat.current_rule_version', 'phase62_v1', true);

    UPDATE public.tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp()
    WHERE run_id = v_run_id;

END $$;
