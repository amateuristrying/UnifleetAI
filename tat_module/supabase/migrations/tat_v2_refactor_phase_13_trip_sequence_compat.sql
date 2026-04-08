-- tat_v2_refactor_phase_13_trip_sequence_compat.sql
-- Purpose:
--   Fix V2 trip modal RPC failures when tat_trip_facts_v2.trip_sequence
--   is missing in environments that skipped earlier schema patch steps.
--
-- Error addressed:
--   column t.trip_sequence does not exist
--   from get_tat_trip_details_v2

BEGIN;

ALTER TABLE public.tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS trip_sequence INTEGER;

-- Backfill deterministic sequence per tracker using loading_start chronology.
WITH ranked AS (
    SELECT
        trip_key,
        ROW_NUMBER() OVER (
            PARTITION BY tracker_id
            ORDER BY loading_start NULLS LAST, trip_key
        ) AS seq_no
    FROM public.tat_trip_facts_v2
)
UPDATE public.tat_trip_facts_v2 t
SET trip_sequence = r.seq_no
FROM ranked r
WHERE t.trip_key = r.trip_key
  AND (t.trip_sequence IS DISTINCT FROM r.seq_no);

CREATE INDEX IF NOT EXISTS idx_tat_trip_facts_v2_tracker_trip_sequence
    ON public.tat_trip_facts_v2 (tracker_id, trip_sequence);

COMMIT;

