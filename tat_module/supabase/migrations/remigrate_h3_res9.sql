-- 1. (Skipped) Enable PostGIS H3 extension - Not available in this environment. 
-- Data migration is handled by scripts/update-h3-data.ts

-- 2. (Skipped) Update stop_risk_scores - Data migration is handled by scripts/update-h3-data.ts
-- 3. (Skipped) Update vehicle_stop_sessions - Data migration is handled by scripts/update-h3-data.ts

-- 4. Update get_stop_patterns to use Res 9 and provide correct metrics
-- Merges 'stitching' logic from optimize_stitching.sql with 'distribution metrics' from optimize_stop_patterns.sql
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
    -- Distribution metrics (from optimize_stop_patterns.sql)
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
    -- Increase timeout for complex aggregation (5 minutes)
    SET LOCAL statement_timeout = '300s';

    RETURN QUERY
    WITH filtered_stops AS (
        -- 1. Fetch Raw Stops (Index Scan)
        -- Uses the UPDATED h3_index (Res 9) from the table
        SELECT 
            srs.h3_index,
            srs.stop_lat,
            srs.stop_lng,
            srs.risk_score,
            srs.stop_duration_hours,
            srs.tracker_id,
            srs.stop_start,
            srs.ignition_on_percent,
            -- Calculate approximate end time
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
    -- 2. Detect "Continuity" (Session Stitching - Logic from optimize_stitching.sql)
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
            -- Look at previous stop for this tracker
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
                -- Condition 1: Time Continuity
                -- If current start is within 2 hours of previous end (handle slight gaps)
                WHEN sws.prev_end IS NOT NULL 
                     AND sws.stop_start <= (sws.prev_end + INTERVAL '2 hours')
                     -- Condition 2: Spatial Continuity
                     -- Either same H3 index OR very close (approx < ~200m change in lat/lng)
                     -- 0.002 degrees ~ 220 meters
                     AND (
                        sws.h3_index = sws.prev_h3 
                        OR (ABS(sws.stop_lat - sws.prev_lat) < 0.002 AND ABS(sws.stop_lng - sws.prev_lng) < 0.002)
                     )
                THEN 0 -- It is a continuation (SAME SESSION)
                ELSE 1 -- New Visit
            END as is_new_visit
        FROM stops_with_stitching sws
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
            SUM(swc.is_new_visit) OVER (PARTITION BY swc.tracker_id ORDER BY swc.stop_start) as session_id
        FROM stops_with_change_flag swc
    ),
    site_visits AS (
        -- 4. Aggregate into Visits (Stitched Sessions)
        SELECT
            -- Use the H3 index of the FIRST stop in the session
            (ARRAY_AGG(sws.h3_index ORDER BY sws.stop_start))[1] as h3_index,
            
            sws.tracker_id,
            sws.session_id,
            
            -- Aggregate Metrics for the Visit
            COUNT(*) as stops_in_visit,
            SUM(sws.stop_duration_hours) as visit_duration_hours,
            
            -- Engine calculations
            SUM(sws.stop_duration_hours * (COALESCE(sws.ignition_on_percent, 0) / 100.0)) as visit_engine_on_hours,
            SUM(sws.stop_duration_hours * (1.0 - (COALESCE(sws.ignition_on_percent, 0) / 100.0))) as visit_engine_off_hours,
            
            AVG(sws.risk_score) as visit_risk_score,
            AVG(sws.stop_lat) as visit_lat,
            AVG(sws.stop_lng) as visit_lng,
            AVG(COALESCE(sws.ignition_on_percent, 0)) as visit_ignition_percent
        FROM stops_with_session sws
        GROUP BY sws.tracker_id, sws.session_id
    )
    -- 5. Final Aggregation by H3 Index (of the consolidated visit)
    SELECT
        sv.h3_index,
        AVG(sv.visit_lat)::FLOAT as center_lat,
        AVG(sv.visit_lng)::FLOAT as center_lng,
        SUM(sv.stops_in_visit)::BIGINT as stop_count,
        COUNT(*)::BIGINT as visit_count, -- Count of distinct sessions (now stitched)
        COUNT(DISTINCT sv.tracker_id)::BIGINT as unique_trackers,
        AVG(sv.visit_risk_score)::FLOAT as avg_risk_score,
        AVG(sv.visit_duration_hours)::FLOAT as avg_duration_hours,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY sv.visit_duration_hours)::FLOAT as p90_duration_hours,
        SUM(sv.visit_duration_hours)::FLOAT as total_dwell_time_hours,
        
        -- Per Tracker Metrics
        (SUM(sv.visit_duration_hours)::FLOAT / NULLIF(COUNT(DISTINCT sv.tracker_id), 0))::FLOAT as avg_dwell_per_tracker,
        
        -- Per Visit Metrics
        (SUM(sv.visit_duration_hours)::FLOAT / NULLIF(COUNT(*), 0))::FLOAT as avg_dwell_per_visit,
        
        -- Engine Metrics
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
    HAVING SUM(sv.visit_duration_hours) > 0 -- Sanity check
    ORDER BY total_dwell_time_hours DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- 5. Update get_hex_details to use Res 9 natively
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
      -- Direct Res 9 Match
      vss.h3_index = p_h3_index
      
      -- Date Overlap Logic:
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

NOTIFY pgrst, 'reload schema';
