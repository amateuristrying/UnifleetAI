-- =============================================================
-- TAT V2 REFACTOR: Phase 3 FIX — Explicit Trip Event Ledger
-- Replaces: tat_v2_refactor_phase_3.sql
-- Dependency: tat_v2_refactor_tables.sql, tat_v2_refactor_tables_patch.sql
--
-- Changes vs previous phase_3_fix:
--   [PARITY 1A] loading_start priority ladder — winning role MIN entry
--   [PARITY 1B] dar_arrival eligible roles: ops_yard/origin_region/origin_gateway only
--   [PARITY 1C] origin_exit eligible roles: origin_region/origin_gateway only
--   [BORDER]    All INSERTs now populate typed border columns:
--               canonical_name, role_code, trip_stage, leg_direction,
--               border_code, border_family, country_code, source_visit_id
--   [NEW]       destination_region_entry/exit (Tier 2 destination proof)
-- =============================================================
--   Previously session_in = MIN(in_time) across ALL origin roles.
--   Now: winning role is selected by priority (origin_terminal >
--   origin_zone), then session_in is
--   MIN(in_time) of THAT role only within the session.
--   loading_terminal is set from the winning role's canonical_name.
--
-- [PARITY 1B] dar_arrival / origin_arrival — FIXED
--   Previously included origin_terminal and origin_zone in the
--   pre-loading anchor search (which could bleed the loading
--   terminal itself into dar_arrival).
--   Now: only ops_yard, origin_region, origin_gateway are eligible
--   for trip_anchor_start (dar_arrival). origin_terminal and
--   origin_zone are the loading phase itself, not the pre-loading
--   arrival.
--
-- [PARITY 1C] dar_exit / origin_exit — FIXED
--   Previously searched origin_terminal, origin_zone, ops_yard,
--   origin_gateway for the last exit after loading_end.
--   Now: only origin_region and origin_gateway are eligible.
--   These represent the BROAD origin catchment area, not the
--   loading terminal itself. This matches v1's dar_exit semantics.
--
-- [BORDER] Typed columns — NEW
--   All INSERTs now populate: canonical_name, role_code,
--   trip_stage, leg_direction, border_code, border_family,
--   country_code, source_visit_id.
--
-- [BORDER] Named border events — PRESERVED
--   border_entry/border_exit carry border_code so each individual
--   border crossing is identifiable without parsing event_meta.
--   return_border_entry/return_border_exit same.
-- =============================================================

CREATE OR REPLACE FUNCTION build_trip_state_events_v2(
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run_id UUID;
BEGIN
    SET LOCAL statement_timeout = 0;

    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES (
        'PHASE_3_EVENTS_V2', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    -- ── 1. Coalesce loading sessions (cross-geofence, 6h gap) ───────────────
    -- PARITY 1A FIX: session_in is now the earliest entry of the WINNING role
    -- (highest priority role present in the session), not the global session
    -- minimum. This matches v1 loading_start selection exactly.
    CREATE TEMP TABLE _coalesced_anchors (
        tracker_id               INTEGER,
        canonical_name           TEXT,
        role_code                TEXT,
        normalization_confidence NUMERIC(3,2),
        session_in               TIMESTAMPTZ,   -- earliest entry of winning role
        session_out              TIMESTAMPTZ    -- latest exit across ALL roles in session
    ) ON COMMIT DROP;

    INSERT INTO _coalesced_anchors
    WITH ordered_visits AS (
        -- Use previous running MAX(out_time), not simple LAG(out_time).
        -- This prevents false session splits when long "midnight-split" rows
        -- overlap shorter rows that start later but end earlier.
        SELECT
            n.*,
            MAX(n.out_time) OVER (
                PARTITION BY n.tracker_id
                ORDER BY n.in_time, n.out_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS prev_max_out
        FROM trip_geofence_events_normalized n
        WHERE n.role_code IN ('origin_terminal','origin_zone')
          -- Include a small lookback for session stitching at chunk start,
          -- and a long lookahead so next-loading window_end is visible even
          -- when the next trip starts in a later chunk.
          AND n.in_time >= p_start - INTERVAL '1 day'
          AND n.in_time  < p_end   + INTERVAL '365 days'
          AND (p_tracker_id IS NULL OR n.tracker_id = p_tracker_id)
    ),
    origin_visits AS (
        SELECT
            ov.*,
            CASE
                WHEN ov.prev_max_out IS NULL THEN 1
                WHEN ov.prev_max_out >= ov.in_time - INTERVAL '6 hours' THEN 0
                ELSE 1
            END AS is_new_session
        FROM ordered_visits ov
    ),
    sessioned AS (
        SELECT *,
               SUM(is_new_session) OVER (
                   PARTITION BY tracker_id
                   ORDER BY in_time, out_time
               ) AS session_group
        FROM origin_visits
    ),
    -- Pick the highest-priority role for each session.
    winning_role AS (
        SELECT DISTINCT ON (tracker_id, session_group)
            tracker_id,
            session_group,
            role_code,
            canonical_name,
            normalization_confidence,
            priority
        FROM sessioned
        ORDER BY tracker_id, session_group, priority DESC NULLS LAST
    )
    -- PARITY 1A: session_in = MIN(in_time) of the WINNING role in this session.
    -- session_out = MAX(out_time) across ALL origin-side visits in session.
    SELECT
        wr.tracker_id,
        wr.canonical_name,
        wr.role_code,
        wr.normalization_confidence,
        MIN(s.in_time)  FILTER (WHERE s.role_code = wr.role_code) AS session_in,
        MAX(s.out_time)                                            AS session_out
    FROM winning_role wr
    JOIN sessioned s USING (tracker_id, session_group)
    GROUP BY wr.tracker_id, wr.canonical_name, wr.role_code,
             wr.normalization_confidence, wr.session_group;

    CREATE INDEX _idx_ca_tracker ON _coalesced_anchors (tracker_id, session_in);

    -- ── 2. Build active trip windows from coalesced anchors ─────────────────
    -- Window ownership is keyed by trip_key (loading_start anchor), not by
    -- event_time, so re-runs can safely rebuild whole trips across chunk
    -- boundaries without deleting milestones of adjacent chunks.
    CREATE TEMP TABLE _trip_windows (
        trip_key     TEXT,
        tracker_id   INTEGER,
        window_start TIMESTAMPTZ,
        window_end   TIMESTAMPTZ
    ) ON COMMIT DROP;

    INSERT INTO _trip_windows
    WITH loading_anchors AS (
        SELECT
            tracker_id::TEXT || ':' || EXTRACT(EPOCH FROM session_in)::BIGINT::TEXT AS trip_key,
            tracker_id,
            session_in
        FROM _coalesced_anchors
        WHERE role_code IN ('origin_terminal', 'origin_zone')
    ),
    sequenced AS (
        SELECT
            la.*,
            LEAD(la.session_in) OVER (
                PARTITION BY la.tracker_id
                ORDER BY la.session_in
            ) AS next_session_in
        FROM loading_anchors la
    )
    SELECT
        s.trip_key,
        s.tracker_id,
        s.session_in AS window_start,
        COALESCE(s.next_session_in, 'infinity'::TIMESTAMPTZ) AS window_end
    FROM sequenced s
    WHERE s.session_in >= p_start
      AND s.session_in <  p_end;

    CREATE INDEX _idx_tw_trip    ON _trip_windows (trip_key);
    CREATE INDEX _idx_tw_tracker ON _trip_windows (tracker_id, window_start);

    -- ── 3. Cleanup existing events for active trip keys ─────────────────────
    -- Rebuild is trip_key-scoped for idempotency and cross-chunk safety.
    DELETE FROM trip_state_events
    WHERE trip_key IN (SELECT trip_key FROM _trip_windows);

    -- Also remove stale alternate trip_keys caused by anchor drift after logic
    -- changes (e.g. loading_start shifted by minutes/days, producing a new
    -- tracker:epoch key while old keys remain). We mark an existing key stale
    -- when its loading interval overlaps the rebuilt trip window for the same
    -- tracker and the key is not one of the current anchors.
    CREATE TEMP TABLE _stale_trip_keys (
        trip_key TEXT PRIMARY KEY
    ) ON COMMIT DROP;

    INSERT INTO _stale_trip_keys (trip_key)
    WITH existing_loading AS (
        SELECT
            ls.trip_key,
            ls.tracker_id,
            ls.event_time AS loading_start_time,
            le.event_time AS loading_end_time
        FROM trip_state_events ls
        LEFT JOIN LATERAL (
            SELECT MAX(event_time) AS event_time
            FROM trip_state_events x
            WHERE x.trip_key = ls.trip_key
              AND x.event_code = 'loading_end'
        ) le ON true
        WHERE ls.event_code = 'loading_start'
    )
    SELECT DISTINCT el.trip_key
    FROM existing_loading el
    JOIN _trip_windows tw
      ON tw.tracker_id = el.tracker_id
    WHERE el.trip_key <> tw.trip_key
      AND (
          -- Case A: Existing loading interval overlaps rebuilt window.
          (
              COALESCE(el.loading_end_time, el.loading_start_time) >= tw.window_start
              AND el.loading_start_time < CASE
                                              WHEN tw.window_end = 'infinity'::TIMESTAMPTZ
                                                  THEN p_end
                                              ELSE tw.window_end
                                          END
          )
          OR
          -- Case B: Legacy false-split fragment that closes exactly when the
          -- rebuilt loading_start begins (closed_by_next_loading), but has no
          -- true onward trip evidence (no corridor/border/customs/destination).
          (
              el.loading_start_time < tw.window_start
              AND EXISTS (
                  SELECT 1
                  FROM trip_state_events tc
                  WHERE tc.trip_key = el.trip_key
                    AND tc.event_code = 'trip_closed'
                    AND ABS(EXTRACT(EPOCH FROM (tc.event_time - tw.window_start))) <= 60
                    AND COALESCE(tc.event_meta->>'reason', '') = 'closed_by_next_loading'
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM trip_state_events sig
                  WHERE sig.trip_key = el.trip_key
                    AND sig.event_code IN (
                        'corridor_entry',
                        'border_entry', 'border_exit',
                        'customs_entry', 'customs_exit',
                        'destination_entry', 'destination_exit',
                        'destination_region_entry', 'destination_region_exit',
                        'customer_entry', 'customer_exit'
                    )
              )
          )
      )
      -- Guardrail: do not remove very old unrelated keys.
      AND el.loading_start_time >= tw.window_start - INTERVAL '45 days';

    DELETE FROM trip_state_events
    WHERE trip_key IN (SELECT trip_key FROM _stale_trip_keys);

    -- ── 4. Anchor events: loading_start + loading_end ──────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tracker_id::TEXT || ':' || EXTRACT(EPOCH FROM session_in)::BIGINT::TEXT,
        tracker_id,
        'loading_start',
        session_in,
        normalization_confidence,
        'terminal_entry_coalesced',
        jsonb_build_object('geofence', canonical_name, 'role', role_code),
        canonical_name, role_code, 'loading'
    FROM _coalesced_anchors
    -- ASAS Base (ops_yard) and origin_gateway are NEVER loading points.
    -- Only specific terminals and loading zones generate loading_start events.
    WHERE role_code IN ('origin_terminal', 'origin_zone');

    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    SELECT
        tracker_id::TEXT || ':' || EXTRACT(EPOCH FROM session_in)::BIGINT::TEXT,
        tracker_id,
        'loading_end',
        session_out,
        normalization_confidence,
        'terminal_exit_coalesced',
        jsonb_build_object('geofence', canonical_name, 'role', role_code),
        canonical_name, role_code, 'loading'
    FROM _coalesced_anchors
    WHERE role_code IN ('origin_terminal', 'origin_zone');

    -- ── 5. trip_anchor_start (dar_arrival) ─────────────────────────────────
    -- PARITY 1B FIX: default eligible roles are ops_yard, origin_region,
    -- origin_gateway (plus ASAS origin_base).
    -- origin_terminal and origin_zone are the loading phase itself and must
    -- NOT be used as origin-arrival anchors, except Tanga special-case:
    --   TANGA PARKING (preferred) -> fallback TANGA ZONE.
    --
    -- Additional fix:
    --   Do NOT scan from previous loading_start only (can pull very old daily
    --   origin rows). Instead:
    --   1) Start from max(previous_destination_out, previous_loading_start)
    --   2) Build origin sessions using running MAX(out_time) with 6h gap
    --   3) Pick earliest event of the most recent session before loading_start
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key,
        tw.tracker_id,
        'trip_anchor_start',
        a.in_time,
        a.normalization_confidence,
        'pre_loading_origin_arrival',
        jsonb_build_object('geofence', a.canonical_name, 'role', a.role_code),
        a.canonical_name, a.role_code, 'loading', a.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        WITH bounds AS (
            SELECT COALESCE(
                (SELECT prev.window_start
                 FROM _trip_windows prev
                 WHERE prev.tracker_id   = tw.tracker_id
                   AND prev.window_start < tw.window_start
                 ORDER BY prev.window_start DESC
                 LIMIT 1),
                '-infinity'::TIMESTAMPTZ
            ) AS prev_window_start
        ),
        cutoff AS (
            SELECT
                b.prev_window_start,
                COALESCE(
                    (
                        SELECT MAX(d.out_time)
                        FROM trip_geofence_events_normalized d
                        WHERE d.tracker_id = tw.tracker_id
                          AND d.in_time   >= b.prev_window_start
                          AND d.in_time    < tw.window_start
                          AND d.trip_stage = 'at_destination'
                    ),
                    b.prev_window_start
                ) AS lower_bound
            FROM bounds b
        ),
        pre_origin AS (
            SELECT
                n.event_id,
                n.in_time,
                n.out_time,
                n.normalization_confidence,
                n.canonical_name,
                n.role_code
            FROM trip_geofence_events_normalized n
            CROSS JOIN cutoff c
            WHERE n.tracker_id = tw.tracker_id
              AND n.in_time    < tw.window_start
              AND n.in_time   >= c.lower_bound
              AND (
                    n.role_code IN ('ops_yard','origin_region','origin_gateway','origin_base')
                    OR (
                        n.role_code = 'origin_zone'
                        AND n.canonical_name IN ('TANGA PARKING', 'TANGA ZONE')
                    )
                  )
        ),
        ordered AS (
            SELECT
                p.*,
                MAX(p.out_time) OVER (
                    ORDER BY p.in_time, p.out_time
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ) AS prev_max_out
            FROM pre_origin p
        ),
        sessioned AS (
            SELECT
                o.*,
                SUM(
                    CASE
                        WHEN o.prev_max_out IS NULL THEN 1
                        WHEN o.prev_max_out >= o.in_time - INTERVAL '6 hours' THEN 0
                        ELSE 1
                    END
                ) OVER (
                    ORDER BY o.in_time, o.out_time
                ) AS session_group
            FROM ordered o
        ),
        latest_session AS (
            SELECT s.session_group
            FROM sessioned s
            ORDER BY s.in_time DESC, s.out_time DESC
            LIMIT 1
        )
        SELECT
            s.in_time,
            s.normalization_confidence,
            s.canonical_name,
            s.role_code,
            s.event_id
        FROM sessioned s
        JOIN latest_session ls
          ON ls.session_group = s.session_group
        ORDER BY
            CASE
                WHEN s.canonical_name = 'TANGA PARKING' THEN 0
                WHEN s.canonical_name = 'TANGA ZONE'    THEN 1
                ELSE 2
            END,
            s.in_time ASC, s.out_time ASC
        LIMIT 1
    ) a ON true;

    -- ── 6. origin_exit (dar_exit) ───────────────────────────────────────────
    -- PARITY 1C FIX: eligible roles are origin_region and origin_gateway only.
    -- These represent the broad origin catchment area.
    -- origin_terminal and origin_zone represent the loading facility itself
    -- and must NOT be used as origin_exit.
    -- Downstream signals that cap the search are enumerated explicitly.
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key,
        tw.tracker_id,
        'origin_exit',
        ox.out_time,
        ox.normalization_confidence,
        'origin_region_last_exit',
        jsonb_build_object('geofence', ox.canonical_name, 'role', ox.role_code),
        ox.canonical_name, ox.role_code, 'loading', ox.event_id
    FROM _trip_windows tw
    JOIN trip_state_events le
          ON le.trip_key   = tw.trip_key
         AND le.event_code = 'loading_end'
    JOIN LATERAL (
        SELECT n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time   >= le.event_time
          AND n.in_time    < tw.window_end
          AND n.out_time IS NOT NULL
          -- PARITY 1C: broad origin catchment roles only
          AND n.role_code IN ('origin_region','origin_gateway')
          -- Stop before first downstream transit/destination signal
          AND n.in_time < COALESCE(
              (SELECT MIN(n2.in_time)
               FROM trip_geofence_events_normalized n2
               WHERE n2.tracker_id = tw.tracker_id
                 AND n2.in_time    > le.event_time
                 AND n2.in_time    < tw.window_end
                 AND n2.role_code IN (
                     'border_tz','border_zm','border_drc','border_other',
                     'corridor_checkpoint','corridor_region',
                     'customs_site',
                     'destination_region','destination_site',
                     'customer_site','local_delivery_site','lpg_site'
                 )
              ),
              tw.window_end
          )
        ORDER BY n.out_time DESC NULLS LAST
        LIMIT 1
    ) ox ON true;

    -- ── 7. corridor_entry (transit checkpoints / corridor regions) ──────────
    -- Corridor signals are explicit so has_corridor_event can preserve v1
    -- long-haul classification semantics (not border-only).
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key,
        tw.tracker_id,
        'corridor_entry',
        n.in_time,
        n.normalization_confidence,
        'corridor_pass_through',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code),
        n.canonical_name,
        n.role_code,
        'transit',
        n.event_id
    FROM _trip_windows tw
    JOIN trip_state_events le
          ON le.trip_key   = tw.trip_key
         AND le.event_code = 'loading_end'
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > le.event_time
         AND n.in_time    < COALESCE(
                 (
                     SELECT MIN(n2.in_time)
                     FROM trip_geofence_events_normalized n2
                     WHERE n2.tracker_id = tw.tracker_id
                       AND n2.in_time    > le.event_time
                       AND n2.in_time    < tw.window_end
                       AND n2.trip_stage = 'at_destination'
                 ),
                 tw.window_end
             )
         AND n.role_code IN ('corridor_checkpoint', 'corridor_region');

    -- ── 8. destination_entry ─────────────────────────────────────────────────
    -- Tier 1 (destination_site, customer_site) takes priority over Tier 2
    -- (destination_region). LIMIT 1 after ORDER BY priority DESC.
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'destination_entry',
        d.in_time, d.normalization_confidence, 'first_dest_after_load',
        jsonb_build_object('geofence', d.canonical_name, 'role', d.role_code),
        d.canonical_name, d.role_code, 'destination', d.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT n.in_time, n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.priority, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > tw.window_start
          AND n.in_time    < tw.window_end
          AND n.trip_stage = 'at_destination'
        ORDER BY n.priority DESC, n.in_time ASC
        LIMIT 1
    ) d ON true;

    -- ── 8. destination_exit ──────────────────────────────────────────────────
    -- ORDER BY out_time DESC (not in_time ASC) so that overnight stays at the
    -- destination spanning midnight get the real departure time (last daily
    -- record's out_time) rather than the Day 1 truncation at 23:59:59.
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'destination_exit',
        d.out_time, d.normalization_confidence, 'dest_exit_time',
        jsonb_build_object('geofence', d.canonical_name, 'role', d.role_code),
        d.canonical_name, d.role_code, 'destination', d.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT n.in_time, n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.priority, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > tw.window_start
          AND n.in_time    < tw.window_end
          AND n.out_time IS NOT NULL
          AND n.trip_stage = 'at_destination'
        ORDER BY n.priority DESC, n.out_time DESC NULLS LAST
        LIMIT 1
    ) d ON true;

    -- ── 9. customer_entry + customer_exit ────────────────────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'customer_entry',
        c.in_time, c.normalization_confidence, 'customer_site_entry',
        jsonb_build_object('geofence', c.canonical_name, 'role', c.role_code),
        c.canonical_name, c.role_code, 'destination', c.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT n.in_time, n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > tw.window_start
          AND n.in_time    < tw.window_end
          AND n.role_code  = 'customer_site'
        ORDER BY n.priority DESC, n.in_time ASC
        LIMIT 1
    ) c ON true;

    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'customer_exit',
        c.out_time, c.normalization_confidence, 'customer_site_exit',
        jsonb_build_object('geofence', c.canonical_name, 'role', c.role_code),
        c.canonical_name, c.role_code, 'destination', c.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT n.in_time, n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > tw.window_start
          AND n.in_time    < tw.window_end
          AND n.out_time IS NOT NULL
          AND n.role_code  = 'customer_site'
        ORDER BY n.priority DESC, n.out_time DESC NULLS LAST
        LIMIT 1
    ) c ON true;

    -- ── 10. destination_region_entry / destination_region_exit ───────────────
    -- Tier 2 destination proof — stored separately, not merged with Tier 1.
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'destination_region_entry',
        r.in_time, r.normalization_confidence * 0.85, 'dest_region_entry',
        jsonb_build_object('geofence', r.canonical_name, 'role', r.role_code),
        r.canonical_name, r.role_code, 'transit', r.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT n.in_time, n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > tw.window_start
          AND n.in_time    < tw.window_end
          AND n.role_code  = 'destination_region'
        ORDER BY n.in_time ASC
        LIMIT 1
    ) r ON true;

    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, source_visit_id
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'destination_region_exit',
        r.out_time, r.normalization_confidence * 0.85, 'dest_region_exit',
        jsonb_build_object('geofence', r.canonical_name, 'role', r.role_code),
        r.canonical_name, r.role_code, 'transit', r.event_id
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT n.in_time, n.out_time, n.normalization_confidence,
               n.canonical_name, n.role_code, n.event_id
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > tw.window_start
          AND n.in_time    < tw.window_end
          AND n.out_time IS NOT NULL
          AND n.role_code  = 'destination_region'
        ORDER BY n.out_time DESC NULLS LAST
        LIMIT 1
    ) r ON true;

    -- ── 11. Outbound border events ───────────────────────────────────────────
    -- All border visits between loading_end and destination_entry.
    -- Each individual border crossing is its own row, with border_code
    -- populated so identity is queryable without JSON parsing.
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage,
        leg_direction, border_code, border_family, country_code,
        source_visit_id
    )
    WITH dest_entry_times AS (
        SELECT trip_key, MIN(event_time) AS dest_entry_time
        FROM trip_state_events
        WHERE event_code = 'destination_entry'
          AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'border_entry',
        n.in_time, n.normalization_confidence, 'transit_border_entry',
        jsonb_build_object(
            'geofence',    n.canonical_name,
            'role',        n.role_code,
            'border_code', CASE
                WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma'
                WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'nakonde'
                WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
                WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
                WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
                WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
                WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
                ELSE 'other'
            END
        ),
        n.canonical_name, n.role_code, 'transit',
        'outbound',
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'TZ'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'ZM'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'DRC'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'TZ'
            ELSE NULL
        END,
        n.event_id
    FROM _trip_windows tw
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > tw.window_start
         AND n.in_time    < COALESCE(
                 (SELECT dt.dest_entry_time FROM dest_entry_times dt WHERE dt.trip_key = tw.trip_key),
                 tw.window_end
             )
         AND n.role_code IN ('border_tz','border_zm','border_drc','border_other');

    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage,
        leg_direction, border_code, border_family, country_code,
        source_visit_id
    )
    WITH dest_entry_times AS (
        SELECT trip_key, MIN(event_time) AS dest_entry_time
        FROM trip_state_events
        WHERE event_code = 'destination_entry'
          AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'border_exit',
        n.out_time, n.normalization_confidence, 'transit_border_exit',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code),
        n.canonical_name, n.role_code, 'transit',
        'outbound',
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'TZ'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'ZM'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'DRC'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'TZ'
            ELSE NULL
        END,
        n.event_id
    FROM _trip_windows tw
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > tw.window_start
         AND n.in_time    < COALESCE(
                 (SELECT dt.dest_entry_time FROM dest_entry_times dt WHERE dt.trip_key = tw.trip_key),
                 tw.window_end
             )
         AND n.role_code IN ('border_tz','border_zm','border_drc','border_other');

    -- ── 12. Customs events (outbound: before destination) ────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction, source_visit_id
    )
    WITH dest_entry_times AS (
        SELECT trip_key, MIN(event_time) AS dest_entry_time
        FROM trip_state_events
        WHERE event_code = 'destination_entry' AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'customs_entry',
        n.in_time, n.normalization_confidence, 'customs_site_entry',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code),
        n.canonical_name, n.role_code, 'transit', 'outbound', n.event_id
    FROM _trip_windows tw
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > tw.window_start
         AND n.in_time    < COALESCE(
                 (SELECT dt.dest_entry_time FROM dest_entry_times dt WHERE dt.trip_key = tw.trip_key),
                 tw.window_end
             )
         AND n.role_code  = 'customs_site';

    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage, leg_direction, source_visit_id
    )
    WITH dest_entry_times AS (
        SELECT trip_key, MIN(event_time) AS dest_entry_time
        FROM trip_state_events
        WHERE event_code = 'destination_entry' AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'customs_exit',
        n.out_time, n.normalization_confidence, 'customs_site_exit',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code),
        n.canonical_name, n.role_code, 'transit', 'outbound', n.event_id
    FROM _trip_windows tw
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > tw.window_start
         AND n.in_time    < COALESCE(
                 (SELECT dt.dest_entry_time FROM dest_entry_times dt WHERE dt.trip_key = tw.trip_key),
                 tw.window_end
             )
         AND n.role_code  = 'customs_site';

    -- ── 13. Return border events (after destination_exit) ────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage,
        leg_direction, border_code, border_family, country_code,
        source_visit_id
    )
    WITH dest_exit_times AS (
        SELECT trip_key, MAX(event_time) AS dest_exit_time
        FROM trip_state_events
        WHERE event_code = 'destination_exit' AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'return_border_entry',
        n.in_time, n.normalization_confidence, 'return_border_entry',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code),
        n.canonical_name, n.role_code, 'returning',
        'return',
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'TZ'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'ZM'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'DRC'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'TZ'
            ELSE NULL
        END,
        n.event_id
    FROM _trip_windows tw
    JOIN dest_exit_times det ON det.trip_key = tw.trip_key
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > det.dest_exit_time
         AND n.in_time    < tw.window_end
         AND n.role_code IN ('border_tz','border_zm','border_drc','border_other');

    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage,
        leg_direction, border_code, border_family, country_code,
        source_visit_id
    )
    WITH dest_exit_times AS (
        SELECT trip_key, MAX(event_time) AS dest_exit_time
        FROM trip_state_events
        WHERE event_code = 'destination_exit' AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'return_border_exit',
        n.out_time, n.normalization_confidence, 'return_border_exit',
        jsonb_build_object('geofence', n.canonical_name, 'role', n.role_code),
        n.canonical_name, n.role_code, 'returning',
        'return',
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'tunduma_nakonde'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'sakania'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'mokambo'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'chembe'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'kasumulu'
            ELSE 'other'
        END,
        CASE
            WHEN n.canonical_name ILIKE '%tunduma%'     THEN 'TZ'
            WHEN n.canonical_name ILIKE '%nakonde%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumbalesa%' THEN 'ZM'
            WHEN n.canonical_name ILIKE '%sakania%'     THEN 'DRC'
            WHEN n.canonical_name ILIKE '%mokambo%'     THEN 'ZM'
            WHEN n.canonical_name ILIKE '%chembe%'      THEN 'ZM'
            WHEN n.canonical_name ILIKE '%kasumulu%'    THEN 'TZ'
            ELSE NULL
        END,
        n.event_id
    FROM _trip_windows tw
    JOIN dest_exit_times det ON det.trip_key = tw.trip_key
    JOIN trip_geofence_events_normalized n
          ON n.tracker_id = tw.tracker_id
         AND n.in_time    > det.dest_exit_time
         AND n.in_time    < tw.window_end
         AND n.role_code IN ('border_tz','border_zm','border_drc','border_other');

    -- ── 14. Closure: closed_by_return_origin ────────────────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )
    WITH dest_exit_times AS (
        SELECT trip_key, MAX(event_time) AS dest_exit_time
        FROM trip_state_events
        WHERE event_code = 'destination_exit' AND event_time >= p_start
        GROUP BY trip_key
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'trip_closed',
        r.in_time, 0.90, 'return_to_origin',
        jsonb_build_object('geofence', r.canonical_name, 'reason', 'closed_by_return_origin'),
        r.canonical_name, r.role_code, 'returning'
    FROM _trip_windows tw
    JOIN dest_exit_times det ON det.trip_key = tw.trip_key
    JOIN LATERAL (
        SELECT n.in_time, n.canonical_name, n.role_code
        FROM trip_geofence_events_normalized n
        WHERE n.tracker_id = tw.tracker_id
          AND n.in_time    > det.dest_exit_time
          AND n.in_time    < tw.window_end
          AND n.role_code IN ('origin_zone','origin_gateway')
        ORDER BY n.in_time ASC
        LIMIT 1
    ) r ON true
    WHERE NOT EXISTS (
        SELECT 1 FROM trip_state_events e
        WHERE e.trip_key = tw.trip_key AND e.event_code = 'trip_closed'
    );

    -- ── 15. Closure: closed_by_next_loading ─────────────────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        trip_stage
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'trip_closed',
        tw.window_end, 0.80, 'next_loading_started',
        jsonb_build_object('reason', 'closed_by_next_loading'),
        'returning'
    FROM _trip_windows tw
    WHERE tw.window_end < 'infinity'::TIMESTAMPTZ
      AND NOT EXISTS (
          SELECT 1 FROM trip_state_events e
          WHERE e.trip_key = tw.trip_key AND e.event_code = 'trip_closed'
      )
      AND EXISTS (
          SELECT 1 FROM trip_state_events e
          WHERE e.trip_key   = tw.trip_key
            AND e.event_code IN ('destination_entry','border_entry','origin_exit')
      );

    -- ── 16. Closure: closed_by_timeout ──────────────────────────────────────
    INSERT INTO trip_state_events (
        trip_key, tracker_id,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        trip_stage
    )
    SELECT
        tw.trip_key, tw.tracker_id, 'trip_closed',
        last_ev.last_event_time + INTERVAL '30 days', 0.50, 'timeout_30d',
        jsonb_build_object('reason', 'closed_by_timeout'),
        'returning'
    FROM _trip_windows tw
    JOIN LATERAL (
        SELECT MAX(event_time) AS last_event_time
        FROM trip_state_events e
        WHERE e.trip_key = tw.trip_key
    ) last_ev ON true
    WHERE tw.window_end = 'infinity'::TIMESTAMPTZ
      AND last_ev.last_event_time < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
          SELECT 1 FROM trip_state_events e
          WHERE e.trip_key = tw.trip_key AND e.event_code = 'trip_closed'
      );

    -- ── 17. trip_sequence ─────────────────────────────────────────────────────
    -- trip_sequence is a global ordinal (all-time RANK per tracker).
    -- Computing it here requires scanning ALL loading_start events for all
    -- trackers — too expensive for a per-chunk call under Management API timeouts.
    -- Run backfill_trip_sequence_v2() once after all Phase 3 chunks complete.

    -- ── 18. Data quality: missing destination ───────────────────────────────
    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, trip_key, issue_type, severity, description
    )
    SELECT
        v_run_id, tw.tracker_id, tw.trip_key,
        'missing_destination', 'medium',
        'Trip has no destination_entry event'
    FROM _trip_windows tw
    WHERE NOT EXISTS (
        SELECT 1 FROM trip_state_events e
        WHERE e.trip_key = tw.trip_key AND e.event_code = 'destination_entry'
    )
      AND NOT EXISTS (
          SELECT 1
          FROM tat_data_quality_issues dq
          WHERE dq.run_id      = v_run_id
            AND dq.issue_type  = 'missing_destination'
            AND dq.tracker_id  = tw.tracker_id
            AND dq.trip_key    = tw.trip_key
            AND dq.description = 'Trip has no destination_entry event'
      )
    ON CONFLICT DO NOTHING;

    -- ── Cleanup ─────────────────────────────────────────────────────────────
    DROP TABLE IF EXISTS _coalesced_anchors;
    DROP TABLE IF EXISTS _trip_windows;

    UPDATE tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'trips_anchored', (
                SELECT count(DISTINCT trip_key) FROM trip_state_events
                WHERE event_code = 'loading_start'
                  AND event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'total_events', (
                SELECT count(*) FROM trip_state_events
                WHERE event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'border_events', (
                SELECT count(*) FROM trip_state_events
                WHERE event_code IN ('border_entry','border_exit',
                                     'return_border_entry','return_border_exit')
                  AND event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'closed_trips', (
                SELECT count(DISTINCT trip_key) FROM trip_state_events
                WHERE event_code = 'trip_closed'
                  AND event_time >= p_start AND event_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            )
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    DROP TABLE IF EXISTS _coalesced_anchors;
    DROP TABLE IF EXISTS _trip_windows;
    UPDATE tat_refactor_runs
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;
