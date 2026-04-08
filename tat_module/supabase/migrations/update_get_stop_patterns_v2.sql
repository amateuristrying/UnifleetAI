-- 1. Update get_stop_patterns to use Res 9 and provide correct metrics
DROP FUNCTION IF EXISTS get_stop_patterns(TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], BIGINT, INT[], INT[], INT, INT, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION get_stop_patterns(
    min_date TIMESTAMPTZ,
    max_date TIMESTAMPTZ,
    day_filter INT[] DEFAULT NULL,
    hour_filter INT[] DEFAULT NULL,
    tracker_id_filter BIGINT DEFAULT NULL,
    month_filter INT[] DEFAULT NULL,
    year_filter INT[] DEFAULT NULL,
    p_limit INT DEFAULT 1000,
    p_offset INT DEFAULT 0,
    p_min_duration FLOAT DEFAULT NULL,
    p_max_duration FLOAT DEFAULT NULL
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
    -- Distribution metrics
    p10_duration_hours FLOAT,
    p25_duration_hours FLOAT,
    median_duration_hours FLOAT,
    p75_duration_hours FLOAT,
    min_duration_hours FLOAT,
    max_duration_hours FLOAT,
    stddev_duration_hours FLOAT,
    -- Time of Day Metrics
    morning_visits BIGINT,
    afternoon_visits BIGINT,
    evening_visits BIGINT,
    night_visits BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Increase timeout for complex aggregation (5 minutes)
    SET LOCAL statement_timeout = '300s';

    RETURN QUERY
    WITH filtered_stops AS (
        -- 1. Fetch Raw Stops (Index Scan)
        SELECT 
            srs.h3_index,
            srs.stop_lat,
            srs.stop_lng,
            srs.risk_score,
            srs.stop_duration_hours,
            srs.tracker_id,
            srs.stop_start,
            srs.ignition_on_percent,
            (srs.stop_start + (srs.stop_duration_hours * INTERVAL '1 hour')) as stop_end
        FROM stop_risk_scores srs
        WHERE srs.stop_start >= min_date
          AND srs.stop_start <= max_date
          AND (day_filter IS NULL OR EXTRACT(DOW FROM srs.stop_start)::INT = ANY(day_filter))
          AND (hour_filter IS NULL OR EXTRACT(HOUR FROM srs.stop_start)::INT = ANY(hour_filter))
          AND (tracker_id_filter IS NULL OR srs.tracker_id = tracker_id_filter)
          AND (month_filter IS NULL OR EXTRACT(MONTH FROM srs.stop_start)::INT = ANY(month_filter))
          AND (year_filter IS NULL OR EXTRACT(YEAR FROM srs.stop_start)::INT = ANY(year_filter))
    ),
    -- 2. Detect "Continuity" (Session Stitching)
    stops_with_stitching AS (
        SELECT 
            fs.h3_index,
            fs.stop_lat,
            fs.stop_lng,
            fs.risk_score,
            fs.stop_duration_hours,
            fs.tracker_id,
            fs.stop_start,
            fs.ignition_on_percent,
            fs.stop_end,
            LAG(fs.stop_end) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_end,
            LAG(fs.stop_lat) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_lat,
            LAG(fs.stop_lng) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_lng,
            LAG(fs.h3_index) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_h3
        FROM filtered_stops fs
    ),
    stops_with_change_flag AS (
        SELECT 
            sws.h3_index,
            sws.stop_lat,
            sws.stop_lng,
            sws.risk_score,
            sws.stop_duration_hours,
            sws.tracker_id,
            sws.stop_start,
            sws.ignition_on_percent,
            CASE 
                WHEN sws.prev_end IS NOT NULL 
                     AND sws.stop_start <= (sws.prev_end + INTERVAL '2 hours')
                     AND (
                        sws.h3_index = sws.prev_h3 
                        OR (ABS(sws.stop_lat - sws.prev_lat) < 0.002 AND ABS(sws.stop_lng - sws.prev_lng) < 0.002)
                     )
                THEN 0 ELSE 1
            END as is_new_visit
        FROM stops_with_stitching sws
    ),
    stops_with_session AS (
        SELECT 
            swc.h3_index,
            swc.stop_lat,
            swc.stop_lng,
            swc.risk_score,
            swc.stop_duration_hours,
            swc.tracker_id,
            swc.stop_start,
            swc.ignition_on_percent,
            SUM(swc.is_new_visit) OVER (PARTITION BY swc.tracker_id ORDER BY swc.stop_start) as session_id
        FROM stops_with_change_flag swc
    ),
    site_visits AS (
        SELECT
            (ARRAY_AGG(sws.h3_index ORDER BY sws.stop_start))[1] as h3_index,
            sws.tracker_id,
            sws.session_id,
            MIN(sws.stop_start) as visit_start_time,
            COUNT(*) as stops_in_visit,
            SUM(sws.stop_duration_hours) as visit_duration_hours,
            SUM(sws.stop_duration_hours * (COALESCE(sws.ignition_on_percent, 0) / 100.0)) as visit_engine_on_hours,
            SUM(sws.stop_duration_hours * (1.0 - (COALESCE(sws.ignition_on_percent, 0) / 100.0))) as visit_engine_off_hours,
            AVG(sws.risk_score) as visit_risk_score,
            AVG(sws.stop_lat) as visit_lat,
            AVG(sws.stop_lng) as visit_lng,
            AVG(COALESCE(sws.ignition_on_percent, 0)) as visit_ignition_percent
        FROM stops_with_session sws
        GROUP BY sws.tracker_id, sws.session_id
    )
    -- 5. Final Aggregation
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
        COALESCE(STDDEV(sv.visit_duration_hours), 0)::FLOAT as stddev_duration_hours,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM sv.visit_start_time) >= 6 AND EXTRACT(HOUR FROM sv.visit_start_time) < 12)::BIGINT as morning_visits,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM sv.visit_start_time) >= 12 AND EXTRACT(HOUR FROM sv.visit_start_time) < 18)::BIGINT as afternoon_visits,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM sv.visit_start_time) >= 18 AND EXTRACT(HOUR FROM sv.visit_start_time) < 24)::BIGINT as evening_visits,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM sv.visit_start_time) >= 0 AND EXTRACT(HOUR FROM sv.visit_start_time) < 6)::BIGINT as night_visits
    FROM site_visits sv
    WHERE
        (p_min_duration IS NULL OR sv.visit_duration_hours >= p_min_duration)
        AND (p_max_duration IS NULL OR sv.visit_duration_hours <= p_max_duration)
    GROUP BY sv.h3_index
    HAVING SUM(sv.visit_duration_hours) > 0
    ORDER BY total_dwell_time_hours DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- 2. Update get_hex_details to use Res 9 natively
DROP FUNCTION IF EXISTS get_hex_details(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], BIGINT, INT[], INT[], INT, INT, FLOAT, FLOAT);

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
    p_offset INT DEFAULT 0,
    p_min_duration FLOAT DEFAULT NULL,
    p_max_duration FLOAT DEFAULT NULL
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
    WITH filtered_stops AS (
        SELECT 
            srs.h3_index,
            srs.stop_lat,
            srs.stop_lng,
            srs.risk_score,
            srs.stop_duration_hours,
            srs.tracker_id,
            srs.stop_start,
            srs.ignition_on_percent,
            (srs.stop_start + (srs.stop_duration_hours * INTERVAL '1 hour')) as stop_end
        FROM stop_risk_scores srs
        WHERE srs.stop_start >= min_date
          AND srs.stop_start <= max_date
          AND (day_filter IS NULL OR EXTRACT(DOW FROM srs.stop_start)::INT = ANY(day_filter))
          AND (hour_filter IS NULL OR EXTRACT(HOUR FROM srs.stop_start)::INT = ANY(hour_filter))
          AND (tracker_id_filter IS NULL OR srs.tracker_id = tracker_id_filter)
          AND (month_filter IS NULL OR EXTRACT(MONTH FROM srs.stop_start)::INT = ANY(month_filter))
          AND (year_filter IS NULL OR EXTRACT(YEAR FROM srs.stop_start)::INT = ANY(year_filter))
    ),
    stops_with_stitching AS (
        SELECT 
            fs.*,
            LAG(fs.stop_end) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_end,
            LAG(fs.stop_lat) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_lat,
            LAG(fs.stop_lng) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_lng,
            LAG(fs.h3_index) OVER (PARTITION BY fs.tracker_id ORDER BY fs.stop_start) as prev_h3
        FROM filtered_stops fs
    ),
    stops_with_change_flag AS (
        SELECT 
            sws.*,
            CASE 
                WHEN sws.prev_end IS NOT NULL 
                     AND sws.stop_start <= (sws.prev_end + INTERVAL '2 hours')
                     AND (
                        sws.h3_index = sws.prev_h3 
                        OR (ABS(sws.stop_lat - sws.prev_lat) < 0.002 AND ABS(sws.stop_lng - sws.prev_lng) < 0.002)
                     )
                THEN 0 ELSE 1
            END as is_new_visit
        FROM stops_with_stitching sws
    ),
    stops_with_session AS (
        SELECT 
            swc.*,
            SUM(swc.is_new_visit) OVER (PARTITION BY swc.tracker_id ORDER BY swc.stop_start) as session_id
        FROM stops_with_change_flag swc
    ),
    stitched_visits AS (
        SELECT
            sws.tracker_id,
            sws.session_id,
            (ARRAY_AGG(sws.h3_index ORDER BY sws.stop_start))[1] as visit_h3,
            MIN(sws.stop_start) as start_time,
            MAX(sws.stop_end) as end_time,
            SUM(sws.stop_duration_hours) as duration_hours,
            SUM(sws.stop_duration_hours * (COALESCE(sws.ignition_on_percent, 0) / 100.0)) as engine_on_hours,
            SUM(sws.stop_duration_hours * (1.0 - (COALESCE(sws.ignition_on_percent, 0) / 100.0))) as engine_off_hours,
            AVG(sws.risk_score) as risk_score
        FROM stops_with_session sws
        GROUP BY sws.tracker_id, sws.session_id
    )
    SELECT
        sv.tracker_id,
        sv.tracker_id::TEXT as vehicle_id,
        sv.start_time as visit_start,
        sv.end_time as visit_end,
        sv.duration_hours::FLOAT,
        sv.engine_on_hours::FLOAT,
        sv.engine_off_hours::FLOAT,
        (CASE 
            WHEN sv.duration_hours > 0 
            THEN (sv.engine_on_hours / sv.duration_hours) * 100 
            ELSE 0 
        END)::FLOAT as ignition_on_percent,
        sv.risk_score::FLOAT
    FROM stitched_visits sv
    WHERE sv.visit_h3 = p_h3_index -- Filter AFTER stitching
      AND (p_min_duration IS NULL OR sv.duration_hours >= p_min_duration)
      AND (p_max_duration IS NULL OR sv.duration_hours <= p_max_duration)
    ORDER BY sv.start_time DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

NOTIFY pgrst, 'reload schema';
