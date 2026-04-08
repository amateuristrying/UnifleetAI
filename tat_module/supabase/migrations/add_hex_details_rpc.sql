-- RPC to fetch detailed visit sessions for a specific H3 Hex
-- REFACTORED: Now queries 'vehicle_stop_sessions' directly for pre-computed, correct session data.

DROP FUNCTION IF EXISTS get_hex_details(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], BIGINT, INT[], INT[], INT, INT);

CREATE OR REPLACE FUNCTION get_hex_details(
    p_h3_index TEXT,
    min_date TIMESTAMPTZ,
    max_date TIMESTAMPTZ,
    day_filter INT[] DEFAULT NULL,
    hour_filter INT[] DEFAULT NULL,
    tracker_id_filter BIGINT DEFAULT NULL,
    month_filter INT[] DEFAULT NULL,
    year_filter INT[] DEFAULT NULL,
    p_limit INT DEFAULT 10000,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    tracker_id BIGINT,
    vehicle_id TEXT, -- Assuming linked or just tracker_id if not
    visit_start TIMESTAMPTZ,
    visit_end TIMESTAMPTZ,
    duration_hours FLOAT,
    engine_on_hours FLOAT,
    engine_off_hours FLOAT,
    ignition_on_percent FLOAT,
    risk_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vss.tracker_id,
        vss.tracker_id::TEXT as vehicle_id,
        vss.start_time as visit_start,
        vss.end_time as visit_end,
        COALESCE(vss.duration_hours, 0)::FLOAT as duration_hours,
        COALESCE(vss.ignition_on_hours, 0)::FLOAT as engine_on_hours,
        COALESCE(vss.ignition_off_hours, 0)::FLOAT as engine_off_hours,
        (CASE 
            WHEN COALESCE(vss.duration_hours, 0) > 0 
            THEN (COALESCE(vss.ignition_on_hours, 0) / vss.duration_hours) * 100 
            ELSE 0 
        END)::FLOAT as ignition_on_percent,
        COALESCE(vss.risk_score, 0)::FLOAT as risk_score
    FROM vehicle_stop_sessions vss
    WHERE 
      -- Optimization: Filter by Parent Res 7 (Stored Index) to use DB Index
      vss.h3_index = h3_cell_to_parent(p_h3_index::h3index, 7)::text
      -- Precision: Verify the specific Res 9 location
      AND h3_lat_lng_to_cell(POINT(vss.cluster_lng, vss.cluster_lat), 9)::text = p_h3_index
      -- Date Overlap Logic:
      -- Session starts before the window ends AND ends after the window starts
      AND vss.start_time <= max_date
      AND vss.end_time >= min_date
      
      -- Optional Filters
      AND (tracker_id_filter IS NULL OR vss.tracker_id = tracker_id_filter)
      AND (day_filter IS NULL OR EXTRACT(DOW FROM vss.start_time)::INT = ANY(day_filter))
      AND (hour_filter IS NULL OR EXTRACT(HOUR FROM vss.start_time)::INT = ANY(hour_filter))
      AND (month_filter IS NULL OR EXTRACT(MONTH FROM vss.start_time)::INT = ANY(month_filter))
      AND (year_filter IS NULL OR EXTRACT(YEAR FROM vss.start_time)::INT = ANY(year_filter))
    ORDER BY vss.start_time DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
