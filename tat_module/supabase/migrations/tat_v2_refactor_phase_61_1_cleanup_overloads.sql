-- =============================================================
-- TAT V2 REFACTOR: Phase 61.1
-- Cleanup: Resolve Function Overloading for get_tat_trip_details_v2
-- =============================================================

-- 1. Drop all known variations to ensure a clean slate
DROP FUNCTION IF EXISTS public.get_tat_trip_details_v2(timestamptz, timestamptz, integer, integer, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_tat_trip_details_v2(timestamptz, timestamptz, integer, integer, text, text, text, text, text, text, integer);
-- Drop any other variations that might exist (checking signatures from error logs)
DROP FUNCTION IF EXISTS public.get_tat_trip_details_v2(timestamptz, timestamptz, integer, integer, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_tat_trip_details_v2(timestamptz, timestamptz, integer, integer, text, text, text, text, text, integer);

-- 1.2 Stats & Summary Clean (Ensuring no overloads from previous iterative fixes)
DROP FUNCTION IF EXISTS public.get_tat_fleet_stats_v2(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.get_tat_fleet_stats_v2(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_tat_summary_by_destination_v2(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_operational_phases_v2();

-- 2. Re-create the canonical version (from Phase 14)
CREATE OR REPLACE FUNCTION get_tat_trip_details_v2(
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ,
    p_limit       INTEGER  DEFAULT 100,
    p_offset      INTEGER  DEFAULT 0,
    p_trip_type   TEXT     DEFAULT NULL,
    p_status      TEXT     DEFAULT NULL,
    p_search      TEXT     DEFAULT NULL,
    p_sort        TEXT     DEFAULT 'loading_start_desc',
    p_origin      TEXT     DEFAULT NULL,
    p_destination TEXT     DEFAULT NULL,
    p_tracker_id  INTEGER  DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH filtered_trips AS (
        SELECT t.*
        FROM tat_trip_facts_v2 t
        WHERE t.loading_start >= p_start_date
          AND t.loading_start <= p_end_date
          AND (p_trip_type    IS NULL OR t.trip_type        = p_trip_type)
          AND (p_status       IS NULL OR t.status           = p_status)
          AND (p_origin       IS NULL OR t.loading_terminal ILIKE '%' || p_origin      || '%')
          AND (p_destination  IS NULL OR t.destination_name ILIKE '%' || p_destination || '%')
          AND (p_tracker_id   IS NULL OR t.tracker_id       = p_tracker_id)
          AND (
              p_search IS NULL
              OR t.tracker_name     ILIKE '%' || p_search || '%'
              OR t.destination_name ILIKE '%' || p_search || '%'
              OR t.loading_terminal ILIKE '%' || p_search || '%'
              OR t.customer_name    ILIKE '%' || p_search || '%'
          )
    ),
    counts AS (
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed')              AS total_completed,
            COUNT(*) FILTER (WHERE status = 'returning')              AS total_returning,
            COUNT(*) FILTER (WHERE status = 'at_destination')         AS total_at_destination,
            COUNT(*) FILTER (WHERE status = 'in_transit')             AS total_in_transit,
            COUNT(*) FILTER (WHERE status IN (
                'loading','pre_transit','in_transit','at_destination'
            ))                                                        AS total_unfinished,
            COUNT(*) FILTER (WHERE missed_destination = TRUE)         AS total_missed_dest,
            COUNT(*)                                                  AS total_all
        FROM filtered_trips
    ),
    ordered_trips AS (
        SELECT
            t.*,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN p_sort IN ('loading_start_desc', 'newest') THEN t.loading_start END DESC,
                    CASE WHEN p_sort IN ('loading_start_asc',  'oldest') THEN t.loading_start END ASC,
                    CASE WHEN p_sort = 'tat_desc' THEN t.total_tat_hrs END DESC,
                    CASE WHEN p_sort = 'tat_asc'  THEN t.total_tat_hrs END ASC,
                    t.loading_start DESC,
                    t.trip_key DESC
            ) AS sort_ord
        FROM filtered_trips t
    ),
    paged_trips AS (
        SELECT *
        FROM ordered_trips
        WHERE sort_ord > p_offset
        ORDER BY sort_ord
        LIMIT p_limit
    ),
    paged_keys AS (
        SELECT trip_key
        FROM paged_trips
    ),
    border_pivot AS (
        SELECT
            trip_key,
            MIN(entry_time) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'outbound') AS border_tunduma_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'outbound') AS border_tunduma_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'outbound'), 2) AS border_tunduma_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'outbound') AS border_nakonde_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'outbound') AS border_nakonde_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'outbound'), 2) AS border_nakonde_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'outbound') AS border_kasumbalesa_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'outbound') AS border_kasumbalesa_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'outbound'), 2) AS border_kasumbalesa_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'outbound') AS border_sakania_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'outbound') AS border_sakania_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'outbound'), 2) AS border_sakania_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'outbound') AS border_mokambo_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'outbound') AS border_mokambo_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'outbound'), 2) AS border_mokambo_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'outbound') AS border_chembe_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'outbound') AS border_chembe_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'outbound'), 2) AS border_chembe_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'outbound') AS border_kasumulu_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'outbound') AS border_kasumulu_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'outbound'), 2) AS border_kasumulu_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'other'       AND leg_direction = 'outbound') AS border_other_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'other'       AND leg_direction = 'outbound') AS border_other_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'other'       AND leg_direction = 'outbound'), 2) AS border_other_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'return') AS return_border_tunduma_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'return') AS return_border_tunduma_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'return'), 2) AS return_border_tunduma_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'return') AS return_border_nakonde_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'return') AS return_border_nakonde_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'return'), 2) AS return_border_nakonde_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'return') AS return_border_kasumbalesa_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'return') AS return_border_kasumbalesa_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'return'), 2) AS return_border_kasumbalesa_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'return') AS return_border_sakania_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'return') AS return_border_sakania_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'return'), 2) AS return_border_sakania_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'return') AS return_border_mokambo_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'return') AS return_border_mokambo_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'return'), 2) AS return_border_mokambo_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'return') AS return_border_chembe_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'return') AS return_border_chembe_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'return'), 2) AS return_border_chembe_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'return') AS return_border_kasumulu_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'return') AS return_border_kasumulu_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'return'), 2) AS return_border_kasumulu_hrs,
            MIN(entry_time) FILTER (WHERE border_code = 'other'       AND leg_direction = 'return') AS return_border_other_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'other'       AND leg_direction = 'return') AS return_border_other_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'other'       AND leg_direction = 'return'), 2) AS return_border_other_hrs
        FROM tat_trip_border_facts_v2
        WHERE trip_key IN (SELECT trip_key FROM paged_keys)
        GROUP BY trip_key
    ),
    border_crossings_agg AS (
        SELECT
            trip_key,
            json_agg(
                json_build_object(
                    'border_code',    border_code,
                    'border_name',    border_name,
                    'border_family',  border_family,
                    'leg_direction',  leg_direction,
                    'entry_time',     entry_time,
                    'exit_time',      exit_time,
                    'dwell_hrs',      dwell_hrs,
                    'confidence',     event_confidence,
                    'inference_rule', inference_rule
                ) ORDER BY COALESCE(entry_time, exit_time)
            ) AS border_crossings
        FROM tat_trip_border_facts_v2
        WHERE trip_key IN (SELECT trip_key FROM paged_keys)
        GROUP BY trip_key
    ),
    timeline_agg AS (
        SELECT
            trip_key,
            json_agg(
                json_build_object(
                    'event_code',     event_code,
                    'event_time',     event_time,
                    'canonical_name', canonical_name,
                    'role_code',      role_code,
                    'trip_stage',     trip_stage,
                    'leg_direction',  leg_direction,
                    'border_code',    border_code,
                    'border_family',  border_family,
                    'confidence',     event_confidence,
                    'inference_rule', inference_rule
                ) ORDER BY event_time
            ) AS timeline
        FROM trip_state_events
        WHERE trip_key IN (SELECT trip_key FROM paged_keys)
        GROUP BY trip_key
    ),
    final_rows AS (
        SELECT
            t.trip_key,
            t.tracker_id,
            t.tracker_name,
            t.trip_sequence,
            t.loading_terminal,
            t.origin_region,
            t.destination_name,
            t.customer_name,
            t.status         AS trip_status,
            t.closure_reason AS trip_closure_reason,
            t.status,
            t.closure_reason,
            t.trip_type,
            t.lifecycle_confidence,
            t.dar_arrival,
            t.dar_arrival AS origin_arrival,
            t.origin_exit AS dar_exit,
            t.origin_exit,
            t.loading_start,
            t.loading_end,
            t.dest_entry,
            t.dest_exit,
            t.customer_entry,
            t.customer_exit,
            t.customs_entry,
            t.customs_exit,
            t.completion_time,
            t.trip_closed_at,
            t.next_loading_entry,
            t.waiting_for_orders_hrs,
            t.loading_phase_hrs,
            t.post_loading_delay_hrs,
            t.transit_hrs,
            t.border_total_hrs,
            t.outbound_border_total_hrs,
            t.return_border_total_hrs,
            t.outbound_border_count,
            t.return_border_count,
            t.customs_hrs,
            t.destination_dwell_hrs,
            t.customer_dwell_hrs,
            t.return_hrs,
            t.total_tat_hrs,
            t.has_border_event,
            t.has_customs_event,
            t.missed_destination,
            t.has_destination_region_only,
            t.low_confidence_flag,
            t.exception_flags,
            bp.border_tunduma_entry,     bp.border_tunduma_exit,     bp.border_tunduma_hrs,
            bp.border_nakonde_entry,     bp.border_nakonde_exit,     bp.border_nakonde_hrs,
            bp.border_kasumbalesa_entry, bp.border_kasumbalesa_exit, bp.border_kasumbalesa_hrs,
            bp.border_sakania_entry,     bp.border_sakania_exit,     bp.border_sakania_hrs,
            bp.border_mokambo_entry,     bp.border_mokambo_exit,     bp.border_mokambo_hrs,
            bp.border_chembe_entry,      bp.border_chembe_exit,      bp.border_chembe_hrs,
            bp.border_kasumulu_entry,    bp.border_kasumulu_exit,    bp.border_kasumulu_hrs,
            bp.border_other_entry,       bp.border_other_exit,       bp.border_other_hrs,
            bp.return_border_tunduma_entry,     bp.return_border_tunduma_exit,     bp.return_border_tunduma_hrs,
            bp.return_border_nakonde_entry,     bp.return_border_nakonde_exit,     bp.return_border_nakonde_hrs,
            bp.return_border_kasumbalesa_entry, bp.return_border_kasumbalesa_exit, bp.return_border_kasumbalesa_hrs,
            bp.return_border_sakania_entry,     bp.return_border_sakania_exit,     bp.return_border_sakania_hrs,
            bp.return_border_mokambo_entry,     bp.return_border_mokambo_exit,     bp.return_border_mokambo_hrs,
            bp.return_border_chembe_entry,      bp.return_border_chembe_exit,      bp.return_border_chembe_hrs,
            bp.return_border_kasumulu_entry,    bp.return_border_kasumulu_exit,    bp.return_border_kasumulu_hrs,
            bp.return_border_other_entry,       bp.return_border_other_exit,       bp.return_border_other_hrs,
            COALESCE(bca.border_crossings, '[]'::json) AS border_crossings,
            COALESCE(ta.timeline,          '[]'::json) AS timeline
        FROM paged_trips t
        LEFT JOIN border_pivot         bp  ON bp.trip_key  = t.trip_key
        LEFT JOIN border_crossings_agg bca ON bca.trip_key = t.trip_key
        LEFT JOIN timeline_agg         ta  ON ta.trip_key  = t.trip_key
        ORDER BY t.sort_ord
    )
    SELECT json_build_object(
        'total_completed',       c.total_completed,
        'total_returning',       c.total_returning,
        'total_at_destination',  c.total_at_destination,
        'total_in_transit',      c.total_in_transit,
        'total_unfinished',      c.total_unfinished,
        'total_missed_dest',     c.total_missed_dest,
        'total_all',             c.total_all,
        'limit',                 p_limit,
        'offset',                p_offset,
        'data',                  COALESCE((SELECT json_agg(row_to_json(r)) FROM final_rows r), '[]'::json)
    ) INTO v_result
    FROM counts c;

    RETURN v_result;
END $$;


-- 3. Re-create Stats (Latest from Phase 6 Fix)
CREATE OR REPLACE FUNCTION get_tat_fleet_stats_v2(
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'avg_mobilization_hours',   ROUND(AVG(waiting_for_orders_hrs)::NUMERIC, 1),
        'avg_border_wait_hours',    ROUND(AVG(border_total_hrs)::NUMERIC, 1),
        'avg_unloading_hours',      ROUND(AVG(destination_dwell_hrs)::NUMERIC, 1),
        'trip_completion_rate',     ROUND(
            (100.0 * count(*) FILTER (WHERE dest_exit IS NOT NULL))
            / NULLIF(count(*), 0)::NUMERIC, 1
        ),
        'trips_departed',           count(*),
        'trips_completed',          count(*) FILTER (WHERE status IN ('completed','completed_missed_dest')),
        'total_missed_dest',        count(*) FILTER (WHERE missed_destination = true),
        'avg_loading_phase_hours',  ROUND(AVG(loading_phase_hrs)::NUMERIC, 1),
        'avg_transit_hours',        ROUND(AVG(transit_hrs)::NUMERIC, 1),
        'avg_total_tat_hours',      ROUND(AVG(total_tat_hrs)::NUMERIC, 1),
        'pct_long_haul',            ROUND(
            (100.0 * count(*) FILTER (WHERE trip_type = 'long_haul'))
            / NULLIF(count(*), 0)::NUMERIC, 1
        )
    ) INTO v_result
    FROM tat_trip_facts_v2
    WHERE loading_start >= p_start_date
      AND loading_start  <= p_end_date
      AND (p_destination IS NULL OR destination_name = p_destination);

    RETURN v_result;
END $$;


-- 4. Re-create Summary (Latest from Phase 6 Fix)
CREATE OR REPLACE FUNCTION get_tat_summary_by_destination_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_result
    FROM (
        SELECT
            COALESCE(destination_name, customer_name, '(unknown)') AS location,
            count(DISTINCT tracker_id)                  AS unique_trackers,
            count(*)                                    AS trip_count,
            ROUND(AVG(total_tat_hrs) / 24.0, 2)        AS avg_tat_days,
            ROUND(AVG(waiting_for_orders_hrs), 1)       AS avg_waiting_hrs,
            ROUND(AVG(loading_phase_hrs), 1)            AS avg_loading_hrs,
            ROUND(AVG(transit_hrs), 1)                  AS avg_transit_hrs,
            ROUND(AVG(border_total_hrs), 1)             AS avg_border_hrs,
            ROUND(AVG(destination_dwell_hrs), 1)        AS avg_offloading_hrs,
            ROUND(AVG(customer_dwell_hrs), 1)           AS avg_customer_hrs,
            ROUND(
                100.0 * count(*) FILTER (WHERE has_border_event)
                / NULLIF(count(*), 0)::NUMERIC, 1
            )                                           AS pct_with_border,
            ROUND(AVG(lifecycle_confidence)::NUMERIC, 2) AS avg_lifecycle_confidence,
            ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p50_tat_hrs,
            ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p75_tat_hrs,
            ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p90_tat_hrs
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date
          AND loading_start  <= p_end_date
          AND (destination_name IS NOT NULL OR customer_name IS NOT NULL)
          AND dest_exit IS NOT NULL
        GROUP BY COALESCE(destination_name, customer_name, '(unknown)')
        ORDER BY trip_count DESC
    ) r;

    RETURN v_result;
END $$;


-- 5. Re-create Phase Intelligence (Dynamic metadata lookup)
CREATE OR REPLACE FUNCTION get_operational_phases_v2()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT DISTINCT role_code, trip_stage
        FROM geofence_role_map
        WHERE role_code IS NOT NULL
        ORDER BY trip_stage
    ) r;
    RETURN v_result;
END $$;
