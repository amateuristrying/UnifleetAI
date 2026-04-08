-- =============================================================
-- TAT V2 REFACTOR: Phase 21
-- Feature: Stop-state state-machine trip event builder.
--
-- Purpose:
--   Replace direct role-scan lifecycle building with a stop-state/event-driven
--   state machine based on get_tat_operational_visit_stream_v2().
--
-- Key outcomes:
--   - Trip anchoring still based on origin loading sessions.
--   - Milestones are emitted from explicit state transitions.
--   - Existing downstream event vocabulary is preserved for facts builders.
-- =============================================================

CREATE OR REPLACE FUNCTION build_trip_state_events_v2(
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
BEGIN
    SET LOCAL statement_timeout = 0;

    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_21_NO_GAP_STATE_MACHINE_V2', 'running',
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
        p_end + INTERVAL '365 days',
        p_tracker_id
    ) ov;

    CREATE INDEX _idx_ops_tracker_start ON _ops_visits (tracker_id, visit_start_utc);
    CREATE INDEX _idx_ops_tracker_state ON _ops_visits (tracker_id, stop_state, visit_start_utc);

    -- 2) Build loading sessions (trip anchors) from origin_loading_stop using strict continuity (no gap tolerance).
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
                    WHEN o.prev_max_out >= o.visit_start_utc THEN 0
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
            MAX(s.visit_end_for_overlap_utc) AS session_out
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

    -- 4) Cleanup events for rebuilt trips + stale overlapping legacy keys
    DELETE FROM trip_state_events
    WHERE trip_key IN (SELECT trip_key FROM _trip_windows);

    CREATE TEMP TABLE _stale_trip_keys (
        trip_key TEXT PRIMARY KEY
    ) ON COMMIT DROP;

    INSERT INTO _stale_trip_keys (trip_key)
    WITH existing_loading AS (
        SELECT
            ls.trip_key,
            ls.tracker_id,
            ls.event_time AS loading_start_time,
            (
                SELECT MAX(x.event_time)
                FROM trip_state_events x
                WHERE x.trip_key = ls.trip_key
                  AND x.event_code = 'loading_end'
            ) AS loading_end_time
        FROM trip_state_events ls
        WHERE ls.event_code = 'loading_start'
    )
    SELECT DISTINCT el.trip_key
    FROM existing_loading el
    JOIN _trip_windows tw
      ON tw.tracker_id = el.tracker_id
    WHERE el.trip_key <> tw.trip_key
      AND (
            COALESCE(el.loading_end_time, el.loading_start_time) >= tw.window_start
            AND el.loading_start_time < CASE
                                            WHEN tw.window_end = 'infinity'::TIMESTAMPTZ THEN p_end
                                            ELSE tw.window_end
                                        END
          )
      AND el.loading_start_time >= tw.window_start - INTERVAL '365 days';

    DELETE FROM trip_state_events
    WHERE trip_key IN (SELECT trip_key FROM _stale_trip_keys);

    -- 5) Base loading anchor events
    INSERT INTO trip_state_events (
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

    INSERT INTO trip_state_events (
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
     AND ls.session_in = tw.window_start;

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
                        WHEN p.prev_max_out >= p.visit_start_utc THEN 0
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
        SELECT
            ov.visit_end_for_overlap_utc AS origin_exit,
            ov.geofence_name AS origin_exit_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'origin_operational_stop'
          AND ov.visit_start_utc >= ls.session_out
          AND ov.visit_start_utc < COALESCE(sig.first_signal, tw.window_end)
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
        SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_exit
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_stop'
          AND ds.dest_entry IS NOT NULL
          AND ov.visit_start_utc >= ds.dest_entry
          AND ov.visit_start_utc < tw.window_end
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
        SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_region_exit
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_region_presence'
          AND dr.dest_region_entry IS NOT NULL
          AND ov.visit_start_utc >= dr.dest_region_entry
          AND ov.visit_start_utc < tw.window_end
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

    -- 7) trip_anchor_start (pre-loading origin readiness)
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'trip_anchor_start',
        tc.pre_origin_in,
        0.90,
        'state_machine_pre_origin_anchor',
        jsonb_build_object('geofence', tc.pre_origin_name, 'stop_state', 'origin_operational_stop'),
        tc.pre_origin_name,
        'origin_gateway',
        'loading'
    FROM _trip_context tc
    WHERE tc.pre_origin_in IS NOT NULL;

    -- 8) origin_exit
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'origin_exit',
        tc.origin_exit,
        0.90,
        'state_machine_origin_exit',
        jsonb_build_object('geofence', tc.origin_exit_name),
        tc.origin_exit_name,
        'origin_gateway',
        'loading'
    FROM _trip_context tc
    WHERE tc.origin_exit IS NOT NULL;

    -- 9) Outbound transit events from stop states
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'corridor_entry',
        ov.visit_start_utc,
        0.80,
        'state_machine_corridor',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'corridor_region',
        'transit'
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'corridor_transit'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end);

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'border_entry',
        ov.visit_start_utc,
        0.85,
        'state_machine_border_outbound_entry',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'border_other',
        'transit',
        'outbound',
        rb.border_code,
        rb.border_family,
        rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end)
    CROSS JOIN LATERAL resolve_border_code(ov.geofence_name) rb;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'border_exit',
        ov.visit_end_for_overlap_utc,
        0.85,
        'state_machine_border_outbound_exit',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'border_other',
        'transit',
        'outbound',
        rb.border_code,
        rb.border_family,
        rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end)
    CROSS JOIN LATERAL resolve_border_code(ov.geofence_name) rb;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'customs_entry',
        ov.visit_start_utc,
        0.85,
        'state_machine_customs_entry',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'customs_site',
        'transit'
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'customs_stop'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end);

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'customs_exit',
        ov.visit_end_for_overlap_utc,
        0.85,
        'state_machine_customs_exit',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'customs_site',
        'transit'
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'customs_stop'
     AND ov.visit_start_utc > tc.loading_end
     AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end);

    -- 10) Destination milestones
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'destination_entry',
        tc.dest_entry,
        0.92,
        'state_machine_destination_entry',
        jsonb_build_object('geofence', tc.dest_name, 'stop_state', 'destination_stop'),
        tc.dest_name,
        'destination_site',
        'destination'
    FROM _trip_context tc
    WHERE tc.dest_entry IS NOT NULL;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'destination_exit',
        tc.dest_exit,
        0.92,
        'state_machine_destination_exit',
        jsonb_build_object('geofence', tc.dest_name, 'stop_state', 'destination_stop'),
        tc.dest_name,
        'destination_site',
        'destination'
    FROM _trip_context tc
    WHERE tc.dest_entry IS NOT NULL
      AND tc.dest_exit IS NOT NULL;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'destination_region_entry',
        tc.dest_region_entry,
        0.80,
        'state_machine_destination_region_entry',
        jsonb_build_object('geofence', tc.dest_region_name, 'stop_state', 'destination_region_presence'),
        tc.dest_region_name,
        'destination_region',
        'transit'
    FROM _trip_context tc
    WHERE tc.dest_region_entry IS NOT NULL;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'destination_region_exit',
        tc.dest_region_exit,
        0.80,
        'state_machine_destination_region_exit',
        jsonb_build_object('geofence', tc.dest_region_name, 'stop_state', 'destination_region_presence'),
        tc.dest_region_name,
        'destination_region',
        'transit'
    FROM _trip_context tc
    WHERE tc.dest_region_entry IS NOT NULL
      AND tc.dest_region_exit IS NOT NULL;

    -- Preserve explicit customer events from normalized role taxonomy
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'customer_entry',
        c.in_time,
        c.normalization_confidence,
        'state_machine_customer_entry',
        jsonb_build_object('geofence', c.canonical_name, 'role', c.role_code),
        c.canonical_name,
        c.role_code,
        'destination',
        c.event_id
    FROM _trip_context tc
    JOIN LATERAL (
        SELECT n.event_id, n.in_time, n.normalization_confidence, n.canonical_name, n.role_code
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tc.tracker_id
          AND n.role_code = 'customer_site'
          AND n.in_time > tc.loading_end
          AND n.in_time < tc.window_end
        ORDER BY n.in_time ASC
        LIMIT 1
    ) c ON true;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'customer_exit',
        c.out_time,
        c.normalization_confidence,
        'state_machine_customer_exit',
        jsonb_build_object('geofence', c.canonical_name, 'role', c.role_code),
        c.canonical_name,
        c.role_code,
        'destination',
        c.event_id
    FROM _trip_context tc
    JOIN LATERAL (
        SELECT n.event_id, n.out_time, n.normalization_confidence, n.canonical_name, n.role_code
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tc.tracker_id
          AND n.role_code = 'customer_site'
          AND n.out_time IS NOT NULL
          AND n.in_time > tc.loading_end
          AND n.in_time < tc.window_end
        ORDER BY n.out_time DESC NULLS LAST
        LIMIT 1
    ) c ON true;

    -- 11) Return border events
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'return_border_entry',
        ov.visit_start_utc,
        0.85,
        'state_machine_border_return_entry',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'border_other',
        'returning',
        'return',
        rb.border_code,
        rb.border_family,
        rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > COALESCE(
            tc.dest_exit,
            tc.dest_region_exit,
            tc.dest_entry,
            tc.dest_region_entry,
            tc.loading_end
     )
     AND ov.visit_start_utc < tc.window_end
    CROSS JOIN LATERAL resolve_border_code(ov.geofence_name) rb;

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction,
        border_code, border_family, country_code
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'return_border_exit',
        ov.visit_end_for_overlap_utc,
        0.85,
        'state_machine_border_return_exit',
        jsonb_build_object('geofence', ov.geofence_name, 'stop_state', ov.stop_state),
        ov.geofence_name,
        'border_other',
        'returning',
        'return',
        rb.border_code,
        rb.border_family,
        rb.country_code
    FROM _trip_context tc
    JOIN _ops_visits ov
      ON ov.tracker_id = tc.tracker_id
     AND ov.stop_state = 'border_crossing'
     AND ov.visit_start_utc > COALESCE(
            tc.dest_exit,
            tc.dest_region_exit,
            tc.dest_entry,
            tc.dest_region_entry,
            tc.loading_end
     )
     AND ov.visit_start_utc < tc.window_end
    CROSS JOIN LATERAL resolve_border_code(ov.geofence_name) rb;

    -- 12) Trip closures
    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'trip_closed',
        tc.return_origin_entry,
        0.90,
        'return_to_origin_state_machine',
        jsonb_build_object('geofence', tc.return_origin_name, 'reason', 'closed_by_return_origin'),
        tc.return_origin_name,
        'origin_zone',
        'returning'
    FROM _trip_context tc
    WHERE tc.return_origin_entry IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM trip_state_events e
          WHERE e.trip_key = tc.trip_key
            AND e.event_code = 'trip_closed'
      );

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'trip_closed',
        tc.window_end,
        0.80,
        'next_loading_started_state_machine',
        jsonb_build_object('reason', 'closed_by_next_loading'),
        'returning'
    FROM _trip_context tc
    WHERE tc.window_end < 'infinity'::TIMESTAMPTZ
      AND NOT EXISTS (
          SELECT 1
          FROM trip_state_events e
          WHERE e.trip_key = tc.trip_key
            AND e.event_code = 'trip_closed'
      )
      AND EXISTS (
          SELECT 1
          FROM trip_state_events e
          WHERE e.trip_key = tc.trip_key
            AND e.event_code IN ('destination_entry','destination_region_entry','border_entry','corridor_entry','origin_exit')
      );

    INSERT INTO trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        trip_stage
    )
    SELECT
        tc.trip_key,
        tc.tracker_id,
        tc.tracker_name,
        'trip_closed',
        last_ev.last_event_time + INTERVAL '30 days',
        0.50,
        'timeout_30d_state_machine',
        jsonb_build_object('reason', 'closed_by_timeout'),
        'returning'
    FROM _trip_context tc
    JOIN LATERAL (
        SELECT MAX(e.event_time) AS last_event_time
        FROM trip_state_events e
        WHERE e.trip_key = tc.trip_key
    ) last_ev ON true
    WHERE tc.window_end = 'infinity'::TIMESTAMPTZ
      AND last_ev.last_event_time < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
          SELECT 1
          FROM trip_state_events e
          WHERE e.trip_key = tc.trip_key
            AND e.event_code = 'trip_closed'
      );

    -- 13) Data quality marker
    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, trip_key, issue_type, severity, description
    )
    SELECT
        v_run_id,
        tc.tracker_id,
        tc.trip_key,
        'missing_destination',
        'medium',
        'Trip has no destination_entry event'
    FROM _trip_context tc
    WHERE NOT EXISTS (
        SELECT 1
        FROM trip_state_events e
        WHERE e.trip_key = tc.trip_key
          AND e.event_code = 'destination_entry'
    )
      AND NOT EXISTS (
          SELECT 1
          FROM tat_data_quality_issues dq
          WHERE dq.run_id      = v_run_id
            AND dq.issue_type  = 'missing_destination'
            AND dq.tracker_id  = tc.tracker_id
            AND dq.trip_key    = tc.trip_key
            AND dq.description = 'Trip has no destination_entry event'
      )
    ON CONFLICT DO NOTHING;

    -- Cleanup temp structures
    DROP TABLE IF EXISTS _ops_visits;
    DROP TABLE IF EXISTS _loading_sessions;
    DROP TABLE IF EXISTS _trip_windows;
    DROP TABLE IF EXISTS _trip_context;
    DROP TABLE IF EXISTS _stale_trip_keys;

    UPDATE tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'trips_anchored', (
                SELECT COUNT(DISTINCT trip_key) FROM trip_state_events
                WHERE event_code = 'loading_start'
                  AND event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'total_events', (
                SELECT COUNT(*) FROM trip_state_events
                WHERE event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'border_events', (
                SELECT COUNT(*) FROM trip_state_events
                WHERE event_code IN ('border_entry','border_exit','return_border_entry','return_border_exit')
                  AND event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'closed_trips', (
                SELECT COUNT(DISTINCT trip_key) FROM trip_state_events
                WHERE event_code = 'trip_closed'
                  AND event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            )
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    DROP TABLE IF EXISTS _ops_visits;
    DROP TABLE IF EXISTS _loading_sessions;
    DROP TABLE IF EXISTS _trip_windows;
    DROP TABLE IF EXISTS _trip_context;
    DROP TABLE IF EXISTS _stale_trip_keys;

    UPDATE tat_refactor_runs
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;


-- =============================================================
-- Phase 21 override: remove visit-gap heuristics from uncovered RPCs
-- =============================================================
CREATE OR REPLACE FUNCTION get_tat_uncovered_trip_summary_v2(
    p_start_date       TIMESTAMPTZ,
    p_end_date         TIMESTAMPTZ,
    p_tracker_id       INTEGER DEFAULT NULL,
    p_orphan_gap_hours NUMERIC DEFAULT 8,
    p_tracker_limit    INTEGER DEFAULT 500,
    p_trip_limit       INTEGER DEFAULT 5000
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH p AS (
        SELECT
            p_start_date AS from_ts,
            p_end_date AS to_ts,
            INTERVAL '0 seconds' AS orphan_gap,
            INTERVAL '0 seconds' AS coverage_buffer
    ),
    facts_scope AS (
        SELECT
            f.tracker_id,
            COALESCE(f.dar_arrival, f.loading_start) AS fact_trip_start_utc,
            COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) AS fact_trip_end_utc,
            CONCAT(
                'FACT:',
                f.tracker_id::text, ':',
                EXTRACT(EPOCH FROM COALESCE(f.dar_arrival, f.loading_start))::bigint::text, ':',
                EXTRACT(EPOCH FROM COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival))::bigint::text
            ) AS fact_trip_key
        FROM public.tat_trip_facts_v2 f
        CROSS JOIN p
        WHERE f.tracker_id IS NOT NULL
          AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
          AND COALESCE(f.dar_arrival, f.loading_start) IS NOT NULL
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) IS NOT NULL
          AND COALESCE(f.dar_arrival, f.loading_start) <= p.to_ts
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) >= p.from_ts
    ),
    raw_scope AS (
        SELECT
            ROW_NUMBER() OVER (
                ORDER BY
                    ov.tracker_id,
                    ov.visit_start_utc,
                    ov.visit_end_utc,
                    COALESCE(ov.geofence_name, '')
            ) AS raw_visit_id,
            ov.tracker_id,
            ov.tracker_name,
            ov.geofence_name,
            ov.stop_state,
            ov.state_rank,
            ov.visit_start_utc,
            ov.visit_end_utc,
            ov.visit_end_for_overlap_utc,
            ov.is_open_geofence
        FROM public.get_tat_operational_visit_stream_v2(
            p_start_date,
            p_end_date,
            p_tracker_id
        ) ov
    ),
    raw_mapped AS (
        SELECT
            rs.*,
            mf.fact_trip_key AS matched_fact_trip_key
        FROM raw_scope rs
        LEFT JOIN LATERAL (
            SELECT
                fs.fact_trip_key,
                GREATEST(
                    0,
                    EXTRACT(EPOCH FROM
                        LEAST(rs.visit_end_for_overlap_utc, fs.fact_trip_end_utc)
                        - GREATEST(rs.visit_start_utc, fs.fact_trip_start_utc)
                    )
                )::bigint AS overlap_seconds
            FROM facts_scope fs
            CROSS JOIN p
            WHERE fs.tracker_id = rs.tracker_id
              AND rs.visit_start_utc < fs.fact_trip_end_utc
              AND rs.visit_end_for_overlap_utc > fs.fact_trip_start_utc
            ORDER BY
                GREATEST(
                    0,
                    EXTRACT(EPOCH FROM
                        LEAST(rs.visit_end_for_overlap_utc, fs.fact_trip_end_utc)
                        - GREATEST(rs.visit_start_utc, fs.fact_trip_start_utc)
                    )
                ) DESC,
                fs.fact_trip_start_utc
            LIMIT 1
        ) mf ON TRUE
    ),
    orphan_only AS (
        SELECT
            x.*,
            CASE
                WHEN x.prev_visit_end_utc IS NULL THEN 1
                WHEN x.visit_start_utc > x.prev_visit_end_utc THEN 1
                ELSE 0
            END AS is_new_orphan_trip
        FROM (
            SELECT
                rm.*,
                LAG(rm.visit_end_for_overlap_utc) OVER (
                    PARTITION BY rm.tracker_id
                    ORDER BY rm.visit_start_utc, rm.raw_visit_id
                ) AS prev_visit_end_utc
            FROM raw_mapped rm
            WHERE rm.matched_fact_trip_key IS NULL
        ) x
        CROSS JOIN p
    ),
    orphan_tagged AS (
        SELECT
            oo.raw_visit_id,
            oo.tracker_id,
            SUM(oo.is_new_orphan_trip) OVER (
                PARTITION BY oo.tracker_id
                ORDER BY oo.visit_start_utc, oo.raw_visit_id
                ROWS UNBOUNDED PRECEDING
            ) AS orphan_trip_seq
        FROM orphan_only oo
    ),
    orphan_with_trip AS (
        SELECT
            oo.raw_visit_id,
            oo.tracker_id,
            oo.tracker_name,
            oo.geofence_name,
            oo.stop_state,
            oo.state_rank,
            oo.visit_start_utc,
            oo.visit_end_utc,
            oo.visit_end_for_overlap_utc,
            oo.is_open_geofence,
            CONCAT(
                'ORPHAN:',
                oo.tracker_id::text, ':',
                LPAD(COALESCE(ot.orphan_trip_seq, 1)::text, 6, '0')
            ) AS trip_key
        FROM orphan_only oo
        LEFT JOIN orphan_tagged ot
            ON ot.raw_visit_id = oo.raw_visit_id
    ),
    trip_stats AS (
        SELECT
            owt.tracker_id,
            MAX(owt.tracker_name) AS tracker_name,
            owt.trip_key,
            MIN(owt.visit_start_utc) AS trip_start_utc,
            MAX(owt.visit_end_for_overlap_utc) AS trip_end_utc,
            ROUND(
                GREATEST(EXTRACT(EPOCH FROM (MAX(owt.visit_end_for_overlap_utc) - MIN(owt.visit_start_utc))), 0) / 3600.0,
                2
            ) AS trip_duration_hours,
            COUNT(*)::bigint AS trip_raw_geofence_rows,
            COUNT(DISTINCT owt.geofence_name)::bigint AS trip_distinct_geofences,
            COUNT(*) FILTER (WHERE owt.state_rank >= 70)::bigint AS trip_major_state_rows,
            COUNT(*) FILTER (WHERE owt.is_open_geofence)::bigint AS open_geofence_rows
        FROM orphan_with_trip owt
        GROUP BY owt.tracker_id, owt.trip_key
    ),
    trip_last_geofence AS (
        SELECT DISTINCT ON (owt.tracker_id, owt.trip_key)
            owt.tracker_id,
            owt.trip_key,
            owt.geofence_name AS trip_last_geofence_name,
            owt.visit_start_utc AS trip_last_geofence_since_utc
        FROM orphan_with_trip owt
        ORDER BY owt.tracker_id, owt.trip_key, owt.visit_start_utc DESC, owt.raw_visit_id DESC
    ),
    trip_state_mix AS (
        SELECT
            owt.tracker_id,
            owt.trip_key,
            ARRAY_AGG(DISTINCT owt.stop_state ORDER BY owt.stop_state) AS trip_stop_states
        FROM orphan_with_trip owt
        GROUP BY owt.tracker_id, owt.trip_key
    ),
    tracker_rollup AS (
        SELECT
            ts.tracker_id,
            COALESCE(MAX(ts.tracker_name), '(unknown)') AS tracker_name,
            COUNT(*)::bigint AS uncovered_trip_count,
            SUM(ts.trip_raw_geofence_rows)::bigint AS uncovered_raw_geofence_rows,
            SUM(ts.trip_major_state_rows)::bigint AS uncovered_major_state_rows,
            SUM(ts.trip_distinct_geofences)::bigint AS uncovered_distinct_geofences,
            ROUND(SUM(ts.trip_duration_hours), 2) AS uncovered_total_hours,
            SUM(ts.open_geofence_rows)::bigint AS open_geofence_rows,
            MIN(ts.trip_start_utc) AS first_uncovered_trip_start_utc,
            MAX(ts.trip_end_utc) AS last_uncovered_trip_end_utc
        FROM trip_stats ts
        GROUP BY ts.tracker_id
    ),
    tracker_rows AS (
        SELECT *
        FROM tracker_rollup
        ORDER BY uncovered_trip_count DESC, last_uncovered_trip_end_utc DESC NULLS LAST, tracker_id
        LIMIT GREATEST(COALESCE(p_tracker_limit, 500), 1)
    ),
    trip_rows AS (
        SELECT
            ts.tracker_id,
            tr.tracker_name,
            ts.trip_key,
            ts.trip_start_utc,
            ts.trip_end_utc,
            ts.trip_duration_hours,
            ts.trip_raw_geofence_rows,
            ts.trip_major_state_rows,
            ts.trip_distinct_geofences,
            ts.open_geofence_rows,
            tlg.trip_last_geofence_name,
            tlg.trip_last_geofence_since_utc,
            tsm.trip_stop_states
        FROM trip_stats ts
        JOIN tracker_rows tr
            ON tr.tracker_id = ts.tracker_id
        LEFT JOIN trip_last_geofence tlg
            ON tlg.tracker_id = ts.tracker_id
           AND tlg.trip_key = ts.trip_key
        LEFT JOIN trip_state_mix tsm
            ON tsm.tracker_id = ts.tracker_id
           AND tsm.trip_key = ts.trip_key
        ORDER BY ts.trip_end_utc DESC NULLS LAST, ts.tracker_id, ts.trip_start_utc
        LIMIT GREATEST(COALESCE(p_trip_limit, 5000), 1)
    )
    SELECT json_build_object(
        'start_date',               p_start_date,
        'end_date',                 p_end_date,
        'orphan_gap_hours',         0,
        'coverage_buffer_hours',    0,
        'tracker_limit_applied',    GREATEST(COALESCE(p_tracker_limit, 500), 1),
        'trip_limit_applied',       GREATEST(COALESCE(p_trip_limit, 5000), 1),
        'detection_mode',           'stop_state_event_v2',
        'visit_source',             'trip_geofence_events_normalized',
        'total_uncovered_trips',    COALESCE((SELECT COUNT(*) FROM trip_stats), 0),
        'total_uncovered_trackers', COALESCE((SELECT COUNT(*) FROM tracker_rollup), 0),
        'trackers',                 COALESCE((SELECT json_agg(row_to_json(r)) FROM tracker_rows r), '[]'::json),
        'trips',                    COALESCE((SELECT json_agg(row_to_json(r)) FROM trip_rows r), '[]'::json)
    ) INTO v_result;

    RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION get_tat_uncovered_facts_summary_v2(
    p_start_date       TIMESTAMPTZ,
    p_end_date         TIMESTAMPTZ,
    p_tracker_id       INTEGER DEFAULT NULL,
    p_orphan_gap_hours NUMERIC DEFAULT 8,
    p_tracker_limit    INTEGER DEFAULT 500
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH p AS (
        SELECT
            p_start_date AS from_ts,
            p_end_date AS to_ts,
            INTERVAL '0 seconds' AS orphan_gap,
            INTERVAL '0 seconds' AS coverage_buffer
    ),
    facts_scope AS (
        SELECT
            f.tracker_id,
            COALESCE(f.dar_arrival, f.loading_start) AS fact_trip_start_utc,
            COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) AS fact_trip_end_utc,
            f.status AS fact_status
        FROM public.tat_trip_facts_v2 f
        CROSS JOIN p
        WHERE f.tracker_id IS NOT NULL
          AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
          AND COALESCE(f.dar_arrival, f.loading_start) IS NOT NULL
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) IS NOT NULL
          AND COALESCE(f.dar_arrival, f.loading_start) <= p.to_ts
          AND COALESCE(f.trip_closed_at, f.next_loading_entry, f.loading_end, f.loading_start, f.dar_arrival) >= p.from_ts
    ),
    raw_scope AS (
        SELECT
            ROW_NUMBER() OVER (
                ORDER BY
                    ov.tracker_id,
                    ov.visit_start_utc,
                    ov.visit_end_utc,
                    COALESCE(ov.geofence_name, '')
            ) AS raw_visit_id,
            ov.tracker_id,
            ov.tracker_name,
            ov.geofence_name,
            ov.stop_state,
            ov.state_rank,
            ov.visit_start_utc,
            ov.visit_end_utc,
            ov.visit_end_for_overlap_utc,
            ov.is_open_geofence
        FROM public.get_tat_operational_visit_stream_v2(
            p_start_date,
            p_end_date,
            p_tracker_id
        ) ov
    ),
    raw_uncovered AS (
        SELECT rs.*
        FROM raw_scope rs
        WHERE NOT EXISTS (
            SELECT 1
            FROM facts_scope fs
            CROSS JOIN p
            WHERE fs.tracker_id = rs.tracker_id
              AND rs.visit_start_utc < fs.fact_trip_end_utc
              AND rs.visit_end_for_overlap_utc > fs.fact_trip_start_utc
        )
    ),
    uncovered_only AS (
        SELECT
            x.*,
            CASE
                WHEN x.prev_visit_end_utc IS NULL THEN 1
                WHEN x.visit_start_utc > x.prev_visit_end_utc THEN 1
                ELSE 0
            END AS is_new_orphan_trip
        FROM (
            SELECT
                ru.*,
                LAG(ru.visit_end_for_overlap_utc) OVER (
                    PARTITION BY ru.tracker_id
                    ORDER BY ru.visit_start_utc, ru.raw_visit_id
                ) AS prev_visit_end_utc
            FROM raw_uncovered ru
        ) x
        CROSS JOIN p
    ),
    uncovered_tagged AS (
        SELECT
            uo.*,
            SUM(uo.is_new_orphan_trip) OVER (
                PARTITION BY uo.tracker_id
                ORDER BY uo.visit_start_utc, uo.raw_visit_id
                ROWS UNBOUNDED PRECEDING
            ) AS orphan_trip_seq
        FROM uncovered_only uo
    ),
    uncovered_trip_stats AS (
        SELECT
            ut.tracker_id,
            ut.orphan_trip_seq,
            MIN(ut.visit_start_utc) AS trip_start_utc,
            MAX(ut.visit_end_for_overlap_utc) AS trip_end_utc,
            ROUND(
                GREATEST(EXTRACT(EPOCH FROM (MAX(ut.visit_end_for_overlap_utc) - MIN(ut.visit_start_utc))), 0) / 3600.0,
                2
            ) AS trip_duration_hours,
            COUNT(*)::bigint AS trip_raw_geofence_rows,
            COUNT(DISTINCT ut.geofence_name)::bigint AS trip_distinct_geofences,
            COUNT(*) FILTER (WHERE ut.state_rank >= 70)::bigint AS trip_major_state_rows,
            COUNT(*) FILTER (WHERE ut.is_open_geofence)::bigint AS open_geofence_rows
        FROM uncovered_tagged ut
        GROUP BY ut.tracker_id, ut.orphan_trip_seq
    ),
    uncovered_tracker_summary AS (
        SELECT
            uts.tracker_id,
            COUNT(*)::bigint AS uncovered_trip_count,
            SUM(uts.trip_raw_geofence_rows)::bigint AS uncovered_raw_geofence_rows,
            SUM(uts.trip_major_state_rows)::bigint AS uncovered_major_state_rows,
            SUM(uts.trip_distinct_geofences)::bigint AS uncovered_distinct_geofences,
            ROUND(SUM(uts.trip_duration_hours), 2) AS uncovered_total_hours,
            SUM(uts.open_geofence_rows)::bigint AS open_geofence_rows,
            MIN(uts.trip_start_utc) AS first_uncovered_trip_start_utc,
            MAX(uts.trip_end_utc) AS last_uncovered_trip_end_utc
        FROM uncovered_trip_stats uts
        GROUP BY uts.tracker_id
    ),
    facts_tracker_summary AS (
        SELECT
            fs.tracker_id,
            COUNT(*)::bigint AS fact_trip_count,
            COUNT(*) FILTER (WHERE fs.fact_status = 'completed')::bigint AS fact_completed_count,
            COUNT(*) FILTER (WHERE fs.fact_status = 'returning')::bigint AS fact_returning_count,
            COUNT(*) FILTER (WHERE fs.fact_status IN ('loading', 'pre_transit', 'in_transit', 'at_destination'))::bigint AS fact_unfinished_count
        FROM facts_scope fs
        GROUP BY fs.tracker_id
    ),
    tracker_names AS (
        SELECT
            rs.tracker_id,
            MAX(rs.tracker_name) AS tracker_name
        FROM raw_scope rs
        GROUP BY rs.tracker_id
    ),
    tracker_rows AS (
        SELECT
            uts.tracker_id,
            COALESCE(tn.tracker_name, '(unknown)') AS tracker_name,
            COALESCE(fts.fact_trip_count, 0)::bigint AS fact_trip_count,
            COALESCE(fts.fact_completed_count, 0)::bigint AS fact_completed_count,
            COALESCE(fts.fact_returning_count, 0)::bigint AS fact_returning_count,
            COALESCE(fts.fact_unfinished_count, 0)::bigint AS fact_unfinished_count,
            uts.uncovered_trip_count,
            uts.uncovered_raw_geofence_rows,
            uts.uncovered_major_state_rows,
            uts.uncovered_distinct_geofences,
            uts.uncovered_total_hours,
            uts.open_geofence_rows,
            uts.first_uncovered_trip_start_utc,
            uts.last_uncovered_trip_end_utc,
            CASE
                WHEN COALESCE(fts.fact_trip_count, 0) > 0
                    THEN ROUND((uts.uncovered_trip_count::numeric / fts.fact_trip_count::numeric) * 100.0, 2)
                ELSE NULL
            END AS uncovered_vs_fact_pct
        FROM uncovered_tracker_summary uts
        LEFT JOIN facts_tracker_summary fts
            ON fts.tracker_id = uts.tracker_id
        LEFT JOIN tracker_names tn
            ON tn.tracker_id = uts.tracker_id
        ORDER BY uts.uncovered_trip_count DESC, uts.last_uncovered_trip_end_utc DESC NULLS LAST, uts.tracker_id
        LIMIT GREATEST(COALESCE(p_tracker_limit, 500), 1)
    ),
    overall AS (
        SELECT
            COALESCE((SELECT COUNT(*) FROM facts_scope), 0)::bigint AS total_fact_trips,
            COALESCE((SELECT COUNT(DISTINCT tracker_id) FROM facts_scope), 0)::bigint AS total_fact_trackers,
            COALESCE((SELECT COUNT(*) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_trips,
            COALESCE((SELECT COUNT(DISTINCT tracker_id) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_trackers,
            COALESCE((SELECT ROUND(SUM(trip_duration_hours), 2) FROM uncovered_trip_stats), 0)::numeric AS total_uncovered_hours,
            COALESCE((SELECT SUM(trip_raw_geofence_rows) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_raw_geofence_rows,
            COALESCE((SELECT SUM(trip_major_state_rows) FROM uncovered_trip_stats), 0)::bigint AS total_uncovered_major_state_rows
    )
    SELECT json_build_object(
        'start_date',                        p_start_date,
        'end_date',                          p_end_date,
        'orphan_gap_hours',         0,
        'coverage_buffer_hours',    0,
        'tracker_limit_applied',             GREATEST(COALESCE(p_tracker_limit, 500), 1),
        'detection_mode',                    'stop_state_event_v2',
        'visit_source',                      'trip_geofence_events_normalized',
        'total_fact_trips',                  o.total_fact_trips,
        'total_fact_trackers',               o.total_fact_trackers,
        'total_uncovered_trips',             o.total_uncovered_trips,
        'total_uncovered_trackers',          o.total_uncovered_trackers,
        'total_uncovered_hours',             o.total_uncovered_hours,
        'total_uncovered_raw_geofence_rows', o.total_uncovered_raw_geofence_rows,
        'total_uncovered_major_state_rows',  o.total_uncovered_major_state_rows,
        'uncovered_vs_fact_pct',             CASE
                                                 WHEN o.total_fact_trips > 0
                                                     THEN ROUND((o.total_uncovered_trips::numeric / o.total_fact_trips::numeric) * 100.0, 2)
                                                 ELSE NULL
                                             END,
        'trackers',                          COALESCE((SELECT json_agg(row_to_json(r)) FROM tracker_rows r), '[]'::json)
    ) INTO v_result
    FROM overall o;

    RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.get_tat_operational_visit_stream_v2(
    timestamptz,
    timestamptz,
    integer
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_tat_uncovered_trip_summary_v2(
    timestamptz,
    timestamptz,
    integer,
    numeric,
    integer,
    integer
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_tat_uncovered_facts_summary_v2(
    timestamptz,
    timestamptz,
    integer,
    numeric,
    integer
) TO anon, authenticated, service_role;
