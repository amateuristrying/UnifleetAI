-- =============================================================
-- TAT V2 REFACTOR: Phase 70
-- Distinct Destination Intelligence
--
-- Ensures that multi-stop metrics and badges natively evaluate
-- using the count of DISTINCT geofence destinations rather than
-- just counting consecutive raw visits to the same destination.
-- =============================================================

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
        COUNT(DISTINCT d.canonical_name)::INTEGER AS dest_count,
        (ARRAY_AGG(d.canonical_name ORDER BY d.dest_sequence ASC))[1] AS first_dest_name
    FROM public.tat_trip_destination_facts_v2 d
    WHERE d.trip_key = ANY(p_trip_keys)
    GROUP BY d.trip_key;
$$;


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
        -- Require distinct destination names to classify as multi-stop
        HAVING COUNT(DISTINCT canonical_name) > 1
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
