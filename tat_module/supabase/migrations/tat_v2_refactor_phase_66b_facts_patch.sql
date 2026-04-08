-- =============================================================
-- TAT V2 REFACTOR: Phase 66b (v2 — timing fix)
-- Facts Builder Patch — Multi-Destination Aware Metrics
--
-- TIMING FIX: The correction MUST run at the end of
-- build_tat_trip_facts_v2, NOT build_trip_state_events_v2.
-- The state machine runs BEFORE the facts builder, so putting
-- the correction there means it runs when facts don't exist yet.
--
-- Execution order:
--   1. build_trip_state_events_v2  → events + dest facts
--   2. build_tat_trip_facts_v2     → INSERT facts (wrong dwell)
--      └── correct_facts_destination_columns_v2   ← MUST run HERE
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) DDL: Add dest_stop_count to the facts table
-- ─────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS dest_stop_count INTEGER DEFAULT 0;

ALTER TABLE IF EXISTS public.tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS last_dest_exit TIMESTAMPTZ;

ALTER TABLE IF EXISTS public.tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS last_dest_name TEXT;


-- ─────────────────────────────────────────────────────────────
-- 2) Correction function: fixes dest columns in tat_trip_facts_v2
--    using authoritative data from tat_trip_destination_facts_v2
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.correct_facts_destination_columns_v2(
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_corrected INTEGER;
BEGIN
    -- ── Correction: destination columns from dest facts ──────────
    --
    -- The facts builder uses MIN/MAX aggregation on destination events
    -- which breaks when multiple stops exist:
    --   dest_exit = MAX(exit across ALL stops) → wrong for first dest
    --   destination_dwell_hrs = MAX_exit - MIN_entry → spans all stops + gaps
    --
    -- This correction:
    --   1. Sets destination_name from the first stop (seq 1)
    --   2. Sets dest_exit to the first stop's exit (for primary display)
    --   3. Sets destination_dwell_hrs to SUM of individual dwells
    --   4. Sets last_dest_exit to the truly last exit (for return_hrs)
    --   5. Records dest_stop_count
    --   6. Recalculates return_hrs using last_dest_exit

    WITH dest_summary AS (
        SELECT
            d.trip_key,
            -- First destination (sequence 1)
            MIN(d.canonical_name) FILTER (WHERE d.dest_sequence = 1)   AS first_dest_name,
            MIN(d.entry_time)     FILTER (WHERE d.dest_sequence = 1)   AS first_dest_entry,
            MIN(d.exit_time)      FILTER (WHERE d.dest_sequence = 1)   AS first_dest_exit,
            MIN(d.dwell_hrs)      FILTER (WHERE d.dest_sequence = 1)   AS first_dest_dwell,
            -- Last destination with an exit (for return timing)
            (ARRAY_AGG(d.exit_time ORDER BY d.dest_sequence DESC)
                FILTER (WHERE d.exit_time IS NOT NULL))[1]             AS last_exit,
            (ARRAY_AGG(d.canonical_name ORDER BY d.dest_sequence DESC)
                FILTER (WHERE d.exit_time IS NOT NULL))[1]             AS last_name,
            -- Total dwell = sum of individual dwells (NOT span)
            ROUND(SUM(COALESCE(d.dwell_hrs, 0)), 2)                   AS total_dwell_hrs,
            COUNT(*)::INTEGER                                          AS stop_count
        FROM public.tat_trip_destination_facts_v2 d
        GROUP BY d.trip_key
    )
    UPDATE public.tat_trip_facts_v2 f
    SET
        -- First destination name (backward compat for dashboard)
        destination_name      = COALESCE(ds.first_dest_name, f.destination_name),
        -- First destination's exit only (not last stop's exit)
        dest_exit             = COALESCE(ds.first_dest_exit, f.dest_exit),
        -- Sum of individual dwells (not span across stops + gaps)
        destination_dwell_hrs = ds.total_dwell_hrs,
        -- Last destination exit (for return_hrs calculation)
        last_dest_exit        = COALESCE(ds.last_exit, f.dest_exit),
        last_dest_name        = COALESCE(ds.last_name, f.destination_name),
        -- Stop count
        dest_stop_count       = ds.stop_count,
        -- Recalculate return_hrs from LAST dest exit → closure
        return_hrs = CASE
            WHEN ds.last_exit IS NOT NULL THEN
                ROUND(EXTRACT(EPOCH FROM (
                    COALESCE(f.trip_closed_at, f.next_loading_entry, NOW())
                    - ds.last_exit
                )) / 3600.0, 2)
            ELSE f.return_hrs
        END,
        updated_at = NOW()
    FROM dest_summary ds
    WHERE f.trip_key = ds.trip_key
      AND f.loading_start >= p_start
      AND f.loading_start <  p_end
      AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id);

    GET DIAGNOSTICS v_corrected = ROW_COUNT;
    RAISE NOTICE 'Phase 66b: corrected % facts rows with dest columns.', v_corrected;

    -- ── Fix status for trips still at destination ──────────────
    UPDATE public.tat_trip_facts_v2 f
    SET
        status = 'at_destination',
        updated_at = NOW()
    WHERE f.status = 'returning'
      AND f.loading_start >= p_start
      AND f.loading_start <  p_end
      AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id)
      AND f.last_dest_exit IS NULL
      AND f.dest_stop_count > 0
      AND EXISTS (
          SELECT 1
          FROM public.tat_trip_destination_facts_v2 df
          WHERE df.trip_key = f.trip_key
            AND df.is_current = TRUE
      );

END $$;


-- ─────────────────────────────────────────────────────────────
-- 3) Patch build_tat_trip_facts_v2 to call correction function
--    at the END (just before final metrics UPDATE)
--
--    THIS IS THE CRITICAL FIX: the correction runs inside
--    build_tat_trip_facts_v2, AFTER the INSERT, so the facts
--    rows exist when the correction UPDATE runs.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_body TEXT;
    v_marker TEXT;
    v_correction TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_body;

    -- Check if correction is already present
    IF v_body ILIKE '%correct_facts_destination_columns_v2%' THEN
        RAISE NOTICE 'Phase 66b: correction call already present in build_tat_trip_facts_v2 — skipping.';
        RETURN;
    END IF;

    -- Find the final UPDATE tat_refactor_runs marker
    v_marker := 'UPDATE tat_refactor_runs' || E'\n' || '    SET status = ''completed''';

    IF v_body NOT ILIKE '%' || v_marker || '%' THEN
        -- Try alternative formatting
        v_marker := 'UPDATE tat_refactor_runs';
        IF v_body NOT ILIKE '%' || v_marker || '%' THEN
            RAISE EXCEPTION 'Phase 66b: marker not found in build_tat_trip_facts_v2. Cannot patch.';
        END IF;
    END IF;

    v_correction := E'    -- ══ Phase 66b: correct dest columns from dest facts ══════════\n'
        || E'    -- Now that facts are INSERTed, fix destination_name, dest_exit,\n'
        || E'    -- destination_dwell_hrs, and dest_stop_count using the authoritative\n'
        || E'    -- tat_trip_destination_facts_v2 table.\n'
        || E'    PERFORM public.correct_facts_destination_columns_v2(p_start, p_end, p_tracker_id);\n\n    ';

    -- Insert correction JUST BEFORE the final UPDATE tat_refactor_runs
    v_body := REPLACE(v_body, v_marker, v_correction || v_marker);

    EXECUTE v_body;

    RAISE NOTICE 'Phase 66b: patched build_tat_trip_facts_v2 with correction call (after INSERT).';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4) Remove the incorrect correction call from
--    build_trip_state_events_v2 (if it was added by prior 66b)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_body TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_body;

    IF v_body NOT ILIKE '%correct_facts_destination_columns_v2%' THEN
        RAISE NOTICE 'Phase 66b: no stale correction call in build_trip_state_events_v2 — OK.';
        RETURN;
    END IF;

    -- Remove the correction call block
    v_body := REGEXP_REPLACE(
        v_body,
        E'\\s*-- ── Phase 66b: correct facts destination columns ──\\n'
        || E'[^;]*correct_facts_destination_columns_v2[^;]*;\\n*',
        E'\n',
        'g'
    );

    EXECUTE v_body;

    RAISE NOTICE 'Phase 66b: removed stale correction call from build_trip_state_events_v2.';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 5) Also ensure build_tat_trip_facts_v2 INSERT includes
--    the new columns (dest_stop_count, last_dest_exit, last_dest_name)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_body TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_body;

    -- Check if already patched
    IF v_body ILIKE '%dest_stop_count%' THEN
        RAISE NOTICE 'Phase 66b: build_tat_trip_facts_v2 already has dest_stop_count columns — skipping.';
        RETURN;
    END IF;

    -- Add the new columns to the ON CONFLICT SET clause
    v_body := REPLACE(
        v_body,
        'destination_dwell_hrs     = EXCLUDED.destination_dwell_hrs,',
        'destination_dwell_hrs     = EXCLUDED.destination_dwell_hrs,' || E'\n'
        || '        dest_stop_count           = EXCLUDED.dest_stop_count,' || E'\n'
        || '        last_dest_exit            = EXCLUDED.last_dest_exit,' || E'\n'
        || '        last_dest_name            = EXCLUDED.last_dest_name,'
    );

    -- Add the columns to the INSERT column list
    v_body := REPLACE(
        v_body,
        'destination_dwell_hrs,' || E'\n' || '        customer_dwell_hrs',
        'destination_dwell_hrs,' || E'\n'
        || '        dest_stop_count,' || E'\n'
        || '        last_dest_exit,' || E'\n'
        || '        last_dest_name,' || E'\n'
        || '        customer_dwell_hrs'
    );

    -- Add values for the new columns in the SELECT
    -- These will be 0/NULL initially — the correction function fills them
    v_body := REPLACE(
        v_body,
        E'        -- customer_dwell_hrs\n'
        || '        CASE' || E'\n'
        || '            WHEN a.c_entry IS NOT NULL AND a.c_exit IS NOT NULL',
        E'        -- dest_stop_count (set to 0; corrected post-INSERT)\n'
        || '        0,' || E'\n'
        || '        -- last_dest_exit (set to MAX exit; corrected post-INSERT)' || E'\n'
        || '        a.d_exit,' || E'\n'
        || '        -- last_dest_name (placeholder; corrected post-INSERT)' || E'\n'
        || '        a.dest_name,' || E'\n\n'
        || '        -- customer_dwell_hrs' || E'\n'
        || '        CASE' || E'\n'
        || '            WHEN a.c_entry IS NOT NULL AND a.c_exit IS NOT NULL'
    );

    EXECUTE v_body;

    RAISE NOTICE 'Phase 66b: patched build_tat_trip_facts_v2 with new dest columns.';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 6) Backfill: correct ALL existing facts that have dest facts
--    This handles data that was already built before this patch.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_corrected INTEGER;
BEGIN
    WITH dest_summary AS (
        SELECT
            d.trip_key,
            MIN(d.canonical_name) FILTER (WHERE d.dest_sequence = 1)   AS first_dest_name,
            MIN(d.exit_time)      FILTER (WHERE d.dest_sequence = 1)   AS first_dest_exit,
            (ARRAY_AGG(d.exit_time ORDER BY d.dest_sequence DESC)
                FILTER (WHERE d.exit_time IS NOT NULL))[1]             AS last_exit,
            (ARRAY_AGG(d.canonical_name ORDER BY d.dest_sequence DESC)
                FILTER (WHERE d.exit_time IS NOT NULL))[1]             AS last_name,
            ROUND(SUM(COALESCE(d.dwell_hrs, 0)), 2)                   AS total_dwell_hrs,
            COUNT(*)::INTEGER                                          AS stop_count
        FROM public.tat_trip_destination_facts_v2 d
        GROUP BY d.trip_key
    )
    UPDATE public.tat_trip_facts_v2 f
    SET
        destination_name      = COALESCE(ds.first_dest_name, f.destination_name),
        dest_exit             = COALESCE(ds.first_dest_exit, f.dest_exit),
        destination_dwell_hrs = ds.total_dwell_hrs,
        last_dest_exit        = COALESCE(ds.last_exit, f.dest_exit),
        last_dest_name        = COALESCE(ds.last_name, f.destination_name),
        dest_stop_count       = ds.stop_count,
        return_hrs = CASE
            WHEN ds.last_exit IS NOT NULL THEN
                ROUND(EXTRACT(EPOCH FROM (
                    COALESCE(f.trip_closed_at, f.next_loading_entry, NOW())
                    - ds.last_exit
                )) / 3600.0, 2)
            ELSE f.return_hrs
        END,
        updated_at = NOW()
    FROM dest_summary ds
    WHERE f.trip_key = ds.trip_key;

    GET DIAGNOSTICS v_corrected = ROW_COUNT;
    RAISE NOTICE 'Phase 66b backfill: corrected % facts rows.', v_corrected;
END $$;
