-- tat_v2_backfill_trip_sequence.sql
-- Standalone function to assign global trip_sequence ordinals per tracker.
-- Called ONCE after all Phase 3 chunks complete (not inside per-chunk function
-- because the global RANK() scan times out under Management API role timeout).

CREATE OR REPLACE FUNCTION backfill_trip_sequence_v2()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- trip_sequence = ordinal rank of this trip within the tracker's all-time history,
    -- ordered by the loading_start event time.
    UPDATE trip_state_events e
    SET trip_sequence = seq.seq
    FROM (
        SELECT
            trip_key,
            RANK() OVER (
                PARTITION BY tracker_id
                ORDER BY MIN(CASE WHEN event_code = 'loading_start' THEN event_time END)
                         NULLS LAST,
                         MIN(event_time)
            ) AS seq
        FROM trip_state_events
        GROUP BY trip_key, tracker_id
    ) seq
    WHERE e.trip_key = seq.trip_key;

    RAISE NOTICE 'backfill_trip_sequence_v2: updated % rows', (
        SELECT COUNT(*) FROM trip_state_events WHERE trip_sequence IS NOT NULL
    );
END;
$$;
