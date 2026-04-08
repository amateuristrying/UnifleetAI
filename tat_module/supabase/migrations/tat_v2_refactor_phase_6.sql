-- Phase 6: Compatibility Read Layer
CREATE OR REPLACE VIEW tat_trips_view_v2 AS
SELECT 
    tracker_id,
    tracker_name,
    loading_start as loading_entry,
    loading_end as loading_exit,
    loading_terminal,
    NULL::TIMESTAMPTZ as next_loading_entry, -- Will be filled by lead() in RPC if needed
    loading_start as dar_arrival, -- Simplified mapping
    origin_exit as dar_exit,
    trip_closed_at as next_dar_entry,
    dest_entry,
    dest_exit,
    destination_name as dest_name,
    has_corridor_event,
    border_entry as border_tunduma_entry, -- Simplified mapping
    border_exit as border_tunduma_exit,
    customs_entry,
    customs_exit,
    customer_name,
    customer_entry,
    customer_exit,
    loading_start,
    loading_end,
    trip_type,
    status,
    lifecycle_confidence,
    closure_reason,
    total_tat_hrs,
    trip_key -- V2 extension
FROM tat_trip_facts_v2;

-- RPC: get_tat_trip_details_v2
CREATE OR REPLACE FUNCTION get_tat_trip_details_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_trip_type TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'tat_desc',
    p_origin TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'total_completed', COUNT(*) FILTER (WHERE status = 'completed'),
        'total_returning', COUNT(*) FILTER (WHERE status = 'returning'),
        'total_unfinished', COUNT(*) FILTER (WHERE status NOT IN ('completed', 'orphaned')),
        'limit', p_limit,
        'offset', p_offset,
        'data', COALESCE(json_agg(row_to_json(res)), '[]'::json)
    ) INTO v_result
    FROM (
        SELECT
            t.trip_key,
            t.tracker_id,
            t.tracker_name,
            t.loading_start as departure_time,
            t.loading_terminal,
            t.dest_name as destination,
            t.customer_name,
            t.status,
            t.trip_type,
            t.total_tat_hrs,
            t.lifecycle_confidence,
            t.closure_reason,
            (
                SELECT json_agg(json_build_object(
                    'event_code', e.event_code,
                    'event_time', e.event_time,
                    'confidence', e.event_confidence
                ) ORDER BY e.event_time)
                FROM trip_state_events e
                WHERE e.trip_key = t.trip_key
            ) as timeline
        FROM tat_trips_view_v2 t
        WHERE t.loading_entry >= p_start_date AND t.loading_entry <= p_end_date
          AND (p_trip_type IS NULL OR t.trip_type = p_trip_type)
          AND (p_status IS NULL OR t.status = p_status)
        ORDER BY t.loading_entry DESC
        LIMIT p_limit OFFSET p_offset
    ) res;

    RETURN v_result;
END $$;
