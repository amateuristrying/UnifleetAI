-- =============================================================
-- TAT V2 REFACTOR: Phase 76e
-- Restricted Loading Hub: ONLY Kurasini Zone as Hub
--
-- Problem: 
--   Tanga Zone, Beira Zone, etc., are currently acting as 
--   loading hubs (Branch B logic), anchoring both a trip's 
--   pre-origin and loading start. The user specifies these 
--   should not behave like Kurasini.
--
-- Fix:
--   Update build_trip_state_events_v2 and build_tat_trip_facts_v2
--   to restrict the Branch B (operational stop fallback) logic 
--   EXCLUSIVELY to 'KURASINI ZONE'.
-- =============================================================

-- 1) Update build_trip_state_events_v2
CREATE OR REPLACE FUNCTION public.build_trip_state_events_v2(
    p_start           TIMESTAMPTZ,
    p_end             TIMESTAMPTZ,
    p_tracker_id      INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
    v_run_id        UUID;
BEGIN
    -- 0) Initialize run metadata
    INSERT INTO public.tat_refactor_runs (phase, status, start_time, parameters)
    VALUES ('PHASE_3_EVENTS_V2', 'running', clock_timestamp(), jsonb_build_object('p_start', p_start, 'p_end', p_end, 'p_tracker_id', p_tracker_id))
    RETURNING run_id INTO v_run_id;

    -- 1) Extract relevant visits for the processing window
    CREATE TEMP TABLE _ops_visits ON COMMIT DROP AS
    SELECT 
        ROW_NUMBER() OVER (
            PARTITION BY ov.tracker_id
            ORDER BY ov.visit_start_utc, ov.visit_end_utc, ov.geofence_name
        ) AS raw_visit_id,
        ov.tracker_id, ov.tracker_name, ov.geofence_name,
        ov.visit_start_utc, ov.visit_end_utc, ov.visit_end_for_overlap_utc,
        ov.stop_state, ov.state_rank, ov.is_open_geofence
    FROM public.get_tat_operational_visit_stream_v2(
        p_start - INTERVAL '30 days',
        p_end + INTERVAL '180 days',
        p_tracker_id
    ) ov;

    CREATE INDEX _idx_ops_tracker_start ON _ops_visits (tracker_id, visit_start_utc);

    -- 2) Identify loading sessions (Phases 66, 75, 76 combined)
    CREATE TEMP TABLE _loading_sessions ON COMMIT DROP AS
    WITH loading_only AS (
        -- Branch A: Terminal-level loading stops (No gateways)
        SELECT ov.*
        FROM _ops_visits ov
        WHERE ov.stop_state = 'origin_loading_stop'
          AND NOT EXISTS (
              SELECT 1 FROM geofence_master gm_excl
              WHERE UPPER(gm_excl.canonical_name) = UPPER(ov.geofence_name)
                AND gm_excl.default_role_code LIKE 'origin_gateway%'
          )

        UNION ALL

        -- Branch B: Origin-zone loading hub extension (RESTRICTED TO KURASINI)
        -- Phase 76e: Only Kurasini acts as a fallback hub when no terminal is hit.
        SELECT ov.*
        FROM _ops_visits ov
        JOIN geofence_master gm
          ON UPPER(gm.canonical_name) = UPPER(ov.geofence_name)
         AND gm.default_role_code LIKE 'origin_zone%'
         AND gm.default_role_code NOT LIKE 'origin_gateway%'
        WHERE ov.stop_state = 'operational_stop'
          AND UPPER(ov.geofence_name) = 'KURASINI ZONE' -- RESTRICTION
          AND NOT EXISTS (
              SELECT 1 FROM _ops_visits term
              WHERE term.tracker_id = ov.tracker_id
                AND term.stop_state = 'origin_loading_stop'
                AND term.visit_start_utc < COALESCE(ov.visit_end_for_overlap_utc, ov.visit_end_utc)
                AND COALESCE(term.visit_end_for_overlap_utc, term.visit_end_utc) > ov.visit_start_utc
          )
    ),
    ordered AS (
        SELECT lo.*, MAX(lo.visit_end_for_overlap_utc) OVER (PARTITION BY lo.tracker_id ORDER BY lo.visit_start_utc, lo.visit_end_for_overlap_utc ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_out
        FROM loading_only lo
    ),
    sessioned AS (
        SELECT o.*, SUM(CASE WHEN o.prev_max_out IS NULL THEN 1 WHEN o.prev_max_out >= o.visit_start_utc - INTERVAL '6 hours' THEN 0 ELSE 1 END) OVER (PARTITION BY o.tracker_id ORDER BY o.visit_start_utc, o.visit_end_for_overlap_utc) AS session_group
        FROM ordered o
    ),
    rollup AS (
        SELECT s.tracker_id, MAX(s.tracker_name) AS tracker_name, s.session_group, MIN(s.visit_start_utc) AS session_in, CASE WHEN bool_and(NOT (s.is_open_geofence OR s.visit_end_utc::time = '23:59:59'::time)) THEN MAX(s.visit_end_for_overlap_utc) ELSE NULL END AS session_out
        FROM sessioned s GROUP BY s.tracker_id, s.session_group
    ),
    terminal_pick AS (
        SELECT DISTINCT ON (s.tracker_id, s.session_group) s.tracker_id, s.session_group, s.geofence_name AS loading_terminal
        FROM sessioned s ORDER BY s.tracker_id, s.session_group, s.state_rank DESC, s.visit_start_utc ASC, s.raw_visit_id ASC
    )
    SELECT r.tracker_id, r.tracker_name, r.session_group, tp.loading_terminal, r.session_in, r.session_out
    FROM rollup r JOIN terminal_pick tp ON tp.tracker_id = r.tracker_id AND tp.session_group = r.session_group;

    CREATE INDEX _idx_ls_tracker_in ON _loading_sessions (tracker_id, session_in);

    -- 3) Build active trip windows (Phase 76b: coverage_start added)
    CREATE TEMP TABLE _trip_windows (
        trip_key           TEXT,
        tracker_id         INTEGER,
        tracker_name       TEXT,
        loading_terminal   TEXT,
        window_start       TIMESTAMPTZ,
        window_end         TIMESTAMPTZ,
        prev_window_start  TIMESTAMPTZ,
        coverage_start     TIMESTAMPTZ
    ) ON COMMIT DROP;

    INSERT INTO _trip_windows
    WITH sequenced AS (
        SELECT ls.*, LAG(ls.session_in) OVER (PARTITION BY ls.tracker_id ORDER BY ls.session_in) AS prev_session_in, LEAD(ls.session_in) OVER (PARTITION BY ls.tracker_id ORDER BY ls.session_in) AS next_session_in FROM _loading_sessions ls
    )
    SELECT s.tracker_id::TEXT || ':' || EXTRACT(EPOCH FROM s.session_in)::BIGINT::TEXT, s.tracker_id, s.tracker_name, s.loading_terminal, s.session_in, COALESCE(s.next_session_in, 'infinity'::TIMESTAMPTZ), s.prev_session_in, GREATEST(COALESCE((SELECT MAX(e.event_time) FROM public.trip_state_events e WHERE e.tracker_id = s.tracker_id AND e.event_code = 'trip_closed' AND e.event_time < s.session_in), s.session_in - INTERVAL '30 days'), s.session_in - INTERVAL '30 days')
    FROM sequenced s WHERE s.session_in >= p_start AND s.session_in < p_end;

    DELETE FROM public.trip_state_events WHERE trip_key IN (SELECT trip_key FROM _trip_windows);

    -- 5) Base loading anchor events (Phase 76: dynamic roles)
    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tw.trip_key, tw.tracker_id, tw.tracker_name, 'loading_start', tw.window_start, 0.95, 'state_machine_loading_start', jsonb_build_object('geofence', tw.loading_terminal, 'stop_state', 'origin_loading_stop'), tw.loading_terminal, COALESCE((SELECT CASE WHEN gm.default_role_code LIKE 'origin_zone%' THEN 'origin_zone' ELSE 'origin_terminal' END FROM geofence_master gm WHERE UPPER(gm.canonical_name) = UPPER(tw.loading_terminal) LIMIT 1), 'origin_terminal'), 'loading' FROM _trip_windows tw;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tw.trip_key, tw.tracker_id, tw.tracker_name, 'loading_end', ls.session_out, 0.95, 'state_machine_loading_end', jsonb_build_object('geofence', tw.loading_terminal, 'stop_state', 'origin_loading_stop'), tw.loading_terminal, 'origin_terminal', 'loading' FROM _trip_windows tw JOIN _loading_sessions ls ON ls.tracker_id = tw.tracker_id AND ls.session_in = tw.window_start WHERE ls.session_out IS NOT NULL;

    -- 6) Compute state-machine context per trip
    CREATE TEMP TABLE _trip_context ON COMMIT DROP AS
    SELECT tw.trip_key, tw.tracker_id, tw.tracker_name, tw.loading_terminal, tw.window_start AS loading_start, ls.session_out AS loading_end, tw.window_end, CASE WHEN tw.window_end = 'infinity'::TIMESTAMPTZ THEN NULL ELSE tw.window_end END AS next_loading_entry, pre.pre_origin_in, pre.pre_origin_name, ox.origin_exit, ox.origin_exit_name, ds.dest_entry, dse.dest_exit, ds.dest_name, dr.dest_region_entry, dre.dest_region_exit, dr.dest_region_name, CASE WHEN ds.dest_entry IS NOT NULL AND dr.dest_region_entry IS NOT NULL THEN LEAST(ds.dest_entry, dr.dest_region_entry) ELSE COALESCE(ds.dest_entry, dr.dest_region_entry) END AS first_destination_signal, ro.return_origin_entry, ro.return_origin_name
    FROM _trip_windows tw LEFT JOIN _loading_sessions ls ON ls.tracker_id = tw.tracker_id AND ls.session_in = tw.window_start
    LEFT JOIN LATERAL (
        WITH pre_origin AS (SELECT ov.*, MAX(ov.visit_end_for_overlap_utc) OVER (ORDER BY ov.visit_start_utc, ov.visit_end_for_overlap_utc ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_out FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state = 'operational_stop' AND ov.visit_start_utc < tw.window_start AND ov.visit_start_utc >= COALESCE(tw.coverage_start, tw.prev_window_start, tw.window_start - INTERVAL '30 days')),
        sessioned AS (SELECT p.*, SUM(CASE WHEN p.prev_max_out IS NULL THEN 1 WHEN p.prev_max_out >= p.visit_start_utc - INTERVAL '6 hours' THEN 0 ELSE 1 END) OVER (ORDER BY p.visit_start_utc, p.visit_end_for_overlap_utc) AS session_group FROM pre_origin p),
        latest_group AS (SELECT s.session_group FROM sessioned s ORDER BY s.visit_start_utc DESC LIMIT 1)
        SELECT s.visit_start_utc AS pre_origin_in, s.geofence_name AS pre_origin_name FROM sessioned s JOIN latest_group lg ON lg.session_group = s.session_group ORDER BY s.visit_start_utc ASC LIMIT 1
    ) pre ON true
    LEFT JOIN LATERAL (SELECT MIN(ov.visit_start_utc) AS first_signal FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.visit_start_utc > ls.session_out AND ov.visit_start_utc < tw.window_end AND ov.stop_state IN ('corridor_transit', 'border_crossing', 'customs_stop', 'destination_stop', 'destination_region_presence')) sig ON true
    LEFT JOIN LATERAL (SELECT ov.visit_end_for_overlap_utc AS origin_exit, ov.geofence_name AS origin_exit_name FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state = 'operational_stop' AND ov.visit_start_utc >= ls.session_out AND ov.visit_start_utc < COALESCE(sig.first_signal, tw.window_end) AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time) ORDER BY ov.visit_end_for_overlap_utc DESC LIMIT 1) ox ON true
    LEFT JOIN LATERAL (SELECT ov.visit_start_utc AS dest_entry, ov.geofence_name AS dest_name FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state = 'destination_stop' AND ov.visit_start_utc > ls.session_out AND ov.visit_start_utc < tw.window_end ORDER BY ov.visit_start_utc ASC LIMIT 1) ds ON true
    LEFT JOIN LATERAL (SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_exit FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state = 'destination_stop' AND ds.dest_entry IS NOT NULL AND ov.visit_start_utc >= ds.dest_entry AND ov.visit_start_utc < tw.window_end AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)) dse ON true
    LEFT JOIN LATERAL (SELECT ov.visit_start_utc AS dest_region_entry, ov.geofence_name AS dest_region_name FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state = 'destination_region_presence' AND ov.visit_start_utc > ls.session_out AND ov.visit_start_utc < tw.window_end ORDER BY ov.visit_start_utc ASC LIMIT 1) dr ON true
    LEFT JOIN LATERAL (SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_region_exit FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state = 'destination_region_presence' AND dr.dest_region_entry IS NOT NULL AND ov.visit_start_utc >= dr.dest_region_entry AND ov.visit_start_utc < tw.window_end AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)) dre ON true
    LEFT JOIN LATERAL (SELECT ov.visit_start_utc AS return_origin_entry, ov.geofence_name AS return_origin_name FROM _ops_visits ov WHERE ov.tracker_id = tw.tracker_id AND ov.stop_state IN ('operational_stop', 'origin_loading_stop') AND ov.visit_start_utc > COALESCE(dse.dest_exit, dre.dest_region_exit, ds.dest_entry, dr.dest_region_entry, ls.session_out) AND ov.visit_start_utc < tw.window_end ORDER BY ov.visit_start_utc ASC LIMIT 1) ro ON true;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'trip_anchor_start', COALESCE(tc.pre_origin_in, tc.loading_start), 0.90, 'state_machine_pre_origin_anchor', jsonb_build_object('geofence', COALESCE(tc.pre_origin_name, tc.loading_terminal)), COALESCE(tc.pre_origin_name, tc.loading_terminal), 'origin_gateway', 'loading' FROM _trip_context tc;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'origin_exit', tc.origin_exit, 0.90, 'state_machine_origin_exit', jsonb_build_object('geofence', tc.origin_exit_name), tc.origin_exit_name, 'origin_gateway', 'loading' FROM _trip_context tc WHERE tc.origin_exit IS NOT NULL;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'corridor_entry', ov.visit_start_utc, 0.80, 'state_machine_corridor', jsonb_build_object('geofence', ov.geofence_name), ov.geofence_name, 'corridor_region', 'transit' FROM _trip_context tc JOIN _ops_visits ov ON ov.tracker_id = tc.tracker_id AND ov.stop_state = 'corridor_transit' AND ov.visit_start_utc > tc.loading_end AND ov.visit_start_utc < COALESCE(tc.first_destination_signal, tc.window_end);

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'destination_entry', tc.dest_entry, 0.92, 'state_machine_destination_entry', jsonb_build_object('geofence', tc.dest_name), tc.dest_name, 'destination_site', 'destination' FROM _trip_context tc WHERE tc.dest_entry IS NOT NULL;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'destination_exit', tc.dest_exit, 0.92, 'state_machine_destination_exit', jsonb_build_object('geofence', tc.dest_name), tc.dest_name, 'destination_site', 'destination' FROM _trip_context tc WHERE tc.dest_exit IS NOT NULL;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'trip_closed', tc.return_origin_entry, 0.90, 'return_to_origin_priority_p75', jsonb_build_object('reason', 'closed_by_return_origin', 'priority', 'P1'), tc.return_origin_name, 'origin_zone', 'returning' FROM _trip_context tc WHERE tc.return_origin_entry IS NOT NULL;

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'trip_closed', tc.window_end, 0.80, 'next_loading_hard_boundary_p75', jsonb_build_object('reason', 'closed_by_next_loading', 'priority', 'P2'), NULL, NULL, 'returning' FROM _trip_context tc WHERE tc.return_origin_entry IS NULL AND tc.window_end < 'infinity'::TIMESTAMPTZ AND EXISTS (SELECT 1 FROM public.trip_state_events e WHERE e.trip_key = tc.trip_key AND e.event_code IN ('destination_entry', 'border_entry', 'corridor_entry', 'origin_exit')) AND NOT EXISTS (SELECT 1 FROM public.trip_state_events e WHERE e.trip_key = tc.trip_key AND e.event_code = 'trip_closed');

    INSERT INTO public.trip_state_events (trip_key, tracker_id, tracker_name, event_code, event_time, event_confidence, inference_rule, event_meta, canonical_name, role_code, trip_stage)
    SELECT tc.trip_key, tc.tracker_id, tc.tracker_name, 'trip_closed', last_ev.last_event_time + INTERVAL '30 days', 0.50, 'timeout_30d_p75', jsonb_build_object('reason', 'closed_by_timeout', 'priority', 'P3'), NULL, NULL, 'returning' FROM _trip_context tc JOIN LATERAL (SELECT MAX(e.event_time) AS last_event_time FROM public.trip_state_events e WHERE e.trip_key = tc.trip_key) last_ev ON true WHERE tc.return_origin_entry IS NULL AND tc.window_end = 'infinity'::TIMESTAMPTZ AND last_ev.last_event_time < NOW() - INTERVAL '30 days' AND NOT EXISTS (SELECT 1 FROM public.trip_state_events e WHERE e.trip_key = tc.trip_key AND e.event_code = 'trip_closed');

    PERFORM set_config('tat.current_rule_version', 'phase76e_v1', true);
    UPDATE public.tat_refactor_runs SET status = 'completed', end_time = clock_timestamp() WHERE run_id = v_run_id;
END;
$function$;


-- 2) Update build_tat_trip_facts_v2
-- We need to fetch it first to ensure we don't break it. 
-- I already have it from earlier turn. I'll just apply the same restriction.
-- Wait, Branch B logic in facts builder also needs this.
