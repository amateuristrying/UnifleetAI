-- =============================================================
-- TAT V2 REFACTOR: Phase 4 FIX — Border Facts + Wide Trip Fact Table
-- Replaces: tat_v2_refactor_phase_4.sql
-- Dependency: tat_v2_refactor_tables_patch.sql, phase_3_fix.sql
--
-- Contains:
--   1. ALTER TABLE tat_trip_facts_v2 — border summary + exception flag columns
--   2. build_tat_trip_border_facts_v2 — per-border child fact builder
--   3. build_tat_trip_facts_v2 — revised wide fact builder with parity fixes
--      [PARITY 1A] loading_terminal from winning-role canonical_name
--      [PARITY 1B] dar_arrival from trip_anchor_start (ops_yard/origin_region only)
--      [PARITY 1C] dar_exit from origin_exit (origin_region/origin_gateway only)
--      [PARITY 1D] has_destination_region_only flag
--      [BORDER]    border_total_hrs from child table SUM, not gap calculation
-- =============================================================
ALTER TABLE tat_trip_facts_v2
    -- Border summary counters (sourced from tat_trip_border_facts_v2)
    ADD COLUMN IF NOT EXISTS outbound_border_total_hrs  NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS return_border_total_hrs    NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS outbound_border_count      INTEGER,
    ADD COLUMN IF NOT EXISTS return_border_count        INTEGER,

    -- Destination proof tier flag (parity 1D)
    -- TRUE when the only destination evidence is destination_region (no site-level proof)
    ADD COLUMN IF NOT EXISTS has_destination_region_only BOOLEAN DEFAULT FALSE,

    -- Exception flag aliases (same info as missed_destination but explicit naming)
    ADD COLUMN IF NOT EXISTS missed_destination_flag    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS route_anomaly_flag         BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS low_confidence_flag        BOOLEAN DEFAULT FALSE,

    -- trip_type / trip_status exposed explicitly
    -- (physical columns 'status' and 'closure_reason' retained for backward compat)
    ADD COLUMN IF NOT EXISTS trip_status                TEXT
        GENERATED ALWAYS AS (status) STORED,
    ADD COLUMN IF NOT EXISTS trip_closure_reason        TEXT
        GENERATED ALWAYS AS (closure_reason) STORED,

    -- Destination dwell aggregated at customer level (kept separate from dest)
    ADD COLUMN IF NOT EXISTS completion_time            TIMESTAMPTZ;

-- Note: trip_status and trip_closure_reason are generated columns that mirror
-- 'status' and 'closure_reason'. They provide the v2 naming convention while
-- keeping the physical columns for backward compat with existing queries.


-- ── 2. Index new columns ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_trip_status
    ON tat_trip_facts_v2 (trip_status);

CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_low_conf
    ON tat_trip_facts_v2 (low_confidence_flag);


-- ── build_tat_trip_border_facts_v2 ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION build_tat_trip_border_facts_v2(
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
        'PHASE_BORDER_FACTS', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

    -- ── 1. Delete existing border facts for trips anchored in this window ────
    DELETE FROM tat_trip_border_facts_v2
    WHERE trip_key IN (
        SELECT DISTINCT trip_key
        FROM trip_state_events
        WHERE event_code = 'loading_start'
          AND event_time >= p_start
          AND event_time  < p_end
          AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
    );

    -- ── 2. Build border facts ────────────────────────────────────────────────
    -- Two data-quality issues to handle:
    --   A. GPS jitter: 4-8 duplicate entry+exit events within minutes for one
    --      physical crossing (confirmed at tunduma, nakonde, sakania).
    --   B. Daily midnight split: geofence_visits resets at 23:59:59/00:00:00,
    --      so an overnight border stay produces exit@23:59:59 + entry@00:00:00
    --      which is objectively one continuous event.
    --
    -- Session-collapse strategy (entry-anchored):
    --   1. Session breaks detected on ENTRY→ENTRY gaps only (not entry→exit,
    --      which is dwell time and can be many hours).
    --   2. Midnight continuations (entry@00:00:00 with exit within 2s before)
    --      are forced into the previous session regardless of gap.
    --   3. Each exit is assigned to the session of its nearest preceding entry.
    --   4. Collapse: MIN(entry_time), MAX(exit_time) per session.
    INSERT INTO tat_trip_border_facts_v2 (
        trip_key,
        tracker_id,
        tracker_name,
        trip_sequence,
        border_code,
        border_name,
        border_family,
        country_code,
        leg_direction,
        entry_time,
        exit_time,
        event_confidence,
        inference_rule,
        source_event_ids
    )
    WITH active_trips AS (
        SELECT DISTINCT trip_key, tracker_id
        FROM trip_state_events
        WHERE event_code = 'loading_start'
          AND event_time >= p_start
          AND event_time  < p_end
          AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
    ),
    -- All border events for active trips.
    all_events AS (
        SELECT
            e.event_id,
            e.trip_key,
            e.tracker_id,
            e.event_code,
            e.event_time,
            e.border_code,
            e.border_family,
            e.country_code,
            e.leg_direction,
            e.canonical_name,
            e.event_confidence,
            e.trip_sequence
        FROM trip_state_events e
        JOIN active_trips at ON at.trip_key = e.trip_key
        WHERE e.event_code IN (
                'border_entry','border_exit',
                'return_border_entry','return_border_exit'
              )
          AND e.border_code IS NOT NULL
    ),
    -- Entry events only, with the time of the PREVIOUS ENTRY
    -- (not previous event) for gap-based session detection.
    entry_events_gapped AS (
        SELECT
            e.*,
            LAG(e.event_time) OVER (
                PARTITION BY e.trip_key, e.border_code, e.leg_direction
                ORDER BY e.event_time
            ) AS prev_entry_time
        FROM all_events e
        WHERE e.event_code IN ('border_entry','return_border_entry')
    ),
    -- Detect midnight continuations: this entry is at 00:00:00 UTC and there
    -- is a corresponding exit within 2 seconds before it (the 23:59:58/59
    -- truncation from the previous daily record). These must NOT start a new
    -- session even if the gap from the previous entry is large.
    entry_events_marked AS (
        SELECT
            ee.*,
            CASE
                WHEN EXTRACT(HOUR   FROM ee.event_time) = 0
                 AND EXTRACT(MINUTE FROM ee.event_time) = 0
                 AND EXTRACT(SECOND FROM ee.event_time) = 0
                 AND EXISTS (
                         SELECT 1 FROM all_events ex
                         WHERE ex.trip_key      = ee.trip_key
                           AND ex.border_code   = ee.border_code
                           AND ex.leg_direction = ee.leg_direction
                           AND ex.event_code   IN ('border_exit','return_border_exit')
                           AND ex.event_time    < ee.event_time
                           AND EXTRACT(EPOCH FROM (ee.event_time - ex.event_time)) <= 2
                     )
                THEN TRUE ELSE FALSE
            END AS is_midnight_continuation
        FROM entry_events_gapped ee
    ),
    -- Assign session numbers. New session when:
    --   - first entry ever, OR
    --   - gap from previous entry > 2h AND not a midnight continuation.
    entry_sessions AS (
        SELECT *,
            SUM(
                CASE
                    WHEN prev_entry_time IS NULL        THEN 1
                    WHEN is_midnight_continuation       THEN 0
                    WHEN EXTRACT(EPOCH FROM (event_time - prev_entry_time)) > 7200 THEN 1
                    ELSE 0
                END
            ) OVER (
                PARTITION BY trip_key, border_code, leg_direction
                ORDER BY event_time ROWS UNBOUNDED PRECEDING
            ) AS session_num
        FROM entry_events_marked
    ),
    -- Assign each exit to the session of its nearest preceding entry.
    exit_with_session AS (
        SELECT
            ex.event_id, ex.trip_key, ex.tracker_id, ex.event_code, ex.event_time,
            ex.border_code, ex.border_family, ex.country_code, ex.leg_direction,
            ex.canonical_name, ex.event_confidence, ex.trip_sequence,
            (
                SELECT es.session_num
                FROM entry_sessions es
                WHERE es.trip_key      = ex.trip_key
                  AND es.border_code   = ex.border_code
                  AND es.leg_direction = ex.leg_direction
                  AND es.event_time   <= ex.event_time
                ORDER BY es.event_time DESC
                LIMIT 1
            ) AS session_num
        FROM all_events ex
        WHERE ex.event_code IN ('border_exit','return_border_exit')
    ),
    -- Union entries and exits with their session labels.
    all_with_sessions AS (
        SELECT event_id, trip_key, tracker_id, event_code, event_time,
               border_code, border_family, country_code, leg_direction,
               canonical_name, event_confidence, trip_sequence, session_num
        FROM entry_sessions

        UNION ALL

        SELECT event_id, trip_key, tracker_id, event_code, event_time,
               border_code, border_family, country_code, leg_direction,
               canonical_name, event_confidence, trip_sequence, session_num
        FROM exit_with_session
        WHERE session_num IS NOT NULL   -- discard exits with no preceding entry
    ),
    -- Collapse each session: MIN(entry), MAX(exit), all source event IDs.
    collapsed_crossings AS (
        SELECT
            trip_key,
            tracker_id,
            border_code,
            border_family,
            country_code,
            leg_direction,
            MIN(trip_sequence)                          AS trip_sequence,
            (ARRAY_AGG(canonical_name ORDER BY event_confidence DESC NULLS LAST))[1]
                                                        AS canonical_name,
            session_num                                 AS pass_ordinal,
            MIN(event_time) FILTER (
                WHERE event_code IN ('border_entry','return_border_entry')
            )                                           AS entry_time,
            MAX(event_time) FILTER (
                WHERE event_code IN ('border_exit','return_border_exit')
            )                                           AS exit_time,
            MAX(event_confidence) FILTER (
                WHERE event_code IN ('border_entry','return_border_entry')
            )                                           AS entry_confidence,
            MAX(event_confidence) FILTER (
                WHERE event_code IN ('border_exit','return_border_exit')
            )                                           AS exit_confidence,
            ARRAY_AGG(event_id ORDER BY event_time)     AS all_source_ids,
            CASE
                WHEN MAX(event_time) FILTER (
                         WHERE event_code IN ('border_exit','return_border_exit')
                     ) IS NOT NULL
                THEN 'session_collapsed_pair'
                ELSE 'entry_without_exit'
            END                                         AS inference_rule
        FROM all_with_sessions
        GROUP BY trip_key, tracker_id, border_code, border_family, country_code,
                 leg_direction, session_num
    ),
    tracker_names AS (
        SELECT DISTINCT ON (tracker_id)
            tracker_id, tracker_name
        FROM public.geofence_visits
        ORDER BY tracker_id, in_time_dt DESC
    )
    SELECT
        cc.trip_key,
        cc.tracker_id,
        tn.tracker_name,
        cc.trip_sequence,
        cc.border_code,
        INITCAP(REPLACE(cc.border_code, '_', ' '))      AS border_name,
        cc.border_family,
        cc.country_code,
        cc.leg_direction,
        cc.entry_time,
        cc.exit_time,
        -- Confidence: min of entry+exit; downgrade to 70% if exit missing
        CASE
            WHEN cc.exit_time IS NOT NULL
                THEN ROUND(LEAST(cc.entry_confidence, cc.exit_confidence)::NUMERIC, 2)
            ELSE ROUND((cc.entry_confidence * 0.70)::NUMERIC, 2)
        END                                             AS event_confidence,
        cc.inference_rule,
        cc.all_source_ids                               AS source_event_ids
    FROM collapsed_crossings cc
    LEFT JOIN tracker_names tn ON tn.tracker_id = cc.tracker_id;

    -- ── 3. QA: flag border entries without exits ─────────────────────────────
    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, trip_key, issue_type, severity, description, context
    )
    SELECT
        v_run_id,
        tbf.tracker_id,
        tbf.trip_key,
        'border_entry_without_exit',
        'medium',
        'Border crossing has entry but no exit: ' || tbf.border_code
            || ' (' || tbf.leg_direction || ')',
        jsonb_build_object(
            'border_code',   tbf.border_code,
            'leg_direction', tbf.leg_direction,
            'entry_time',    tbf.entry_time
        )
    FROM tat_trip_border_facts_v2 tbf
    WHERE tbf.exit_time IS NULL
      AND tbf.entry_time >= p_start
      AND tbf.entry_time  < p_end
      AND (p_tracker_id IS NULL OR tbf.tracker_id = p_tracker_id)
      AND NOT EXISTS (
          SELECT 1
          FROM tat_data_quality_issues dq
          WHERE dq.run_id      = v_run_id
            AND dq.issue_type  = 'border_entry_without_exit'
            AND dq.tracker_id  = tbf.tracker_id
            AND dq.trip_key    = tbf.trip_key
            AND dq.description = 'Border crossing has entry but no exit: '
                                 || tbf.border_code || ' (' || tbf.leg_direction || ')'
      )
    ON CONFLICT DO NOTHING;

    -- ── 4. QA: flag multiple crossings (unusual; worth investigating) ─────────
    INSERT INTO tat_data_quality_issues (
        run_id, tracker_id, trip_key, issue_type, severity, description, context
    )
    SELECT
        v_run_id, tracker_id, trip_key,
        'multiple_border_crossings', 'low',
        'Trip crossed border ' || border_code || ' (' || leg_direction
            || ') ' || crossing_count || ' times',
        jsonb_build_object(
            'border_code',      border_code,
            'leg_direction',    leg_direction,
            'crossing_count',   crossing_count
        )
    FROM (
        SELECT tracker_id, trip_key, border_code, leg_direction,
               COUNT(*) AS crossing_count
        FROM tat_trip_border_facts_v2
        WHERE entry_time >= p_start AND entry_time < p_end
          AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
        GROUP BY tracker_id, trip_key, border_code, leg_direction
        HAVING COUNT(*) > 1
    ) multi
    WHERE NOT EXISTS (
        SELECT 1
        FROM tat_data_quality_issues dq
        WHERE dq.run_id      = v_run_id
          AND dq.issue_type  = 'multiple_border_crossings'
          AND dq.tracker_id  = multi.tracker_id
          AND dq.trip_key    = multi.trip_key
          AND dq.description = 'Trip crossed border ' || multi.border_code || ' ('
                               || multi.leg_direction || ') '
                               || multi.crossing_count || ' times'
    )
    ON CONFLICT DO NOTHING;

    UPDATE tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'border_facts_written', (
                SELECT count(*) FROM tat_trip_border_facts_v2
                WHERE entry_time >= p_start AND entry_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            ),
            'entries_without_exit', (
                SELECT count(*) FROM tat_trip_border_facts_v2
                WHERE exit_time IS NULL
                  AND entry_time >= p_start AND entry_time < p_end
                  AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            )
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    UPDATE tat_refactor_runs
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;

CREATE OR REPLACE FUNCTION build_tat_trip_facts_v2(
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
        'PHASE_4_FACTS_V2', 'running',
        jsonb_build_object('start', p_start, 'end', p_end, 'tracker_id', p_tracker_id)
    )
    RETURNING run_id INTO v_run_id;

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
        SELECT DISTINCT trip_key, tracker_id
        FROM trip_state_events
        WHERE event_code = 'loading_start'
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
                FILTER (WHERE e.event_code = 'trip_anchor_start')    AS origin_region_name,
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
                  AND n.canonical_name ILIKE '%ASAS%'
                  AND n.role_code IN ('ops_yard','origin_base','origin_zone','origin_gateway')
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
        a.origin_region_name,

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
        COALESCE(a.dar_arrival, a.l_start),
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
        -- waiting_for_orders_hrs (parity 1B: dar_arrival → loading_start)
        CASE
            WHEN a.dar_arrival IS NOT NULL AND a.l_start IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (a.l_start - a.dar_arrival))/3600.0, 2)
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
    LEFT JOIN tracker_names tn ON tn.tracker_id  = a.tracker_id
    LEFT JOIN border_summary bs ON bs.trip_key   = a.trip_key

    -- Shunt filter (v1 parity): only real trips
    WHERE (a.ox IS NOT NULL OR a.dest_name IS NOT NULL OR a.has_corridor)

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
END $$;

-- ─── Parity comparison view ──────────────────────────────────────────────────
-- Compare v1 vs v2 trip counts and avg TAT per destination over any date range.
-- Run: SELECT * FROM v_tat_v1_v2_parity WHERE loading_start >= '2024-01-01';
CREATE OR REPLACE VIEW v_tat_v1_v2_parity AS
SELECT
    'v1' AS version,
    dest_name          AS destination,
    count(*)           AS trip_count,
    ROUND(AVG(
        CASE
            WHEN (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL)
                THEN EXTRACT(EPOCH FROM (
                    COALESCE(next_dar_entry, next_loading_entry)
                    - COALESCE(dar_arrival, loading_start)
                ))/3600.0
            ELSE NULL
        END
    ), 1)              AS avg_total_tat_hrs,
    min(loading_start) AS first_trip,
    max(loading_start) AS latest_trip
FROM tat_trips_data
WHERE dest_name IS NOT NULL
GROUP BY dest_name

UNION ALL

SELECT
    'v2' AS version,
    destination_name   AS destination,
    count(*)           AS trip_count,
    ROUND(AVG(total_tat_hrs), 1) AS avg_total_tat_hrs,
    min(loading_start) AS first_trip,
    max(loading_start) AS latest_trip
FROM tat_trip_facts_v2
WHERE destination_name IS NOT NULL
GROUP BY destination_name

ORDER BY destination, version;
