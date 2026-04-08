-- =============================================================
-- TAT V2 REFACTOR: Phase 66d
-- Facts Builder Patch — Open Multi-Destination Fix
--
-- FIX: In trips with multiple destinations where the FINAL
-- destination stop is currently OPEN (truck is still there),
-- the facts builder incorrectly assigned last_dest_exit to the
-- exit time of the *previous* destination. This caused the
-- trip to be marked as 'returning' instead of 'at_destination'
-- (awaiting to unload).
--
-- We ensure that if the highest sequence destination has a NULL
-- exit_time, last_dest_exit correctly evaluates to NULL, and
-- last_dest_name correctly tracks the open facility.
-- =============================================================

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
    WITH dest_summary AS (
        SELECT
            d.trip_key,
            -- First destination (sequence 1)
            MIN(d.canonical_name) FILTER (WHERE d.dest_sequence = 1)   AS first_dest_name,
            MIN(d.entry_time)     FILTER (WHERE d.dest_sequence = 1)   AS first_dest_entry,
            MIN(d.exit_time)      FILTER (WHERE d.dest_sequence = 1)   AS first_dest_exit,
            MIN(d.dwell_hrs)      FILTER (WHERE d.dest_sequence = 1)   AS first_dest_dwell,
            
            -- Last destination (regardless of whether it has an exit_time)
            -- If the final stop is open, exit_time will be NULL, which is CORRECT.
            (ARRAY_AGG(d.exit_time ORDER BY d.dest_sequence DESC))[1]  AS last_exit,
            (ARRAY_AGG(d.canonical_name ORDER BY d.dest_sequence DESC))[1] AS last_name,
            
            -- Total dwell = sum of individual dwells
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
        last_dest_exit        = ds.last_exit, -- Now correctly allows NULL if last stop is open
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
    WHERE f.trip_key = ds.trip_key
      AND f.loading_start >= p_start
      AND f.loading_start <  p_end
      AND (p_tracker_id IS NULL OR f.tracker_id = p_tracker_id);

    GET DIAGNOSTICS v_corrected = ROW_COUNT;
    RAISE NOTICE 'Phase 66d: corrected % facts rows with dest columns.', v_corrected;

    -- ── Fix status for trips still at destination ──────────────
    UPDATE public.tat_trip_facts_v2 f
    SET
        status = 'at_destination',
        updated_at = NOW()
    WHERE f.status IN ('returning', 'completed')
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

-- Run backfill to apply the fix to any open multi-stop trips instantly
DO $$
DECLARE
    v_corrected INTEGER;
BEGIN
    WITH dest_summary AS (
        SELECT
            d.trip_key,
            (ARRAY_AGG(d.exit_time ORDER BY d.dest_sequence DESC))[1]  AS last_exit,
            (ARRAY_AGG(d.canonical_name ORDER BY d.dest_sequence DESC))[1] AS last_name
        FROM public.tat_trip_destination_facts_v2 d
        GROUP BY d.trip_key
    )
    UPDATE public.tat_trip_facts_v2 f
    SET
        last_dest_exit = ds.last_exit,
        last_dest_name = COALESCE(ds.last_name, f.destination_name)
    FROM dest_summary ds
    WHERE f.trip_key = ds.trip_key
      AND f.last_dest_exit IS DISTINCT FROM ds.last_exit;
      
    GET DIAGNOSTICS v_corrected = ROW_COUNT;
    RAISE NOTICE 'Phase 66d backfill: updated % facts rows with open last destinations.', v_corrected;
    
    -- Fix status immediately
    UPDATE public.tat_trip_facts_v2 f
    SET
        status = 'at_destination',
        updated_at = NOW()
    WHERE f.status IN ('returning', 'completed')
      AND f.last_dest_exit IS NULL
      AND f.dest_stop_count > 0
      AND EXISTS (
          SELECT 1
          FROM public.tat_trip_destination_facts_v2 df
          WHERE df.trip_key = f.trip_key
            AND df.is_current = TRUE
      );
END $$;
