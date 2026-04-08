-- =============================================================
-- TAT V2 REFACTOR: Phase 75
-- Closure Priority Restoration + Kurasini Zone Batch Gap Fix
--
-- Root cause found in Phase 66 (full rewrite):
--   The Phase 66 rewrite kept only P1 (return_origin) closure and
--   silently dropped P2 (next_loading) and P3 (timeout). This is
--   the "optimized" logic the system requirements say to REVERT.
--
-- Problems Addressed:
--   1. CLOSURE BUG (Phase 66 regression): P2 (next_loading hard boundary)
--      and P3 (30-day timeout) closures were removed. Trips that never
--      return to origin now never close. Fix: restore all three branches
--      using a UNION ALL whose branches are mutually exclusive by design
--      (P1: return_origin IS NOT NULL; P2: IS NULL + finite window;
--       P3: IS NULL + infinite window + 30d idle).
--
--   2. KURASINI ZONE BATCH GAP: batch loading session builder only
--      anchors at origin_loading_stop (terminal-level). Trucks loading
--      at KURASINI ZONE (origin_zone role) without hitting a specific
--      terminal polygon produce no batch trip_key. Live supplement
--      already covers them via origin_zone% match. Fix: extend
--      _loading_sessions to also capture origin_zone visits when no
--      overlapping origin_loading_stop exists in the same window.
--      No debounce — entry is the trigger (matches live supplement rule).
--
--   3. LIVE→BATCH DUPLICATION: daily_loading_trackers exclusion in
--      Phase 73 only guards active_loading_started. A tracker that
--      progressed to loading_completed before the queue build appears
--      in both classified batch rows and the live supplement.
--      Fix: exclude ALL classified trackers (queue_status IS NOT NULL).
--
--   4. LIVE SUPPLEMENT DEBOUNCE: Phase 73 line 364 adds a 30-minute
--      debounce that delays new loading events by 30 min in the dashboard.
--      Removed — entry into loading zone is the trigger. The guard
--      session_start > loading_end prevents duplicate session detection.
--
-- Priority Rule:
--   P1 return_origin  conf 0.90  (re-entry into origin zone after progression)
--   P2 next_loading   conf 0.80  (next loading session start = hard boundary)
--   P3 timeout_30d    conf 0.50  (30 days of inactivity on open window)
--
--   Hard-boundary guarantee: _trip_context lateral join constrains
--   return_origin_entry < window_end (next_loading_ts), so if both
--   signals exist, P1 always has an earlier timestamp than P2.
--   When next_loading_ts precedes any return-origin, return_origin_entry
--   is NULL → P2 fires. The UNION ALL branches are mutually exclusive.
-- =============================================================

-- ── 1. PATCH build_trip_state_events_v2: Restore P2 + P3 closures ─────────
--
-- Phase 66 is the current full rewrite. Its closure section (12) has
-- only P1 (return_origin). We replace it with a single INSERT ... UNION ALL
-- that restores all three priority branches.
--
-- Branches are mutually exclusive:
--   P1: return_origin_entry IS NOT NULL
--   P2: return_origin_entry IS NULL AND window_end < infinity
--   P3: return_origin_entry IS NULL AND window_end = infinity AND 30d idle
-- So UNION ALL cannot produce duplicates on a clean (post-delete) run.

DO $$
DECLARE
    v_def  TEXT;
    v_new  TEXT;
    v_old  TEXT;
    v_repl TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    -- ── Target: actual live closure block (P1-only, P2/P3 stripped with placeholder) ──
    -- Comment has no em dash and no "return to origin" suffix.
    -- A placeholder comment replaced P2/P3 when the function was manually edited.
    v_old := $OLD$    -- 12) Trip closures
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

    -- ... Additional closure logic (next loading / checkout) preserved ...$OLD$;

    -- ── Replacement: full P1 + P2 + P3 UNION ALL ──────────────────────────
    --
    -- UNION ALL is safe because the WHERE clauses are mutually exclusive:
    --   P1 fires when return_origin_entry IS NOT NULL
    --   P2 fires when return_origin_entry IS NULL AND window_end is finite
    --   P3 fires when return_origin_entry IS NULL AND window_end is infinite + 30d idle
    -- The NOT EXISTS guard on each branch is defensive (e.g. manual reruns).
    v_repl := $NEW$    -- 12) Trip closures — Phase 75 priority chain (P1 → P2 → P3)
    --     Phase 66 only had P1. P2 (next_loading) and P3 (timeout) are restored.
    --     next_loading_ts is the HARD BOUNDARY for the previous trip.
    --     If return_origin occurred after next_loading starts, the lateral
    --     join constraint (visit_start_utc < window_end) ensures return_origin_entry
    --     is NULL, so P2 fires automatically — no explicit priority comparison needed.
    INSERT INTO public.trip_state_events (
        trip_key, tracker_id, tracker_name,
        event_code, event_time,
        event_confidence, inference_rule, event_meta,
        canonical_name, role_code, trip_stage
    )

    -- P1: return to origin (conf 0.90)
    -- return_origin_entry is structurally < window_end (lateral constraint),
    -- so this always precedes P2 when both signals exist.
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'trip_closed', tc.return_origin_entry,
        0.90, 'return_to_origin_priority_p75',
        jsonb_build_object('geofence', tc.return_origin_name, 'reason', 'closed_by_return_origin', 'priority', 'P1'),
        tc.return_origin_name, 'origin_zone', 'returning'
    FROM _trip_context tc
    WHERE tc.return_origin_entry IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.trip_state_events e
          WHERE e.trip_key = tc.trip_key AND e.event_code = 'trip_closed'
      )

    UNION ALL

    -- P2: next loading is the hard boundary (conf 0.80)
    -- Fires only when return_origin_entry IS NULL (truck did not return before
    -- the next loading started). Requires at least one progression signal so
    -- back-to-back loading sessions at the same terminal are not closed early.
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'trip_closed', tc.window_end,
        0.80, 'next_loading_hard_boundary_p75',
        jsonb_build_object('reason', 'closed_by_next_loading', 'hard_boundary', tc.window_end, 'priority', 'P2'),
        NULL, NULL, 'returning'
    FROM _trip_context tc
    WHERE tc.return_origin_entry IS NULL
      AND tc.window_end < 'infinity'::TIMESTAMPTZ
      AND EXISTS (
          SELECT 1 FROM public.trip_state_events e
          WHERE e.trip_key = tc.trip_key
            AND e.event_code IN (
                'destination_entry', 'destination_region_entry',
                'border_entry', 'corridor_entry', 'origin_exit'
            )
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.trip_state_events e
          WHERE e.trip_key = tc.trip_key AND e.event_code = 'trip_closed'
      )

    UNION ALL

    -- P3: inactivity timeout 30 days (conf 0.50)
    -- Fires only for open windows (no next loading detected) where the truck
    -- has been silent for more than 30 days.
    SELECT
        tc.trip_key, tc.tracker_id, tc.tracker_name,
        'trip_closed', last_ev.last_event_time + INTERVAL '30 days',
        0.50, 'timeout_30d_p75',
        jsonb_build_object('reason', 'closed_by_timeout', 'priority', 'P3'),
        NULL, NULL, 'returning'
    FROM _trip_context tc
    JOIN LATERAL (
        SELECT MAX(e.event_time) AS last_event_time
        FROM public.trip_state_events e
        WHERE e.trip_key = tc.trip_key
    ) last_ev ON true
    WHERE tc.return_origin_entry IS NULL
      AND tc.window_end = 'infinity'::TIMESTAMPTZ
      AND last_ev.last_event_time < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
          SELECT 1 FROM public.trip_state_events e
          WHERE e.trip_key = tc.trip_key AND e.event_code = 'trip_closed'
      );$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        IF POSITION('next_loading_hard_boundary_p75' IN v_def) > 0 THEN
            RAISE NOTICE 'Phase 75 closure patch already applied — skipping.';
            v_new := v_def;
        ELSE
            RAISE EXCEPTION
                'Phase 75 patch failed: Phase 66 closure block not found in '
                'build_trip_state_events_v2. The function may have been further '
                'patched after Phase 66. Run: SELECT pg_get_functiondef(''public.'
                'build_trip_state_events_v2(timestamptz,timestamptz,integer)''::regprocedure) '
                'to inspect the current closure block.';
        END IF;
    END IF;

    -- Bump rule version tag for lineage tracking
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat\.current_rule_version'', ''phase[0-9a-z_]+'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase75_v1'', true);',
        'n'
    );

    EXECUTE v_new;
    RAISE NOTICE 'Phase 75: P2+P3 closure branches restored in build_trip_state_events_v2.';
END;
$$;

-- ── 2. PATCH build_trip_state_events_v2: Kurasini Zone loading anchor ─────
--
-- Problem: Trucks that load at KURASINI ZONE (origin_zone geofence) without
-- entering a specific terminal polygon are invisible to the batch loading
-- session builder (which requires stop_state = 'origin_loading_stop').
-- The live supplement covers them via origin_zone% match, but after the
-- batch runs, those live:tracker_id synthetic rows vanish and no real trip
-- key is created — leaving a historical gap.
--
-- Fix: When building _loading_sessions, also include origin_zone visits when
-- no overlapping terminal-level loading stop exists in the same window.
-- NO debounce — entry into a loading zone is the trigger event.

DO $$
DECLARE
    v_def  TEXT;
    v_new  TEXT;
    v_old  TEXT;
    v_repl TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_def;

    -- Target: Phase 66 loading_only CTE (same text as Phase 21)
    v_old := $OLD$    WITH loading_only AS (
        SELECT *
        FROM _ops_visits
        WHERE stop_state = 'origin_loading_stop'
    ),$OLD$;

    v_repl := $NEW$    WITH loading_only AS (
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
    ),$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        IF POSITION('Kurasini Zone extension (Phase 75)' IN v_def) > 0 THEN
            RAISE NOTICE 'Phase 75 Kurasini zone patch already applied — skipping.';
            v_new := v_def;
        ELSE
            RAISE EXCEPTION
                'Phase 75 patch failed: loading_only CTE block not found in '
                'build_trip_state_events_v2 after Phase 75 patch 1 was applied. '
                'Inspect pg_get_functiondef output for the current loading_only shape.';
        END IF;
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'Phase 75: Kurasini Zone loading anchor added to build_trip_state_events_v2.';
END;
$$;

-- ── 3. PATCH get_active_queues_v2: Broaden live supplement exclusion ───────
--
-- daily_loading_trackers only excluded active_loading_started trackers.
-- A tracker that progressed to any other status between live detection and
-- queue build appeared in both classified batch rows and live supplement.
-- Fix: exclude ALL classified trackers (queue_status IS NOT NULL).

DO $$
DECLARE
    v_def  TEXT;
    v_new  TEXT;
    v_old  TEXT;
    v_repl TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_active_queues_v2()'::regprocedure
    ) INTO v_def;

    v_old := $OLD$    daily_loading_trackers AS (
        SELECT tracker_id
        FROM classified
        WHERE queue_status = 'active_loading_started'
    ),$OLD$;

    v_repl := $NEW$    daily_loading_trackers AS (
        -- Phase 75: exclude ALL trackers in the daily rebuild, not just
        -- active_loading_started. A tracker classified as any other status
        -- (e.g. loading_completed) would otherwise appear in both the
        -- classified batch rows and the live_loading_supplement.
        SELECT tracker_id
        FROM classified
        WHERE queue_status IS NOT NULL
    ),$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        IF POSITION('Phase 75: exclude ALL trackers' IN v_def) > 0 THEN
            RAISE NOTICE 'Phase 75 daily_loading_trackers patch already applied — skipping.';
            v_new := v_def;
        ELSE
            RAISE EXCEPTION
                'Phase 75 patch failed: daily_loading_trackers CTE not found in get_active_queues_v2.';
        END IF;
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'Phase 75: daily_loading_trackers broadened in get_active_queues_v2.';
END;
$$;

-- ── 4. PATCH get_active_queues_v2: Remove live supplement debounce ─────────
--
-- Phase 73 line 364 has:
--   AND ls.session_start <= NOW() - INTERVAL '30 minutes'
-- This delays new loading events by 30 min in the live queue.
-- Removed — entry into loading zone is the trigger. The guard
--   AND (lcl.loading_end IS NULL OR ls.session_start > lcl.loading_end)
-- already prevents duplicate session detection.
-- Midnight split at 23:59:59 remains the ONLY gap-bridging logic.

DO $$
DECLARE
    v_def  TEXT;
    v_new  TEXT;
    v_old  TEXT;
    v_repl TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_active_queues_v2()'::regprocedure
    ) INTO v_def;

    v_old := $OLD$          AND (lcl.loading_end IS NULL OR ls.session_start > lcl.loading_end)
          -- Debounce: must be in zone for at least 30 min (not passing through)
          AND ls.session_start <= NOW() - INTERVAL '30 minutes'
          -- Exclude trackers already covered by the daily rebuild$OLD$;

    v_repl := $NEW$          AND (lcl.loading_end IS NULL OR ls.session_start > lcl.loading_end)
          -- Phase 75: 30-min debounce removed — entry into loading zone is
          -- the trigger. session_start > loading_end prevents duplication.
          -- Exclude trackers already covered by the daily rebuild$NEW$;

    v_new := REPLACE(v_def, v_old, v_repl);

    IF v_new = v_def THEN
        IF POSITION('Phase 75: 30-min debounce removed' IN v_def) > 0 THEN
            RAISE NOTICE 'Phase 75 debounce removal already applied — skipping.';
            v_new := v_def;
        ELSE
            RAISE EXCEPTION
                'Phase 75 patch failed: debounce block not found in get_active_queues_v2. '
                'Inspect pg_get_functiondef for the current live_loading_supplement WHERE clause.';
        END IF;
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'Phase 75: 30-min debounce removed from get_active_queues_v2 live_loading_supplement.';
END;
$$;

-- ── 5. Update policy lineage ───────────────────────────────────────────────

UPDATE public.tat_state_transition_policy_v2
SET
    rule_version = 'phase75_v1',
    updated_at   = NOW()
WHERE is_active
  AND event_code IN ('return_origin_entry', 'trip_closed', 'loading_start');

-- ── 6. Verification queries ────────────────────────────────────────────────
-- Run after applying to verify correctness.
--
-- a) No trip should have two trip_closed events (expected: 0 rows):
-- SELECT trip_key, COUNT(*) AS n
-- FROM trip_state_events WHERE event_code = 'trip_closed'
-- GROUP BY trip_key HAVING COUNT(*) > 1;
--
-- b) Count closures by reason — all three should be non-zero after a rebuild:
-- SELECT event_meta->>'reason' AS reason, COUNT(*)
-- FROM trip_state_events WHERE event_code = 'trip_closed'
-- GROUP BY 1 ORDER BY 2 DESC;
--
-- c) Check rule version applied:
-- SELECT proname, prosrc LIKE '%phase75_v1%' AS has_p75
-- FROM pg_proc WHERE proname = 'build_trip_state_events_v2';
