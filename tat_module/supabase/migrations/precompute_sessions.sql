-- PRE-COMPUTATION STRATEGY
-- Instead of stitching on-the-fly (expensive), we store the "Stitched Sessions" in a table.
-- The map then just queries this table (cheap).

-- 1. Create the Cache Table
CREATE TABLE IF NOT EXISTS vehicle_stop_sessions (
    session_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tracker_id BIGINT not null,
    h3_index TEXT,
    cluster_lat FLOAT,
    cluster_lng FLOAT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration_hours FLOAT,
    risk_score FLOAT,
    ignition_on_hours FLOAT,
    ignition_off_hours FLOAT,
    stop_count INT,
    
    -- Indexes for fast filtering
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vss_tracker_time ON vehicle_stop_sessions(tracker_id, start_time);
CREATE INDEX IF NOT EXISTS idx_vss_h3 ON vehicle_stop_sessions(h3_index);
CREATE INDEX IF NOT EXISTS idx_vss_time ON vehicle_stop_sessions(start_time);

-- 2. Function to Rebuild the Cache (User runs this once, or nightly)
CREATE OR REPLACE FUNCTION rebuild_stop_sessions(p_min_date TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Clear old data for this range to avoid duplicates (Simplification: Delete all >= p_min_date)
    DELETE FROM vehicle_stop_sessions WHERE start_time >= p_min_date;

    INSERT INTO vehicle_stop_sessions (
        tracker_id, h3_index, cluster_lat, cluster_lng, 
        start_time, end_time, duration_hours, risk_score, 
        ignition_on_hours, ignition_off_hours, stop_count
    )
    WITH raw_stops AS (
        SELECT 
            tracker_id, 
            stop_start,
            stop_duration_hours,
            h3_index,
            stop_lat,
            stop_lng,
            risk_score,
            ignition_on_percent,
            (stop_start + (stop_duration_hours * INTERVAL '1 hour')) as stop_end
        FROM stop_risk_scores
        WHERE stop_start >= p_min_date
    ),
    stitched_steps AS (
        SELECT 
            rs.*,
            -- Look behind for stitching
            LAG(stop_end) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_end,
            LAG(stop_lat) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lat,
            LAG(stop_lng) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lng,
            LAG(h3_index) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_h3
        FROM raw_stops rs
    ),
    session_flags AS (
        SELECT 
            ss.*,
            CASE 
                -- Logic: Time Gap < 2h AND (Same Hex OR Dist < 200m)
                WHEN prev_end IS NOT NULL 
                     AND stop_start <= (prev_end + INTERVAL '2 hours')
                     AND (
                         h3_index = prev_h3
                         OR (ABS(stop_lat - prev_lat) < 0.002 AND ABS(stop_lng - prev_lng) < 0.002)
                     )
                THEN 0
                ELSE 1
            END as is_new
        FROM stitched_steps ss
    ),
    session_groups AS (
        SELECT 
            sf.*,
            SUM(is_new) OVER (PARTITION BY tracker_id ORDER BY stop_start) as session_grp
        FROM session_flags sf
    )
    SELECT
        tracker_id,
        (ARRAY_AGG(h3_index ORDER BY stop_start))[1] as h3_index, -- Take first H3
        AVG(stop_lat) as cluster_lat,
        AVG(stop_lng) as cluster_lng,
        MIN(stop_start) as start_time,
        MAX(stop_end) as end_time,
        SUM(stop_duration_hours) as duration_hours,
        AVG(risk_score) as risk_score,
        SUM(stop_duration_hours * COALESCE(ignition_on_percent, 0) / 100.0) as ignition_on_hours,
        SUM(stop_duration_hours * (1 - COALESCE(ignition_on_percent, 0) / 100.0)) as ignition_off_hours,
        COUNT(*) as stop_count
    FROM session_groups
    GROUP BY tracker_id, session_grp;
    
END;
$$;

-- 3. Update the Map Function to read from Cache
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
    RETURN QUERY
    SELECT
        vss.h3_index,
        AVG(vss.cluster_lat)::FLOAT as center_lat,
        AVG(vss.cluster_lng)::FLOAT as center_lng,
        SUM(vss.stop_count)::BIGINT as stop_count,
        COUNT(*)::BIGINT as visit_count,
        COUNT(DISTINCT vss.tracker_id)::BIGINT as unique_trackers,
        AVG(vss.risk_score)::FLOAT as avg_risk_score,
        AVG(vss.duration_hours)::FLOAT as avg_duration_hours,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY vss.duration_hours)::FLOAT as p90_duration_hours,
        SUM(vss.duration_hours)::FLOAT as total_dwell_time_hours,
        (SUM(vss.duration_hours)::FLOAT / NULLIF(COUNT(DISTINCT vss.tracker_id), 0))::FLOAT as avg_dwell_per_tracker,
        (SUM(vss.duration_hours)::FLOAT / NULLIF(COUNT(*), 0))::FLOAT as avg_dwell_per_visit,
        (SUM(vss.ignition_on_hours)::FLOAT / NULLIF(COUNT(DISTINCT vss.tracker_id), 0))::FLOAT as avg_engine_on_per_tracker,
        (SUM(vss.ignition_off_hours)::FLOAT / NULLIF(COUNT(DISTINCT vss.tracker_id), 0))::FLOAT as avg_engine_off_per_tracker,
        (COUNT(*)::FLOAT / NULLIF(AVG(vss.duration_hours), 0))::FLOAT as efficiency_score,
        AVG(vss.ignition_on_hours / NULLIF(vss.duration_hours, 0) * 100)::FLOAT as avg_ignition_on_percent,
        SUM(vss.ignition_on_hours)::FLOAT as total_engine_on_hours,
        SUM(vss.ignition_off_hours)::FLOAT as total_engine_off_hours
    FROM vehicle_stop_sessions vss
    WHERE vss.start_time >= min_date
      AND vss.start_time <= max_date
      AND (tracker_id_filter IS NULL OR vss.tracker_id = tracker_id_filter)
      -- Optional filters (approximate, since sessions span time)
      AND (day_filter IS NULL OR EXTRACT(DOW FROM vss.start_time)::INT = ANY(day_filter))
      AND (hour_filter IS NULL OR EXTRACT(HOUR FROM vss.start_time)::INT = ANY(hour_filter))
    GROUP BY vss.h3_index
    HAVING SUM(vss.duration_hours) > 0
    ORDER BY total_dwell_time_hours DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
