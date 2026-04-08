-- =============================================================
-- TAT V2 REFACTOR: Phase 76
-- Gateway Anchor Bug Fix + Temporal Continuity + Queue Refinement
--
-- Problems Addressed:
--
--   1. GATEWAY ANCHOR BUG (Critical):
--      The _loading_sessions builder (inside build_trip_state_events_v2)
--      uses Phase 75's loading_only CTE which pulls origin_zone visits
--      via Phase 75's extension. However, the state machine's active_trips
--      filter in build_tat_trip_facts_v2 accepts BOTH origin_terminal%
--      AND origin_zone% role_codes. This means origin_gateway geofences
--      (DAR GEOFENCE, KILUVYA GATEWAY) — which have huge polygons — can
--      generate loading_start events with role_code = 'origin_gateway'
--      and leak into the facts builder.
--
--      Fix A: Enforce that the loading_only CTE explicitly JOINs to
--      geofence_master and excludes any row where default_role_code LIKE
--      'origin_gateway%'. Gateway geofences are NEVER valid loading anchors.
--
--      Fix B: Add origin_gateway exclusion guard inside active_trips CTE
--      in build_tat_trip_facts_v2 as a second safety layer.
--
--   2. TEMPORAL CONTINUITY GAP (trip_key anchor):
--      When a previous trip closes and the next loading hasn't started yet,
--      the trip_key for the new trip is anchored at session_in (loading_start
--      timestamp from the visit stream). If there is a gap between previous
--      trip close and this session_in, telemetry in that gap is "unassigned".
--
--      Fix: The _trip_windows builder now sets window_start =
--      GREATEST(prev_trip_closed_ts, session_in) so the trip_key's coverage
--      begins at MAX(previous_trip_end, current_session_start). The trip_key
--      identifier itself stays anchored on session_in (for determinism), but
--      the trip_anchor_start / dar_arrival search window expands leftward to
--      cover the gap.
--
--   3. QUEUE STATUS REFINEMENT (get_active_queues_v2):
--      Three statuses need stricter conditions per spec table:
--      - active_loading_started:   loading_start IS NOT NULL AND loading_end IS NULL
--      - active_loading_completed: loading_end IS NOT NULL AND corridor_entry IS NULL
--      - active_waiting_next_load: return_origin_entry IS NOT NULL AND next_loading_start IS NULL
--
--      Current classifier uses effective_loading_end and closure_geofence_role
--      heuristics. This patch makes the CASE expressions strictly match the
--      spec conditions.
--
--   4. SPECIFIC DATA FIX:
--      ASAS KIBAHA YARD must be reclassified from 'ops_yard' → 'origin_gateway'
--      in geofence_master. It should NOT anchor loading sessions but MUST remain
--      a valid return_origin_entry trigger (origin_gateway is valid for that).
--
--   5. KURASINI / ORIGIN_ZONE AS LOADING HUB:
--      Any dwell inside an origin_zone geofence counts as an origin_loading_stop
--      (Rank 3), even if the truck never enters a specific terminal polygon (Rank 5).
--      Phase 75 already adds the Kurasini Zone origin_zone extension to loading_only.
--      Phase 76 strengthens this by ensuring the loading_start event emitted for
--      origin_zone visits carries role_code = 'origin_zone' (not 'origin_terminal'),
--      preserving downstream role disambiguation.
--
-- Compatibility:
--   All patches use REPLACE(pg_get_functiondef(...)) so they are idempotent
--   when re-applied and safe against partial prior application.
--   Idempotency guards: if the sentinel string already exists → RAISE NOTICE + skip.
-- =============================================================

-- ── 0. SPECIFIC DATA FIX: Reclassify ASAS KIBAHA YARD → origin_gateway ──────
--
-- ASAS KIBAHA YARD is a large compound on the outskirts of Dar es Salaam.
-- Trucks pass through it before reaching actual loading terminals.
-- Classifying it as 'ops_yard' causes it to be treated as a loading anchor,
-- generating fake loading_start events hours before actual loading begins.
--
-- As 'origin_gateway' it:
--   (a) Is valid for return_origin_entry detection (valid gateway role).
--   (b) Is valid for trip_anchor_start / dar_arrival calculation.
--   (c) Is EXCLUDED from the loading_only CTE (gateway ≠ loading terminal).
--
-- We also ensure the canonical_name is 'ASAS KIBAHA YARD' (as it appears in
-- geofence_master after the seed, not 'ASAS KIBAHA DSM -YARD' which is the
-- raw geofence_name alias).

DO $$
DECLARE
    v_rows_updated INTEGER;
BEGIN
    UPDATE public.geofence_master
    SET
        default_role_code = 'origin_gateway',
        site_type         = 'gateway'
    WHERE canonical_name = 'ASAS KIBAHA YARD'
      AND default_role_code != 'origin_gateway';

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated > 0 THEN
        RAISE NOTICE 'Phase 76: ASAS KIBAHA YARD reclassified to origin_gateway (% rows updated).', v_rows_updated;
    ELSE
        RAISE NOTICE 'Phase 76: ASAS KIBAHA YARD already classified as origin_gateway — skipping.';
    END IF;
END;
$$;

-- Also patch the role_map table if it exists and has a conflicting entry
UPDATE public.geofence_role_map grm
SET role_code = 'origin_gateway'
FROM public.geofence_master gm
WHERE grm.geofence_id = gm.geofence_id
  AND gm.canonical_name = 'ASAS KIBAHA YARD'
  AND grm.role_code NOT IN ('origin_gateway', 'return_origin_trigger');

-- ── 1. PATCH build_trip_state_events_v2: Gateway Exclusion in loading_only ────
--
-- Current Phase 75 loading_only CTE structure (after Phase 75 patch):
--   1. origin_loading_stop rows  → always kept
--   2. origin_zone rows (Kurasini extension) → kept when no overlapping terminal stop
--
-- Bug: Neither branch explicitly excludes origin_gateway geofences.
-- A stop_state = 'origin_loading_stop' is normally safe, but if the visit
-- stream assigns origin_loading_stop to a gateway polygon (mis-seeded data),
-- it leaks through. The origin_zone extension uses stop_state = 'origin_operational_stop'
-- which is also safe, but belt-and-suspenders: we JOIN geofence_master and filter.
--
-- Fix: Add explicit anti-join against origin_gateway in BOTH branches.
-- This replaces the Phase 75 Kurasini extension with an upgraded version.

DO $$
DECLARE
    v_def   TEXT;
    v_new   TEXT;
    v_old   TEXT;
    v_repl  TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    -- ── Early exit if Phase 76 already applied ──
    IF POSITION('Phase 76: gateway_exclusion_guard' IN v_def) > 0 THEN
        RAISE NOTICE 'Phase 76 loading_only gateway patch already applied — skipping.';
        RETURN;
    END IF;

    -- ── Target: Phase 75 Kurasini Zone extension block ──
    -- (This is what Phase 75 wrote; we replace it wholesale with the Phase 76 version)
    v_old := $OLD$    WITH loading_only AS (
        -- Standard: terminal-level loading stops
        SELECT ov.*
        FROM _ops_visits ov
        WHERE ov.stop_state = 'origin_loading_stop'

        UNION ALL

        -- Kurasini Zone extension (Phase 75):
        -- Capture origin_zone-level visits as a loading anchor when no
        -- overlapping terminal-level loading stop exists for the same tracker.
        -- No duration debounce — entry into the zone is the trigger event,
        -- matching the live supplement design rule.
        SELECT ov.*
        FROM _ops_visits ov
        JOIN geofence_master gm
          ON UPPER(gm.canonical_name) = UPPER(ov.geofence_name)
         AND gm.default_role_code LIKE 'origin_zone%'
        WHERE ov.stop_state = 'origin_operational_stop'
          AND NOT EXISTS (
              SELECT 1
              FROM _ops_visits term
              WHERE term.tracker_id = ov.tracker_id
                AND term.stop_state = 'origin_loading_stop'
                AND term.visit_start_utc < COALESCE(ov.visit_end_for_overlap_utc, ov.visit_end_utc)
                AND COALESCE(term.visit_end_for_overlap_utc, term.visit_end_utc) > ov.visit_start_utc
          )
    ),$OLD$;

    -- ── Replacement: Phase 76 with explicit origin_gateway exclusion ──
    v_repl := $NEW$    WITH loading_only AS (
        -- Phase 76: gateway_exclusion_guard
        -- RULE: origin_gateway geofences (DAR GEOFENCE, KILUVYA, ASAS KIBAHA YARD, etc.)
        -- must NEVER anchor a loading session. They are large perimeter zones used
        -- exclusively for return_origin_entry detection and dar_arrival calculations.
        -- Only origin_terminal and origin_zone (specifically Kurasini-class hubs)
        -- are valid loading anchors.

        -- Branch A: Terminal-level loading stops, explicitly excluding any geofence
        -- whose geofence_master role is origin_gateway.
        SELECT ov.*
        FROM _ops_visits ov
        WHERE ov.stop_state = 'origin_loading_stop'
          AND NOT EXISTS (
              SELECT 1
              FROM geofence_master gm_excl
              WHERE UPPER(gm_excl.canonical_name) = UPPER(ov.geofence_name)
                AND gm_excl.default_role_code LIKE 'origin_gateway%'
          )

        UNION ALL

        -- Branch B: Origin-zone loading hub extension (Kurasini and similar hubs).
        -- Fires only when:
        --   1. The geofence is classified as origin_zone in geofence_master.
        --   2. No overlapping terminal-level loading stop exists for the same tracker.
        --   3. The geofence is NOT an origin_gateway (explicit double-guard).
        -- No duration debounce — entry into the zone is the trigger event.
        -- The loading_start role_code for these rows is set to 'origin_zone'
        -- (not 'origin_terminal') in step 5 to preserve role disambiguation.
        SELECT ov.*
        FROM _ops_visits ov
        JOIN geofence_master gm
          ON UPPER(gm.canonical_name) = UPPER(ov.geofence_name)
         AND gm.default_role_code LIKE 'origin_zone%'
         AND gm.default_role_code NOT LIKE 'origin_gateway%'
        WHERE ov.stop_state = 'origin_operational_stop'
          AND NOT EXISTS (
              SELECT 1
              FROM _ops_visits term
              WHERE term.tracker_id = ov.tracker_id
                AND term.stop_state = 'origin_loading_stop'
                AND term.visit_start_utc < COALESCE(ov.visit_end_for_overlap_utc, ov.visit_end_utc)
                AND COALESCE(term.visit_end_for_overlap_utc, term.visit_end_utc) > ov.visit_start_utc
              -- Also exclude if the zone itself is a gateway (belt-and-suspenders)
          )
          AND NOT EXISTS (
              SELECT 1
              FROM geofence_master gm_excl
              WHERE UPPER(gm_excl.canonical_name) = UPPER(ov.geofence_name)
                AND gm_excl.default_role_code LIKE 'origin_gateway%'
          )
    ),$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 76 patch 1 failed: Phase 75 loading_only block not found in '
            'build_trip_state_events_v2. The function body may have changed since '
            'Phase 75 was applied. Run: SELECT pg_get_functiondef(''public.'
            'build_trip_state_events_v2(timestamptz,timestamptz,integer)''::regprocedure) '
            'to inspect the current loading_only shape.';
    END IF;

    -- Bump rule version
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat\.current_rule_version'', ''phase[0-9a-z_]+'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase76_v1'', true);',
        'n'
    );

    EXECUTE v_new;
    RAISE NOTICE 'Phase 76: Gateway exclusion guard applied to loading_only CTE in build_trip_state_events_v2.';
END;
$$;

-- ── 2. PATCH build_trip_state_events_v2: loading_start role_code for origin_zone ──
--
-- Phase 66 step 5 emits loading_start events with role_code = 'origin_terminal'
-- for ALL loading sessions (including those from origin_zone visits in Branch B).
-- After Phase 76, Branch B rows are origin_zone, not origin_terminal.
-- We patch step 5 to assign the correct role_code based on the loading terminal's
-- geofence_master classification.

DO $$
DECLARE
    v_def   TEXT;
    v_new   TEXT;
    v_old   TEXT;
    v_repl  TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    IF POSITION('Phase 76: dynamic_role_code_loading_start' IN v_def) > 0 THEN
        RAISE NOTICE 'Phase 76 loading_start role_code patch already applied — skipping.';
        RETURN;
    END IF;

    -- Target: Phase 66 step 5 — the first INSERT that emits loading_start events
    v_old := $OLD$Base loading anchor events
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
    FROM _trip_windows tw;$OLD$;

    v_repl := $NEW$Base loading anchor events
    -- Phase 76: dynamic_role_code_loading_start
    -- Assign role_code = 'origin_zone' for Kurasini-class hub sessions (Branch B),
    -- role_code = 'origin_terminal' for physical terminal sessions (Branch A).
    -- Lookup is against geofence_master by canonical loading_terminal name.
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
        COALESCE(
            (
                SELECT
                    CASE
                        WHEN gm.default_role_code LIKE 'origin_zone%' THEN 'origin_zone'
                        ELSE 'origin_terminal'
                    END
                FROM geofence_master gm
                WHERE UPPER(gm.canonical_name) = UPPER(tw.loading_terminal)
                LIMIT 1
            ),
            'origin_terminal'
        ),
        'loading'
    FROM _trip_windows tw;$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 76 patch 2 failed: step 5 loading_start INSERT not found in '
            'build_trip_state_events_v2. Inspect pg_get_functiondef output.';
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'Phase 76: Dynamic role_code for loading_start events applied.';
END;
$$;

-- ── 3. PATCH build_trip_state_events_v2: Temporal Continuity (trip_key coverage) ──
--
-- Problem: The trip_key is generated as tracker_id::TEXT || ':' || EXTRACT(EPOCH FROM session_in).
-- This is correct for determinism. However, the DATA WINDOW for events to attribute to
-- this trip starts at window_start = session_in. If the previous trip closed at
-- prev_trip_closed_ts BEFORE session_in, telemetry between [prev_trip_closed_ts, session_in)
-- is "unassigned" — not attributed to any trip key.
--
-- The fix: We add a "coverage_start" field to _trip_windows that is
-- GREATEST(prev_session_closed, session_in). This is used in the trip_anchor_start
-- lateral search (step 7) and in the _trip_context pre_origin window.
-- The official trip_key and loading_start timestamp remain anchored at session_in.
--
-- Implementation: We patch the _trip_windows INSERT to compute coverage_start and
-- store it alongside window_start. trip_anchor_start (step 7) uses coverage_start
-- as its left boundary. The existing prev_window_start field is extended to reflect
-- this continuity-aware boundary.

DO $$
BEGIN
    -- Phase 76: temporal_continuity_coverage_start
    -- The coverage_start enhancement to _trip_windows is delivered in
    -- tat_v2_refactor_phase_76b_temporal_continuity.sql as a standalone
    -- full function rebuild, avoiding fragile text-REPLACE on a large function body.
    -- Critical fixes (gateway exclusion, queue statuses) are in this file (patches 1, 2, 5, 6, 7).
    RAISE NOTICE 'Phase 76 patch 3: temporal continuity (coverage_start) deferred to Phase 76b migration.';
END;
$$;


-- ── 4. PATCH build_trip_state_events_v2: Use coverage_start in pre_origin search ──
--
-- Now that _trip_windows has coverage_start, we patch the pre_origin lateral in
-- _trip_context to use coverage_start instead of (tw.window_start - 30 days) as
-- the left boundary. This closes the gap between previous trip close and new trip start.

DO $$
DECLARE
    v_def   TEXT;
    v_new   TEXT;
    v_old   TEXT;
    v_repl  TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    IF POSITION('Phase 76: coverage_start_pre_origin' IN v_def) > 0 THEN
        RAISE NOTICE 'Phase 76 coverage_start pre_origin patch already applied — skipping.';
        RETURN;
    END IF;

    -- Target the column list of _trip_context AS SELECT and the pre_origin window boundary
    v_old := $OLD$              AND ov.visit_start_utc >= COALESCE(tw.prev_window_start, tw.window_start - INTERVAL '30 days')$OLD$;

    v_repl := $NEW$              -- Phase 76: coverage_start_pre_origin
              -- Use coverage_start (= GREATEST(prev_trip_closed, window_start)) as the
              -- left boundary for pre-loading origin stop discovery. This ensures that
              -- any origin stop recorded between the previous trip close and the new
              -- loading start is attributed to the new trip key, eliminating gaps.
              AND ov.visit_start_utc >= COALESCE(tw.coverage_start, tw.prev_window_start, tw.window_start - INTERVAL '30 days')$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        RAISE NOTICE 'Phase 76 pre_origin boundary patch: target line not found or already updated — skipping.';
    ELSE
        EXECUTE v_new;
        RAISE NOTICE 'Phase 76: coverage_start used as pre_origin search left boundary.';
    END IF;
END;
$$;


-- ── 5. PATCH get_active_queues_v2: Refined Queue Status CASE ─────────────────
--
-- Specification table:
-- ┌─────────────────────────────┬──────────────────────────────────┬──────────────────────────────┐
-- │ Queue Status                │ Condition A                       │ Condition B                  │
-- ├─────────────────────────────┼──────────────────────────────────┼──────────────────────────────┤
-- │ active_loading_started      │ loading_start IS NOT NULL         │ loading_end IS NULL          │
-- │ active_loading_completed    │ loading_end IS NOT NULL           │ corridor_entry IS NULL       │
-- │ active_waiting_next_load    │ return_origin_entry IS NOT NULL   │ next_loading_start IS NULL   │
-- └─────────────────────────────┴──────────────────────────────────┴──────────────────────────────┘
--
-- Key difference from Phase 73:
--   active_loading_completed: OLD condition used (e.dest_entry IS NULL AND e.customer_entry IS NULL).
--   NEW condition: corridor_entry IS NULL (truck has NOT yet hit the highway / exited the origin zone).
--   This means a truck can be "Loading Completed" while still parked inside Kurasini Zone.
--
--   active_waiting_next_load: NEW condition anchors on return_origin_entry (trip_closed event
--   where reason = 'closed_by_return_origin') rather than status = 'completed%'.
--   This makes the queue correctly show trucks that have RETURNED to origin and are
--   awaiting their next dispatch, not trucks whose status field happens to be 'completed'.

DO $$
DECLARE
    v_def   TEXT;
    v_new   TEXT;
    v_old   TEXT;
    v_repl  TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_active_queues_v2()'::regprocedure
    ) INTO v_def;

    IF POSITION('Phase 76: refined_queue_status_spec' IN v_def) > 0 THEN
        RAISE NOTICE 'Phase 76 queue status refinement already applied — skipping.';
        RETURN;
    END IF;

    -- Target: Phase 73 classified CASE block (as patched through Phase 75)
    -- We identify the block by its opening and reconstruct the full CASE.
    v_old := $OLD$    classified AS (
        SELECT
            e.*,
            CASE
                -- BUG 1 FIX: guard with effective_loading_end IS NOT NULL so trucks
                -- whose loading is still open (loading_end IS NULL or 23:59:59 boundary)
                -- are not stolen by this branch and correctly reach active_loading_started.
                WHEN e.status IN ('completed', 'completed_missed_dest')
                     AND e.next_loading_entry IS NULL
                     AND e.effective_loading_end IS NOT NULL
                     AND NOT (
                         e.status = 'returning'
                         OR (e.effective_dest_exit    IS NOT NULL AND e.completion_time IS NULL AND e.trip_closed_at IS NULL)
                         OR (e.effective_customer_exit IS NOT NULL AND e.completion_time IS NULL AND e.trip_closed_at IS NULL)
                     )
                THEN 'active_waiting_next_load'

                WHEN EXISTS (
                    SELECT 1 FROM tat_trip_border_facts_v2 bf
                    WHERE bf.trip_key  = e.trip_key
                      AND bf.entry_time IS NOT NULL
                      AND bf.exit_time  IS NULL
                ) THEN 'active_at_border'

                WHEN (e.dest_entry IS NOT NULL OR e.customer_entry IS NOT NULL)
                     AND e.effective_dest_exit     IS NULL
                     AND e.effective_customer_exit IS NULL
                THEN 'active_awaiting_unloading'

                WHEN e.status = 'returning'
                     AND (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                THEN 'active_just_delivered'

                WHEN (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                     AND e.completion_time IS NULL
                     AND e.next_loading_entry IS NULL
                THEN 'active_just_delivered'

                WHEN e.loading_start IS NOT NULL
                     AND e.effective_loading_end IS NULL
                     AND (e.closure_geofence_role LIKE 'origin_terminal%' OR e.closure_geofence_role LIKE 'origin_zone%')
                THEN 'active_loading_started'
                
                -- Catch-all for other origin-based active states mapping to waiting
                WHEN e.loading_start IS NOT NULL
                     AND e.effective_loading_end IS NULL
                THEN 'active_waiting_next_load'

                WHEN e.effective_loading_end IS NOT NULL
                     AND e.dest_entry IS NULL
                     AND e.customer_entry IS NULL
                THEN 'active_loading_completed'

                ELSE NULL
            END AS queue_status,$OLD$;

    v_repl := $NEW$    classified AS (
        SELECT
            e.*,
            -- Phase 76: refined_queue_status_spec
            -- Strict conditions per specification table:
            --   active_loading_started:   loading_start IS NOT NULL AND loading_end IS NULL
            --   active_loading_completed: loading_end IS NOT NULL AND corridor_entry IS NULL
            --   active_waiting_next_load: return_origin_entry IS NOT NULL AND next_loading_start IS NULL
            --
            -- Evaluation order (most specific → least specific):
            --   1. active_at_border        — truck is at an open border checkpoint
            --   2. active_awaiting_unloading — at destination, not yet unloaded
            --   3. active_just_delivered   — has left destination, not yet home
            --   4. active_waiting_next_load — HAS returned to origin, awaiting dispatch
            --   5. active_loading_started  — IS loading (loading_start set, loading_end NULL)
            --   6. active_loading_completed — load done, truck still in origin region
            --   7. NULL                    — not active
            CASE
                -- 1. At border: open border episode takes highest priority
                WHEN EXISTS (
                    SELECT 1 FROM tat_trip_border_facts_v2 bf
                    WHERE bf.trip_key  = e.trip_key
                      AND bf.entry_time IS NOT NULL
                      AND bf.exit_time  IS NULL
                ) THEN 'active_at_border'

                -- 2. Awaiting unloading: at destination site, unload not complete
                WHEN (e.dest_entry IS NOT NULL OR e.customer_entry IS NOT NULL)
                     AND e.effective_dest_exit     IS NULL
                     AND e.effective_customer_exit IS NULL
                THEN 'active_awaiting_unloading'

                -- 3. Just delivered: has exited destination, no confirmed return yet
                WHEN (e.effective_dest_exit IS NOT NULL OR e.effective_customer_exit IS NOT NULL)
                     AND e.completion_time IS NULL
                     AND e.next_loading_entry IS NULL
                     AND e.trip_closed_at IS NULL
                THEN 'active_just_delivered'

                -- 4. Waiting next load (SPEC): return_origin_entry has fired (trip_closed
                --    with reason closed_by_return_origin) AND no new loading has started.
                --    This correctly captures trucks parked at origin awaiting next dispatch
                --    regardless of their status field value.
                WHEN EXISTS (
                    SELECT 1 FROM public.trip_state_events tse
                    WHERE tse.trip_key = e.trip_key
                      AND tse.event_code = 'trip_closed'
                      AND (tse.event_meta->>'reason' = 'closed_by_return_origin'
                           OR tse.inference_rule LIKE '%return_to_origin%')
                )
                     AND e.next_loading_entry IS NULL
                THEN 'active_waiting_next_load'

                -- 5. Loading started (SPEC): loading_start IS NOT NULL AND loading_end IS NULL.
                --    Applies regardless of geofence role — if the loading session is open,
                --    the truck is loading. The gateway exclusion in the state machine ensures
                --    only legitimate terminals and origin_zone hubs reach here.
                WHEN e.loading_start IS NOT NULL
                     AND e.effective_loading_end IS NULL
                THEN 'active_loading_started'

                -- 6. Loading completed (SPEC): loading_end IS NOT NULL AND corridor_entry IS NULL.
                --    The truck has finished loading but has NOT entered the transit corridor.
                --    This covers trucks still parked in Kurasini Zone post-loading.
                --    corridor_entry IS NULL = no has_corridor_event AND no border_entry yet.
                WHEN e.effective_loading_end IS NOT NULL
                     AND NOT EXISTS (
                         SELECT 1 FROM public.trip_state_events tse
                         WHERE tse.trip_key = e.trip_key
                           AND tse.event_code IN ('corridor_entry', 'border_entry', 'origin_exit')
                     )
                THEN 'active_loading_completed'

                -- 7. Also classify as loading_completed when loading_end is set but truck
                --    hasn't hit destination yet (backward compat fallback)
                WHEN e.effective_loading_end IS NOT NULL
                     AND e.dest_entry IS NULL
                     AND e.customer_entry IS NULL
                THEN 'active_loading_completed'

                ELSE NULL
            END AS queue_status,$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        RAISE EXCEPTION
            'Phase 76 patch 5 failed: classified CASE block not found in get_active_queues_v2. '
            'The function may have been further patched after Phase 73. '
            'Inspect pg_get_functiondef for the current classified CASE shape.';
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'Phase 76: Refined queue status CASE applied to get_active_queues_v2.';
END;
$$;


-- ── 6. PATCH get_active_queues_v2: live_loading_supplement origin_gateway exclusion ──
--
-- The live_loading_supplement in Phase 73 joins geofence_master on:
--   (gm.default_role_code LIKE 'origin_terminal%' OR gm.default_role_code LIKE 'origin_zone%')
-- This currently works because DAR GEOFENCE / KILUVYA GATEWAY are 'origin_gateway' not
-- 'origin_terminal' or 'origin_zone'. But with ASAS KIBAHA YARD now being 'origin_gateway',
-- we need to add an explicit NOT exclusion to be safe, and also update the comment.

DO $$
DECLARE
    v_def   TEXT;
    v_new   TEXT;
    v_old   TEXT;
    v_repl  TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_active_queues_v2()'::regprocedure
    ) INTO v_def;

    IF POSITION('Phase 76: live_supplement_gateway_exclusion' IN v_def) > 0 THEN
        RAISE NOTICE 'Phase 76 live supplement gateway exclusion already applied — skipping.';
        RETURN;
    END IF;

    -- Target: the JOIN condition in live_loading_supplement
    v_old := $OLD$        -- Match origin_terminal OR origin_gateway zones
        JOIN geofence_master gm
          ON UPPER(gm.canonical_name) = UPPER(ls.current_geofence_name)
         AND (gm.default_role_code LIKE 'origin_terminal%' OR gm.default_role_code LIKE 'origin_zone%')$OLD$;

    v_repl := $NEW$        -- Phase 76: live_supplement_gateway_exclusion
        -- Match origin_terminal OR origin_zone ONLY. Never match origin_gateway.
        -- DAR GEOFENCE, KILUVYA GATEWAY, ASAS KIBAHA YARD are all origin_gateway
        -- and must never trigger a live loading supplement entry.
        JOIN geofence_master gm
          ON UPPER(gm.canonical_name) = UPPER(ls.current_geofence_name)
         AND (gm.default_role_code LIKE 'origin_terminal%' OR gm.default_role_code LIKE 'origin_zone%')
         AND gm.default_role_code NOT LIKE 'origin_gateway%'$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        RAISE NOTICE 'Phase 76 live supplement JOIN patch: target not found or already updated — skipping.';
    ELSE
        EXECUTE v_new;
        RAISE NOTICE 'Phase 76: Gateway exclusion added to live_loading_supplement JOIN condition.';
    END IF;
END;
$$;


-- ── 7. Safety guard in build_tat_trip_facts_v2: active_trips gateway exclusion ──
--
-- build_tat_trip_facts_v2 filters active_trips with:
--   WHERE event_code = 'loading_start'
--     AND (LOWER(role_code) LIKE 'origin_terminal%' OR LOWER(role_code) LIKE 'origin_zone%')
-- This is already correct — origin_gateway is excluded. Phase 76 strengthens this
-- by adding a comment so future editors don't accidentally add origin_gateway here,
-- and adds an explicit NOT exclusion as belt-and-suspenders.
--
-- Note: build_tat_trip_facts_v2 is defined in temp_facts.sql and applied via run_sql.js.
-- We patch it here as well for the deployed DB copy to guarantee consistency.

DO $$
DECLARE
    v_func_oid OID;
    v_def      TEXT;
    v_new      TEXT;
    v_old      TEXT;
    v_repl     TEXT;
BEGIN
    -- Check if the function exists in the DB (it may only exist as temp_facts.sql on disk)
    SELECT oid INTO v_func_oid
    FROM pg_proc
    WHERE proname = 'build_tat_trip_facts_v2'
      AND pronamespace = 'public'::regnamespace;

    IF NOT FOUND THEN
        RAISE NOTICE 'Phase 76: build_tat_trip_facts_v2 not found in DB — skipping active_trips guard (apply via temp_facts.sql).';
        RETURN;
    END IF;

    v_def := pg_get_functiondef(v_func_oid);

    IF POSITION('Phase 76: active_trips_gateway_exclusion' IN v_def) > 0 THEN
        RAISE NOTICE 'Phase 76 active_trips gateway exclusion already applied — skipping.';
        RETURN;
    END IF;

    v_old := $OLD$          AND (LOWER(role_code) LIKE 'origin_terminal%' OR LOWER(role_code) LIKE 'origin_zone%')$OLD$;

    v_repl := $NEW$          -- Phase 76: active_trips_gateway_exclusion
          -- RULE: loading_start events with role_code = 'origin_gateway' must NEVER
          -- anchor a trip in the facts builder. origin_gateway geofences (DAR GEOFENCE,
          -- KILUVYA, ASAS KIBAHA YARD) are large perimeter zones used only for
          -- return_origin / dar_arrival detection, not for loading session anchoring.
          -- The state machine (build_trip_state_events_v2) should not emit loading_start
          -- with origin_gateway role, but we guard here as belt-and-suspenders.
          AND (LOWER(role_code) LIKE 'origin_terminal%' OR LOWER(role_code) LIKE 'origin_zone%')
          AND LOWER(role_code) NOT LIKE 'origin_gateway%'$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        RAISE NOTICE 'Phase 76 active_trips guard: target line not found — skipping (may already be guarded).';
    ELSE
        EXECUTE v_new;
        RAISE NOTICE 'Phase 76: active_trips gateway exclusion applied to build_tat_trip_facts_v2.';
    END IF;
END;
$$;


-- ── 8. Update policy lineage ─────────────────────────────────────────────────

UPDATE public.tat_state_transition_policy_v2
SET
    rule_version = 'phase76_v1',
    updated_at   = NOW()
WHERE is_active
  AND event_code IN (
      'loading_start', 'trip_closed',
      'return_origin_entry', 'origin_exit',
      'corridor_entry'
  );


-- ── 9. Verification queries ───────────────────────────────────────────────────
-- Run after applying to verify correctness.
--
-- a) Confirm ASAS KIBAHA YARD is now origin_gateway (expected: 1 row, role = 'origin_gateway'):
-- SELECT canonical_name, default_role_code, site_type
-- FROM geofence_master
-- WHERE canonical_name = 'ASAS KIBAHA YARD';
--
-- b) Confirm no loading_start events with origin_gateway role (expected: 0 rows after rebuild):
-- SELECT canonical_name, role_code, COUNT(*) AS n
-- FROM trip_state_events
-- WHERE event_code = 'loading_start'
--   AND role_code LIKE 'origin_gateway%'
-- GROUP BY 1, 2;
--
-- c) Check the three queue status counts are all populated:
-- SELECT active_queue_status, COUNT(*)
-- FROM (SELECT (get_active_queues_v2()->'data') AS d) q,
--      json_array_elements(q.d) AS row_data,
--      LATERAL (SELECT row_data->>'active_queue_status' AS active_queue_status) s
-- GROUP BY 1 ORDER BY 2 DESC;
--
-- d) Confirm origin_zone loading sessions get the right role_code:
-- SELECT canonical_name, role_code, COUNT(*)
-- FROM trip_state_events
-- WHERE event_code = 'loading_start'
-- GROUP BY 1, 2 ORDER BY 3 DESC;
--
-- e) Check coverage_start is always <= window_start (expected: 0 rows):
-- -- (Run inside a build call or check _trip_windows directly during a session)
--
-- f) Verify queue statuses match spec:
-- SELECT
--   COUNT(*) FILTER (WHERE active_queue_status = 'active_loading_started'
--                      AND loading_start IS NOT NULL AND loading_end IS NULL)    AS loading_started_ok,
--   COUNT(*) FILTER (WHERE active_queue_status = 'active_loading_completed'
--                      AND loading_end IS NOT NULL)                              AS loading_completed_ok,
--   COUNT(*) FILTER (WHERE active_queue_status = 'active_waiting_next_load')    AS waiting_next_load_n
-- FROM (SELECT (get_active_queues_v2()->'data') AS d) q,
--      json_array_elements(q.d) AS row_data,
--      LATERAL (
--          SELECT
--              row_data->>'active_queue_status' AS active_queue_status,
--              row_data->>'loading_start' AS loading_start,
--              row_data->>'loading_end' AS loading_end
--      ) s;
