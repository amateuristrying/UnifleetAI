-- =============================================================
-- TAT V2 REFACTOR: Phase 66c (v2 — safe orphan cleanup)
--
-- CRITICAL FIX: The v1 auto-cleanup inside build_trip_state_events_v2
-- deleted VALID trips because Phase 66 generates DIFFERENT trip keys
-- than older phases. Comparing against _trip_windows is unreliable.
--
-- v2 approach:
--   1. REMOVE the auto-cleanup from build_trip_state_events_v2
--   2. Use a STANDALONE function that detects sibling pairs
--      (same tracker, loading_start < 6h apart) and removes the
--      weaker sibling (fewer dest facts, or 0 dest_stop_count).
--   3. Always dry-run first.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) Remove the auto-cleanup from build_trip_state_events_v2
--    (if it was injected by Phase 66c v1)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_body TEXT;
    v_cleaned TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_body;

    IF v_body NOT ILIKE '%_orphan_trip_keys%' THEN
        RAISE NOTICE 'Phase 66c v2: no auto-cleanup found in build_trip_state_events_v2 — OK.';
        RETURN;
    END IF;

    -- Remove everything from "Phase 66c: Orphan Trip Key Cleanup" block
    -- through the orphan RAISE NOTICE line, leaving the original step 4 intact.
    v_cleaned := REGEXP_REPLACE(
        v_body,
        E'\\s*-- ═+\\n\\s*-- Phase 66c: Orphan Trip Key Cleanup[\\s\\S]*?RAISE NOTICE ''Phase 66c: cleaned up.*?;\\n\\n\\s*-- 4\\) Cleanup events for rebuilt trips \\(Phase 66 original step\\)\\n\\s*',
        E'\n    ',
        'g'
    );

    IF v_cleaned = v_body THEN
        -- Fallback: try simpler pattern
        v_cleaned := REGEXP_REPLACE(
            v_body,
            E'CREATE TEMP TABLE _orphan_trip_keys[\\s\\S]*?RAISE NOTICE ''Phase 66c: cleaned up[^;]*;\\n\\n\\s*-- 4\\)[^\\n]*\\n\\s*',
            '',
            'g'
        );
    END IF;

    IF v_cleaned = v_body THEN
        RAISE NOTICE 'Phase 66c v2: could not auto-remove orphan block. Manual review may be needed.';
        RETURN;
    END IF;

    EXECUTE v_cleaned;
    RAISE NOTICE 'Phase 66c v2: removed dangerous auto-cleanup from build_trip_state_events_v2.';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 2) Safe standalone orphan cleanup function
--    Uses sibling pair detection (NOT _trip_windows comparison)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_orphan_trip_keys_v2(
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL,
    p_dry_run    BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    orphan_trip_key  TEXT,
    tracker_id       INTEGER,
    loading_start    TIMESTAMPTZ,
    sibling_trip_key TEXT,
    orphan_reason    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- ═══════════════════════════════════════════════════════════
    -- Strategy: Find sibling pairs — two trip keys for the same
    -- tracker with loading_start < 6h apart. These represent
    -- the same physical loading session detected differently
    -- by different phase versions.
    --
    -- The ORPHAN is determined by:
    --   1. dest_stop_count = 0 while sibling has > 0  →  orphan
    --   2. If both have dest_stop_count = 0, fewer events  →  orphan
    --   3. If both have dest_stop_count > 0, keep both (not siblings)
    --   4. If equal events, later loading_start  →  orphan
    -- ═══════════════════════════════════════════════════════════

    CREATE TEMP TABLE _sibling_analysis ON COMMIT DROP AS
    WITH trip_summaries AS (
        SELECT
            f.trip_key,
            f.tracker_id,
            f.loading_start,
            f.dest_stop_count,
            f.destination_name,
            f.destination_dwell_hrs,
            f.status,
            (SELECT count(*) FROM public.trip_state_events se
             WHERE se.trip_key = f.trip_key) AS event_count
        FROM public.tat_trip_facts_v2 f
        WHERE f.loading_start >= p_start
          AND f.loading_start <  p_end
          AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
    ),
    -- Detect sibling pairs: same tracker, loading_start < 6h gap
    with_next AS (
        SELECT
            ts.*,
            LEAD(ts.trip_key) OVER w         AS next_trip_key,
            LEAD(ts.loading_start) OVER w    AS next_loading_start,
            LEAD(ts.dest_stop_count) OVER w  AS next_dest_stop_count,
            LEAD(ts.event_count) OVER w      AS next_event_count,
            LEAD(ts.destination_name) OVER w AS next_destination_name
        FROM trip_summaries ts
        WINDOW w AS (PARTITION BY ts.tracker_id ORDER BY ts.loading_start, ts.trip_key)
    ),
    sibling_pairs AS (
        SELECT *
        FROM with_next
        WHERE next_trip_key IS NOT NULL
          AND EXTRACT(EPOCH FROM (next_loading_start - loading_start)) < 21600
    )
    SELECT
        -- Determine which one is the orphan
        CASE
            -- Rule 1: If one has dest facts and the other doesn't, orphan has 0
            WHEN COALESCE(sp.dest_stop_count, 0) > 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                THEN sp.next_trip_key
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) > 0
                THEN sp.trip_key
            -- Rule 2: Both have 0 dest facts — orphan has fewer events
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                 AND sp.event_count >= sp.next_event_count
                THEN sp.next_trip_key
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                 AND sp.event_count < sp.next_event_count
                THEN sp.trip_key
            -- Rule 3: Both have dest facts — keep both (not really orphans)
            ELSE NULL
        END AS orphan_key,
        CASE
            WHEN COALESCE(sp.dest_stop_count, 0) > 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                THEN sp.trip_key
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) > 0
                THEN sp.next_trip_key
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                 AND sp.event_count >= sp.next_event_count
                THEN sp.trip_key
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                 AND sp.event_count < sp.next_event_count
                THEN sp.next_trip_key
            ELSE NULL
        END AS keeper_key,
        sp.tracker_id,
        -- Orphan's loading_start
        CASE
            WHEN COALESCE(sp.dest_stop_count, 0) > 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                THEN sp.next_loading_start
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) > 0
                THEN sp.loading_start
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                 AND sp.event_count >= sp.next_event_count
                THEN sp.next_loading_start
            ELSE sp.loading_start
        END AS orphan_ls,
        -- Reason
        CASE
            WHEN COALESCE(sp.dest_stop_count, 0) > 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                THEN 'sibling has dest_facts, orphan has none'
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) > 0
                THEN 'sibling has dest_facts, orphan has none'
            WHEN COALESCE(sp.dest_stop_count, 0) = 0 AND COALESCE(sp.next_dest_stop_count, 0) = 0
                THEN 'both lack dest_facts, orphan has fewer events'
            ELSE 'both have dest_facts — skipping'
        END AS reason
    FROM sibling_pairs sp;

    -- Remove NULL entries (both have dest facts — keep both)
    DELETE FROM _sibling_analysis WHERE orphan_key IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF p_dry_run THEN
        RAISE NOTICE '══ Phase 66c DRY RUN ══';
        RAISE NOTICE 'Found % orphan trip keys to clean up.', 
            (SELECT count(*) FROM _sibling_analysis);
        RAISE NOTICE 'Re-run with p_dry_run := FALSE to execute deletions.';

        RETURN QUERY
        SELECT
            sa.orphan_key,
            sa.tracker_id,
            sa.orphan_ls,
            sa.keeper_key,
            sa.reason
        FROM _sibling_analysis sa
        ORDER BY sa.tracker_id, sa.orphan_ls;
        RETURN;
    END IF;

    -- ── Execute cascade deletions ────────────────────────────
    DELETE FROM public.tat_trip_destination_facts_v2
    WHERE trip_key IN (SELECT sa.orphan_key FROM _sibling_analysis sa);

    DELETE FROM public.tat_trip_border_facts_v2
    WHERE trip_key IN (SELECT sa.orphan_key FROM _sibling_analysis sa);

    DELETE FROM public.tat_trip_facts_v2
    WHERE trip_key IN (SELECT sa.orphan_key FROM _sibling_analysis sa);

    DELETE FROM public.trip_state_events
    WHERE trip_key IN (SELECT sa.orphan_key FROM _sibling_analysis sa);

    RAISE NOTICE '══ Phase 66c CLEANUP COMPLETE ══';
    RAISE NOTICE 'Deleted % orphan trip keys from all tables.',
        (SELECT count(*) FROM _sibling_analysis);

    RETURN QUERY
    SELECT
        sa.orphan_key,
        sa.tracker_id,
        sa.orphan_ls,
        sa.keeper_key,
        sa.reason
    FROM _sibling_analysis sa
    ORDER BY sa.tracker_id, sa.orphan_ls;

END $$;
