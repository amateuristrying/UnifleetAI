-- 1. Enable PostGIS H3 extension if not already enabled (for h3_lat_lng_to_cell)
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;

-- 2. Update Map Logic (get_stop_patterns) to return Resolution 9 Hexes
CREATE OR REPLACE FUNCTION get_stop_patterns(
    min_date TIMESTAMPTZ,
    max_date TIMESTAMPTZ,
    day_filter INT[] DEFAULT NULL,
    hour_filter INT[] DEFAULT NULL,
    tracker_id_filter BIGINT DEFAULT NULL,
    month_filter INT[] DEFAULT NULL,
    year_filter INT[] DEFAULT NULL,
    p_limit INT DEFAULT 1000,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    h3_index TEXT,
    center_lat FLOAT,
    center_lng FLOAT,
    stop_count BIGINT,
    visit_count BIGINT,
    unique_trackers BIGINT,
    avg_risk_score FLOAT,
    avg_duration_hours FLOAT,
    p90_duration_hours FLOAT,
    total_dwell_time_hours FLOAT,
    avg_dwell_per_tracker FLOAT,
    avg_dwell_per_visit FLOAT,
    avg_engine_on_per_tracker FLOAT,
    avg_engine_off_per_tracker FLOAT,
    efficiency_score FLOAT,
    avg_ignition_on_percent FLOAT,
    total_engine_on_hours FLOAT,
    total_engine_off_hours FLOAT,
    p10_duration_hours FLOAT,
    p25_duration_hours FLOAT,
    median_duration_hours FLOAT,
    p75_duration_hours FLOAT,
    min_duration_hours FLOAT,
    max_duration_hours FLOAT,
    stddev_duration_hours FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    SET LOCAL statement_timeout = '120s';

    RETURN QUERY
    WITH filtered_stops AS (
        SELECT 
            -- DYNAMIC CALCULATION: Res 9 (Precision ~170m)
            h3_lat_lng_to_cell(POINT(srs.stop_lng, srs.stop_lat), 9)::text as h3_index,
            srs.stop_lat,
            srs.stop_lng,
            srs.risk_score,
            srs.stop_duration_hours,
            srs.tracker_id,
            srs.stop_start,
            srs.ignition_on_percent
        FROM stop_risk_scores srs
        WHERE srs.stop_start <= max_date
          AND (srs.stop_start + (srs.stop_duration_hours * INTERVAL '1 hour')) >= min_date
          AND (day_filter IS NULL OR EXTRACT(DOW FROM srs.stop_start)::INT = ANY(day_filter))
          AND (hour_filter IS NULL OR EXTRACT(HOUR FROM srs.stop_start)::INT = ANY(hour_filter))
          AND (tracker_id_filter IS NULL OR srs.tracker_id = tracker_id_filter)
          AND (month_filter IS NULL OR EXTRACT(MONTH FROM srs.stop_start)::INT = ANY(month_filter))
          AND (year_filter IS NULL OR EXTRACT(YEAR FROM srs.stop_start)::INT = ANY(year_filter))
    ),
    site_visits AS (
        -- Grouping now strictly observes the new Res 9 index
        SELECT
            fs.h3_index,
            fs.tracker_id,
            COUNT(*) as stops_in_visit,
            SUM(fs.stop_duration_hours) as visit_duration_hours,
            SUM(fs.stop_duration_hours * (COALESCE(fs.ignition_on_percent, 0) / 100.0)) as visit_engine_on_hours,
            SUM(fs.stop_duration_hours * (1.0 - (COALESCE(fs.ignition_on_percent, 0) / 100.0))) as visit_engine_off_hours,
            AVG(fs.risk_score) as visit_risk_score,
            AVG(fs.stop_lat) as visit_lat,
            AVG(fs.stop_lng) as visit_lng,
            AVG(COALESCE(fs.ignition_on_percent, 0)) as visit_ignition_percent
        FROM filtered_stops fs
        GROUP BY fs.h3_index, fs.tracker_id
    )
    SELECT
        sv.h3_index,
        AVG(sv.visit_lat)::FLOAT as center_lat,
        AVG(sv.visit_lng)::FLOAT as center_lng,
        SUM(sv.stops_in_visit)::BIGINT as stop_count,
        COUNT(*)::BIGINT as visit_count,
        COUNT(DISTINCT sv.tracker_id)::BIGINT as unique_trackers,
        AVG(sv.visit_risk_score)::FLOAT as avg_risk_score,
        AVG(sv.visit_duration_hours)::FLOAT as avg_duration_hours,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as p90_duration_hours,
        SUM(sv.visit_duration_hours)::FLOAT as total_dwell_time_hours,
        (SUM(sv.visit_duration_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_dwell_per_tracker,
        (SUM(sv.visit_duration_hours)::FLOAT / NULLIF(COUNT(*), 0))::FLOAT as avg_dwell_per_visit,
        (SUM(sv.visit_engine_on_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_engine_on_per_tracker,
        (SUM(sv.visit_engine_off_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_engine_off_per_tracker,
        (COUNT(*)::FLOAT / NULLIF(AVG(sv.visit_duration_hours), 0))::FLOAT as efficiency_score,
        AVG(sv.visit_ignition_percent)::FLOAT as avg_ignition_on_percent,
        SUM(sv.visit_engine_on_hours)::FLOAT as total_engine_on_hours,
        SUM(sv.visit_engine_off_hours)::FLOAT as total_engine_off_hours,
        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as p10_duration_hours,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as p25_duration_hours,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as median_duration_hours,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as p75_duration_hours,
        MIN(sv.visit_duration_hours)::FLOAT as min_duration_hours,
        MAX(sv.visit_duration_hours)::FLOAT as max_duration_hours,
        COALESCE(STDDEV(sv.visit_duration_hours), 0)::FLOAT as stddev_duration_hours
    FROM site_visits sv
    GROUP BY sv.h3_index
    ORDER BY total_dwell_time_hours DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- 3. Update Report Logic (get_hex_details) to bridge Res 9 Clicks -> Res 7 Data
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
    vehicle_id TEXT,
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
      -- Step 1: Use DB Index (Fast) by grouping into parent Res 7
      vss.h3_index = h3_cell_to_parent(p_h3_index::h3index, 7)::text
      
      -- Step 2: Spatial Check (Accurate) to confirm it falls in the exact Res 9 cell
      AND h3_lat_lng_to_cell(POINT(vss.cluster_lng, vss.cluster_lat), 9)::text = p_h3_index

      AND vss.start_time <= max_date
      AND vss.end_time >= min_date
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
