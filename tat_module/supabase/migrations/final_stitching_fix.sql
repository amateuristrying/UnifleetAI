-- Definitive Performance Fix for Stop Stitching
-- 1. Force cleanup of old indexes/functions to ensure clean state
-- 2. Create the OPTIMAL index for the stitching window functions
-- 3. Re-define function with 5-minute timeout

-- DROP Index if it exists (to force re-creation)
DROP INDEX IF EXISTS idx_stop_risk_scores_tracker_start;

-- CREATE Optimized Index (Critical for the PARTITION BY tracker_id ORDER BY stop_start)
CREATE INDEX idx_stop_risk_scores_tracker_start 
ON stop_risk_scores (tracker_id, stop_start);

-- Re-define Function
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
    total_engine_off_hours FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Set generous timeout (300s = 5 minutes)
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
                -- If gap < 2h AND (same hex OR < ~200m)
                WHEN sws.prev_end IS NOT NULL 
                     AND sws.stop_start <= (sws.prev_end + INTERVAL '2 hours')
                     AND (
                        sws.h3_index = sws.prev_h3 
                        OR (ABS(sws.stop_lat - sws.prev_lat) < 0.002 AND ABS(sws.stop_lng - sws.prev_lng) < 0.002)
                     )
                THEN 0 
                ELSE 1 
            END as is_new_visit
        FROM stops_with_stitching sws
    ),
    stops_with_session AS (
        SELECT 
            swc.*,
            SUM(swc.is_new_visit) OVER (PARTITION BY swc.tracker_id ORDER BY swc.stop_start) as session_id
        FROM stops_with_change_flag swc
    ),
    site_visits AS (
        SELECT
            (ARRAY_AGG(sws.h3_index ORDER BY sws.stop_start))[1] as h3_index,
            sws.tracker_id,
            sws.session_id,
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
        SUM(sv.visit_engine_off_hours)::FLOAT as total_engine_off_hours
    FROM site_visits sv
    GROUP BY sv.h3_index
    HAVING SUM(sv.visit_duration_hours) > 0 
    ORDER BY total_dwell_time_hours DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
