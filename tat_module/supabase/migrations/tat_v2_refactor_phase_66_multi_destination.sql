-- =============================================================
-- TAT V2 REFACTOR: Phase 66
-- Multi-Destination Fact Table — Structural Fix
--
-- Problem:
--   build_trip_state_events_v2 uses LIMIT 1 lateral joins for
--   destination discovery. When a truck visits Lubumbashi THEN
--   Kolwezi, the system labels the entire duration as "Lubumbashi"
--   but uses the final exit time from "Kolwezi", creating massive
--   geographically-inaccurate dwell spikes.
--
-- Fix:
--   1) Remove LIMIT 1 on destination_stop LATERALs in the state
--      machine. Replace with a loop that emits one destination_entry
--      and destination_exit event per distinct geofence visit.
--
--   2) Create new relational table `tat_trip_destination_facts_v2`
--      with one row per sequential destination stop per trip.
--
--   3) Midnight-stitch: if a destination stop spans midnight
--      (exit at 23:59:59), the next-day continuation at the same
--      geofence is merged into a single continuous dwell record.
--
--   4) For backward compatibility, tat_trip_facts_v2 continues to
--      use the FIRST destination as the primary destination_name.
--      The UI shows "+N more" when dest_sequence > 1 exists.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) New Table: tat_trip_destination_facts_v2
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tat_trip_destination_facts_v2 (
    dest_fact_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_key         TEXT        NOT NULL,
    tracker_id       INTEGER     NOT NULL,
    dest_sequence    INTEGER     NOT NULL,          -- 1, 2, 3... in chronological order
    canonical_name   TEXT        NOT NULL,           -- geofence canonical name
    stop_state       TEXT        DEFAULT 'destination_stop',
    entry_time       TIMESTAMPTZ NOT NULL,
    exit_time        TIMESTAMPTZ,                    -- NULL = still present
    dwell_hrs        NUMERIC(10,2),                  -- pre-computed dwell
    is_current       BOOLEAN     DEFAULT FALSE,      -- TRUE if truck is still at this stop
    is_midnight_stitch BOOLEAN   DEFAULT FALSE,      -- TRUE if this record was stitched across midnight
    created_at       TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_dest_facts_v2_trip_key
    ON public.tat_trip_destination_facts_v2 (trip_key);
CREATE INDEX IF NOT EXISTS idx_dest_facts_v2_tracker
    ON public.tat_trip_destination_facts_v2 (tracker_id, entry_time);
CREATE INDEX IF NOT EXISTS idx_dest_facts_v2_trip_seq
    ON public.tat_trip_destination_facts_v2 (trip_key, dest_sequence);
CREATE INDEX IF NOT EXISTS idx_dest_facts_v2_current
    ON public.tat_trip_destination_facts_v2 (is_current) WHERE is_current = TRUE;


-- ─────────────────────────────────────────────────────────────
-- 2) Updated state machine: build_trip_state_events_v2
--    Emits multi-stop destination events
-- ─────────────────────────────────────────────────────────────
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
BEGIN
    SET LOCAL statement_timeout = 0;

    INSERT INTO public.tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_66_MULTI_DEST', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    -- 1) Operational stop-state visit stream
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

    -- 2) Build loading sessions (trip anchors) with fixed session_out guard
    CREATE TEMP TABLE _loading_sessions (
        tracker_id       INTEGER,
        tracker_name     TEXT,
        session_group    BIGINT,
        loading_terminal TEXT,
        session_in       TIMESTAMPTZ,
        session_out      TIMESTAMPTZ
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
            -- Phase 65 fix: check only the MAXIMUM (final) visit_end_utc
            CASE
                WHEN NOT bool_or(s.is_open_geofence)
                     AND MAX(s.visit_end_utc)::time != '23:59:59'::time
                THEN MAX(s.visit_end_for_overlap_utc)
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
      ON tp.tracker_id    = r.tracker_id
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
            LAG(ls.session_in)  OVER (PARTITION BY ls.tracker_id ORDER BY ls.session_in) AS prev_session_in,
            LEAD(ls.session_in) OVER (PARTITION BY ls.tracker_id ORDER BY ls.session_in) AS next_session_in
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

    CREATE INDEX _idx_tw_trip    ON _trip_windows (trip_key);
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
        tw.trip_key, tw.tracker_id, tw.tracker_name,
        'loading_start', tw.window_start,
        0.95, 'state_machine_loading_start',
        jsonb_build_object('geofence', tw.loading_terminal, 'stop_state', 'origin_loading_stop'),
        tw.loading_terminal, 'origin_terminal', 'loading'
    FROM _trip_windows tw;

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tw.trip_key, tw.tracker_id, tw.tracker_name,
        'loading_end', ls.session_out,
        0.95, 'state_machine_loading_end',
        jsonb_build_object('geofence', tw.loading_terminal, 'stop_state', 'origin_loading_stop'),
        tw.loading_terminal, 'origin_terminal', 'loading'
    FROM _trip_windows tw
    JOIN _loading_sessions ls
      ON ls.tracker_id = tw.tracker_id
     AND ls.session_in = tw.window_start;

    -- 6) Trip context: all milestone timestamps per trip
    --    ── PHASE 66 CHANGE: removed LIMIT 1 on dest discovery ──
    --    _trip_context still picks the FIRST destination for backward compat
    --    with the origin_exit / corridor / return logic. The multi-stop
    --    destination events are emitted separately in step 10b.
    CREATE TEMP TABLE _trip_context ON COMMIT DROP AS
    SELECT
        tw.trip_key,
        tw.tracker_id,
        tw.tracker_name,
        tw.loading_terminal,
        tw.window_start AS loading_start,
        ls.session_out  AS loading_end,
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
        -- ── PHASE 66: pick the LAST destination exit for return-origin logic ──
        last_dest.last_dest_exit,
        last_dest.last_dest_name,
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
            SELECT s.session_group FROM sessioned s
            ORDER BY s.visit_start_utc DESC, s.visit_end_for_overlap_utc DESC
            LIMIT 1
        )
        SELECT
            s.visit_start_utc AS pre_origin_in,
            s.geofence_name   AS pre_origin_name
        FROM sessioned s
        JOIN latest_group lg ON lg.session_group = s.session_group
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
                'corridor_transit', 'border_crossing', 'customs_stop',
                'destination_stop', 'destination_region_presence'
          )
    ) sig ON true
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_end_for_overlap_utc AS origin_exit,
            ov.geofence_name             AS origin_exit_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'origin_operational_stop'
          AND ov.visit_start_utc >= ls.session_out
          AND ov.visit_start_utc < COALESCE(sig.first_signal, tw.window_end)
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
        ORDER BY ov.visit_end_for_overlap_utc DESC NULLS LAST, ov.raw_visit_id DESC
        LIMIT 1
    ) ox ON true
    -- ── FIRST destination (backward compat for trip_context) ──
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_start_utc AS dest_entry,
            ov.geofence_name   AS dest_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_stop'
          AND ov.visit_start_utc > ls.session_out
          AND ov.visit_start_utc < tw.window_end
        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC
        LIMIT 1
    ) ds ON true
    -- Exit for the FIRST destination only (backward compat)
    LEFT JOIN LATERAL (
        SELECT MAX(ov.visit_end_for_overlap_utc) AS dest_exit
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_stop'
          AND ds.dest_entry IS NOT NULL
          AND ov.geofence_name = ds.dest_name
          AND ov.visit_start_utc >= ds.dest_entry
          AND ov.visit_start_utc < tw.window_end
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    ) dse ON true
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_start_utc AS dest_region_entry,
            ov.geofence_name   AS dest_region_name
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
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    ) dre ON true
    -- ── PHASE 66: LAST destination exit (for return-origin logic) ──
    LEFT JOIN LATERAL (
        SELECT
            MAX(ov.visit_end_for_overlap_utc) AS last_dest_exit,
            (ARRAY_AGG(ov.geofence_name ORDER BY ov.visit_end_for_overlap_utc DESC NULLS LAST))[1] AS last_dest_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state = 'destination_stop'
          AND ov.visit_start_utc > ls.session_out
          AND ov.visit_start_utc < tw.window_end
          AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    ) last_dest ON true
    -- ── Return origin: now uses LAST destination exit, not first ──
    LEFT JOIN LATERAL (
        SELECT
            ov.visit_start_utc AS return_origin_entry,
            ov.geofence_name   AS return_origin_name
        FROM _ops_visits ov
        WHERE ov.tracker_id = tw.tracker_id
          AND ov.stop_state IN ('origin_operational_stop', 'origin_loading_stop')
          AND ov.visit_start_utc > COALESCE(
                last_dest.last_dest_exit, dre.dest_region_exit,
                ds.dest_entry, dr.dest_region_entry,
                ls.session_out
          )
          AND ov.visit_start_utc < tw.window_end
        ORDER BY ov.visit_start_utc ASC, ov.raw_visit_id ASC
        LIMIT 1
    ) ro ON true;

    CREATE INDEX _idx_tc_trip    ON _trip_context (trip_key);
    CREATE INDEX _idx_tc_tracker ON _trip_context (tracker_id, loading_start);

    -- 7) trip_anchor_start (pre-origin DAR arrival)
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
     AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    CROSS JOIN LATERAL public.resolve_border_code(ov.geofence_name) rb;

    -- ══════════════════════════════════════════════════════════════════
    -- 10) PHASE 66: Multi-stop destination events
    --     Instead of emitting a single destination_entry/exit pair,
    --     we now emit one pair per DISTINCT destination geofence visit.
    --     Each gets a dest_sequence number in event_meta.
    -- ══════════════════════════════════════════════════════════════════

    -- 10a) Build the multi-destination visit stream with sessionization
    --      Groups consecutive visits to the SAME geofence into a single
    --      session (handles midnight splits). Distinct geofences get
    --      separate sessions.
    CREATE TEMP TABLE _dest_sessions ON COMMIT DROP AS
    WITH dest_visits AS (
        SELECT
            ov.raw_visit_id,
            tc.trip_key,
            ov.tracker_id,
            tc.tracker_name,
            ov.geofence_name,
            ov.visit_start_utc,
            ov.visit_end_utc,
            ov.visit_end_for_overlap_utc,
            ov.is_open_geofence,
            tc.window_end
        FROM _trip_context tc
        JOIN _ops_visits ov
          ON ov.tracker_id = tc.tracker_id
         AND ov.stop_state = 'destination_stop'
         AND ov.visit_start_utc > tc.loading_end
         AND ov.visit_start_utc < tc.window_end
    ),
    -- Detect session boundaries: new session when geofence name changes
    -- or when there's a gap > 2 hours between consecutive visits to
    -- the same geofence (allowing midnight continuations to merge).
    ordered AS (
        SELECT
            dv.*,
            LAG(dv.geofence_name) OVER w AS prev_geofence,
            LAG(dv.visit_end_for_overlap_utc) OVER w AS prev_exit,
            LAG(dv.visit_end_utc) OVER w AS prev_exit_raw
        FROM dest_visits dv
        WINDOW w AS (PARTITION BY dv.trip_key ORDER BY dv.visit_start_utc, dv.raw_visit_id)
    ),
    sessioned AS (
        SELECT
            o.*,
            SUM(
                CASE
                    -- First visit in trip: always new session
                    WHEN o.prev_geofence IS NULL THEN 1
                    -- Different geofence: new session
                    WHEN o.geofence_name != o.prev_geofence THEN 1
                    -- Same geofence, previous exit was midnight boundary:
                    -- this is a continuation, NOT a new session
                    WHEN o.prev_exit_raw::time = '23:59:59'::time
                         AND o.visit_start_utc::time < '00:05:00'::time
                    THEN 0
                    -- Same geofence, gap > 6 hours: new session
                    -- (truck left and came back)
                    WHEN EXTRACT(EPOCH FROM (o.visit_start_utc - o.prev_exit)) > 21600
                    THEN 1
                    -- Same geofence, within 6h: continuation
                    ELSE 0
                END
            ) OVER (
                PARTITION BY o.trip_key
                ORDER BY o.visit_start_utc, o.raw_visit_id
            ) AS dest_session
        FROM ordered o
    )
    SELECT
        s.trip_key,
        s.tracker_id,
        s.tracker_name,
        s.dest_session,
        s.geofence_name,
        MIN(s.visit_start_utc)              AS session_entry,
        -- Exit is NULL if the latest visit is open or ends at midnight
        CASE
            WHEN bool_or(s.is_open_geofence) THEN NULL
            WHEN MAX(s.visit_end_utc)::time = '23:59:59'::time THEN NULL
            ELSE MAX(s.visit_end_for_overlap_utc)
        END                                 AS session_exit,
        -- Is this session still "in progress"?
        (bool_or(s.is_open_geofence) OR MAX(s.visit_end_utc)::time = '23:59:59'::time) AS is_current,
        -- Was midnight stitching applied?
        bool_or(s.prev_exit_raw::time = '23:59:59'::time AND s.geofence_name = s.prev_geofence)
            AS is_midnight_stitch,
        s.window_end
    FROM sessioned s
    GROUP BY s.trip_key, s.tracker_id, s.tracker_name, s.dest_session, s.geofence_name, s.window_end;

    CREATE INDEX _idx_ds_trip ON _dest_sessions (trip_key, dest_session);

    -- 10b) Emit destination_entry and destination_exit events for ALL stops
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        ds.trip_key, ds.tracker_id, ds.tracker_name,
        'destination_entry', ds.session_entry,
        0.92, 'state_machine_destination_entry_multi',
        jsonb_build_object(
            'geofence', ds.geofence_name,
            'stop_state', 'destination_stop',
            'dest_sequence', ds.dest_session,
            'is_midnight_stitch', ds.is_midnight_stitch
        ),
        ds.geofence_name, 'destination_site', 'destination'
    FROM _dest_sessions ds;

    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        ds.trip_key, ds.tracker_id, ds.tracker_name,
        'destination_exit', ds.session_exit,
        0.92, 'state_machine_destination_exit_multi',
        jsonb_build_object(
            'geofence', ds.geofence_name,
            'stop_state', 'destination_stop',
            'dest_sequence', ds.dest_session,
            'is_midnight_stitch', ds.is_midnight_stitch
        ),
        ds.geofence_name, 'destination_site', 'destination'
    FROM _dest_sessions ds
    WHERE ds.session_exit IS NOT NULL;

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
     -- PHASE 66: use last_dest_exit instead of first dest_exit for return window
     AND ov.visit_start_utc > COALESCE(tc.last_dest_exit, tc.dest_exit, tc.dest_entry, tc.loading_end)
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
     AND ov.visit_start_utc > COALESCE(tc.last_dest_exit, tc.dest_exit, tc.dest_entry, tc.loading_end)
     AND ov.visit_start_utc < tc.window_end
     AND NOT (ov.is_open_geofence OR ov.visit_end_utc::time = '23:59:59'::time)
    CROSS JOIN LATERAL public.resolve_border_code(ov.geofence_name) rb;

    -- 12) Trip closures — return to origin
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

    -- ══════════════════════════════════════════════════════════════════
    -- 13) PHASE 66: Populate tat_trip_destination_facts_v2
    -- ══════════════════════════════════════════════════════════════════

    -- Delete existing destination facts for rebuilt trips
    DELETE FROM public.tat_trip_destination_facts_v2
    WHERE trip_key IN (SELECT trip_key FROM _trip_windows);

    -- Insert one row per destination session
    INSERT INTO public.tat_trip_destination_facts_v2 (
        trip_key,
        tracker_id,
        dest_sequence,
        canonical_name,
        stop_state,
        entry_time,
        exit_time,
        dwell_hrs,
        is_current,
        is_midnight_stitch
    )
    SELECT
        ds.trip_key,
        ds.tracker_id,
        ds.dest_session,
        ds.geofence_name,
        'destination_stop',
        ds.session_entry,
        ds.session_exit,
        CASE
            WHEN ds.session_exit IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (ds.session_exit - ds.session_entry)) / 3600.0, 2)
            -- For in-progress stops, compute live dwell to NOW()
            WHEN ds.is_current
                THEN ROUND(EXTRACT(EPOCH FROM (NOW() - ds.session_entry)) / 3600.0, 2)
            ELSE NULL
        END,
        ds.is_current,
        ds.is_midnight_stitch
    FROM _dest_sessions ds;

    -- Final run metadata
    PERFORM set_config('tat.current_build_run_id', v_run_id::text, true);
    PERFORM set_config('tat.current_rule_version', 'phase66_v1', true);

    UPDATE public.tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'dest_facts_written', (
                SELECT count(*)
                FROM public.tat_trip_destination_facts_v2
                WHERE trip_key IN (SELECT trip_key FROM _trip_windows)
            ),
            'multi_stop_trips', (
                SELECT count(DISTINCT trip_key)
                FROM public.tat_trip_destination_facts_v2
                WHERE trip_key IN (SELECT trip_key FROM _trip_windows)
                  AND dest_sequence > 1
            )
        )
    WHERE run_id = v_run_id;

END $$;


-- ─────────────────────────────────────────────────────────────
-- 3) RPC: get_trip_destination_facts_v2
--    Returns destination sequence for a given trip_key
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trip_destination_facts_v2(
    p_trip_key TEXT
)
RETURNS TABLE (
    dest_fact_id     UUID,
    trip_key         TEXT,
    tracker_id       INTEGER,
    dest_sequence    INTEGER,
    canonical_name   TEXT,
    stop_state       TEXT,
    entry_time       TIMESTAMPTZ,
    exit_time        TIMESTAMPTZ,
    dwell_hrs        NUMERIC(10,2),
    is_current       BOOLEAN,
    is_midnight_stitch BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        d.dest_fact_id,
        d.trip_key,
        d.tracker_id,
        d.dest_sequence,
        d.canonical_name,
        d.stop_state,
        d.entry_time,
        d.exit_time,
        -- Recompute dwell_hrs live for current stops
        CASE
            WHEN d.is_current THEN
                ROUND(EXTRACT(EPOCH FROM (NOW() - d.entry_time)) / 3600.0, 2)
            ELSE d.dwell_hrs
        END AS dwell_hrs,
        d.is_current,
        d.is_midnight_stitch
    FROM public.tat_trip_destination_facts_v2 d
    WHERE d.trip_key = p_trip_key
    ORDER BY d.dest_sequence ASC;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4) RPC: get_destination_stop_count_v2
--    Returns the count of destination stops per trip_key
--    Used by the primary dashboard for the "+N more" badge
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_destination_stop_count_v2(
    p_trip_keys TEXT[]
)
RETURNS TABLE (
    trip_key        TEXT,
    dest_count      INTEGER,
    first_dest_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        d.trip_key,
        COUNT(*)::INTEGER AS dest_count,
        (ARRAY_AGG(d.canonical_name ORDER BY d.dest_sequence ASC))[1] AS first_dest_name
    FROM public.tat_trip_destination_facts_v2 d
    WHERE d.trip_key = ANY(p_trip_keys)
    GROUP BY d.trip_key;
$$;


-- ─────────────────────────────────────────────────────────────
-- 5) RPC: get_destination_intelligence_v2
--    Aggregated destination analysis — replaces single-card view
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_destination_intelligence_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS TABLE (
    canonical_name   TEXT,
    total_visits     BIGINT,
    distinct_trips   BIGINT,
    distinct_trucks  BIGINT,
    avg_dwell_hrs    NUMERIC(10,2),
    max_dwell_hrs    NUMERIC(10,2),
    min_dwell_hrs    NUMERIC(10,2),
    pct_multi_stop   NUMERIC(5,2),
    currently_at     BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH dest_window AS (
        SELECT d.*
        FROM public.tat_trip_destination_facts_v2 d
        WHERE d.entry_time >= p_start_date
          AND d.entry_time <  p_end_date
    ),
    multi_trip AS (
        SELECT trip_key
        FROM dest_window
        GROUP BY trip_key
        HAVING COUNT(*) > 1
    )
    SELECT
        dw.canonical_name,
        COUNT(*)                                          AS total_visits,
        COUNT(DISTINCT dw.trip_key)                       AS distinct_trips,
        COUNT(DISTINCT dw.tracker_id)                     AS distinct_trucks,
        ROUND(AVG(dw.dwell_hrs), 2)                       AS avg_dwell_hrs,
        ROUND(MAX(dw.dwell_hrs), 2)                       AS max_dwell_hrs,
        ROUND(MIN(dw.dwell_hrs), 2)                       AS min_dwell_hrs,
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE mt.trip_key IS NOT NULL) / NULLIF(COUNT(*), 0),
            2
        )                                                 AS pct_multi_stop,
        COUNT(*) FILTER (WHERE dw.is_current)             AS currently_at
    FROM dest_window dw
    LEFT JOIN multi_trip mt ON mt.trip_key = dw.trip_key
    GROUP BY dw.canonical_name
    ORDER BY COUNT(*) DESC;
$$;
