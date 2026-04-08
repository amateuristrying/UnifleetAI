-- 1. Create Index for Performance
CREATE INDEX IF NOT EXISTS idx_stop_risk_scores_start_tracker 
ON stop_risk_scores (stop_start, tracker_id);

-- 2. Update RPC with combined logic (Optimization + Distribution Metrics + Session Gap Fix)
DROP FUNCTION IF EXISTS get_stop_patterns(TIMESTAMPTZ, TIMESTAMPTZ, INT[], INT[], BIGINT, INT[], INT[], INT, INT);

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
    -- NEW: Distribution metrics
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
    -- Increase timeout for complex aggregation (2 minutes)
    SET LOCAL statement_timeout = '120s';

    RETURN QUERY
    WITH filtered_stops AS (
        -- 1. Fetch Raw Stops (Index Scan on stop_start)
        SELECT 
            -- Calculate H3 at Res 9 dynamically
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
          -- Overlap Logic: Ensure stop ends AFTER min_date (so it overlaps the window)
          AND (srs.stop_start + (srs.stop_duration_hours * INTERVAL '1 hour')) >= min_date
          AND (day_filter IS NULL OR EXTRACT(DOW FROM srs.stop_start)::INT = ANY(day_filter))
          AND (hour_filter IS NULL OR EXTRACT(HOUR FROM srs.stop_start)::INT = ANY(hour_filter))
          AND (tracker_id_filter IS NULL OR srs.tracker_id = tracker_id_filter)
          AND (month_filter IS NULL OR EXTRACT(MONTH FROM srs.stop_start)::INT = ANY(month_filter))
          AND (year_filter IS NULL OR EXTRACT(YEAR FROM srs.stop_start)::INT = ANY(year_filter))
    ),
    stops_with_change_flag AS (
        -- 2. Detect Spatial Changes (Gap-and-Island) with Time Gap Check
        SELECT 
            fs.h3_index,
            fs.stop_lat,
            fs.stop_lng,
            fs.risk_score,
            fs.stop_duration_hours,
            fs.tracker_id,
            fs.stop_start,
            fs.ignition_on_percent,
            CASE 
                -- Logic: Partition by Tracker AND Hex.
                -- If time gap < 4h from previous end (in this hex), SAME session (0).
                -- We ignore intervening stops in other hexes, treating each hex's visit history independently.
                WHEN fs.stop_start <= (
                    LAG(fs.stop_start + (fs.stop_duration_hours * INTERVAL '1 hour')) 
                    OVER (PARTITION BY fs.tracker_id, fs.h3_index ORDER BY fs.stop_start) 
                    + INTERVAL '4 hours'
                )
                THEN 0
                ELSE 1 
            END as is_new_visit
        FROM filtered_stops fs
    ),
    stops_with_session AS (
        -- 3. Assign Session ID
        SELECT 
            swc.h3_index,
            swc.stop_lat,
            swc.stop_lng,
            swc.risk_score,
            swc.stop_duration_hours,
            swc.tracker_id,
            swc.stop_start,
            swc.ignition_on_percent,
            swc.is_new_visit,
            -- Session ID must also be partitioned by Hex now
            SUM(swc.is_new_visit) OVER (PARTITION BY swc.tracker_id, swc.h3_index ORDER BY swc.stop_start) as session_id
        FROM stops_with_change_flag swc
    ),
    site_visits AS (
        -- 4. Aggregate into Visits (Sessions)
        SELECT
            sws.h3_index, 
            sws.tracker_id,
            sws.session_id,
            -- Aggregate Metrics for the Visit
            COUNT(*) as stops_in_visit,
            SUM(sws.stop_duration_hours) as visit_duration_hours,
            SUM(sws.stop_duration_hours * (COALESCE(sws.ignition_on_percent, 0) / 100.0)) as visit_engine_on_hours,
            SUM(sws.stop_duration_hours * (1.0 - (COALESCE(sws.ignition_on_percent, 0) / 100.0))) as visit_engine_off_hours,
            AVG(sws.risk_score) as visit_risk_score,
            AVG(sws.stop_lat) as visit_lat,
            AVG(sws.stop_lng) as visit_lng,
            AVG(COALESCE(sws.ignition_on_percent, 0)) as visit_ignition_percent
        FROM stops_with_session sws
        GROUP BY sws.h3_index, sws.tracker_id, sws.session_id
    )
    -- 5. Final Aggregation by H3 Index
    SELECT
        sv.h3_index,
        AVG(sv.visit_lat)::FLOAT as center_lat,
        AVG(sv.visit_lng)::FLOAT as center_lng,
        SUM(sv.stops_in_visit)::BIGINT as stop_count,
        COUNT(*)::BIGINT as visit_count, -- Count of distinct sessions
        COUNT(DISTINCT sv.tracker_id)::BIGINT as unique_trackers,
        AVG(sv.visit_risk_score)::FLOAT as avg_risk_score,
        AVG(sv.visit_duration_hours)::FLOAT as avg_duration_hours,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as p90_duration_hours,
        SUM(sv.visit_duration_hours)::FLOAT as total_dwell_time_hours,
        
        -- Per Tracker Metrics
        (SUM(sv.visit_duration_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_dwell_per_tracker,
        
        -- Per Visit Metrics
        (SUM(sv.visit_duration_hours)::FLOAT / NULLIF(COUNT(*), 0))::FLOAT as avg_dwell_per_visit,
        
        -- Engine Metrics (Per Tracker)
        (SUM(sv.visit_engine_on_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_engine_on_per_tracker,
        (SUM(sv.visit_engine_off_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_engine_off_per_tracker,
        
        -- Efficiency Score
        (COUNT(*)::FLOAT / NULLIF(AVG(sv.visit_duration_hours), 0))::FLOAT as efficiency_score,
        
        AVG(sv.visit_ignition_percent)::FLOAT as avg_ignition_on_percent,
        SUM(sv.visit_engine_on_hours)::FLOAT as total_engine_on_hours,
        SUM(sv.visit_engine_off_hours)::FLOAT as total_engine_off_hours,

        -- Distribution metrics
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

NOTIFY pgrst, 'reload schema';
