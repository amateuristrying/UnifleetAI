-- DEBUG SCRIPT: Inspect Stop Stitching Logic
-- Run this in your Supabase SQL Editor to see exactly how stops are being processed.

WITH filtered_stops AS (
    SELECT 
        tracker_id,
        stop_start,
        stop_duration_hours,
        h3_index,
        stop_lat,
        stop_lng,
        (stop_start + (stop_duration_hours * INTERVAL '1 hour')) as stop_end
    FROM stop_risk_scores
    WHERE stop_start >= '2025-10-01' -- Focused on your specific data range
    ORDER BY tracker_id, stop_start
    LIMIT 100 -- Look at a sample
),
calc_gaps AS (
    SELECT 
        fs.*,
        LAG(stop_end) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_end,
        LAG(stop_lat) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lat,
        LAG(stop_lng) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lng,
        LAG(h3_index) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_h3
    FROM filtered_stops fs
)
SELECT 
    tracker_id,
    stop_start,
    stop_duration_hours,
    
    -- Debug: Check the Gap
    ROUND(EXTRACT(EPOCH FROM (stop_start - prev_end))::numeric / 3600, 2) as gap_hours,
    CASE WHEN (stop_start - prev_end) <= INTERVAL '2 hours' THEN '✅ OK' ELSE '❌ Gap Too Big' END as time_check,
    
    -- Debug: Check Distance
    ROUND(ABS(stop_lat - prev_lat)::numeric, 5) as lat_diff,
    ROUND(ABS(stop_lng - prev_lng)::numeric, 5) as lng_diff,
    CASE 
        WHEN h3_index = prev_h3 THEN '✅ Same Hex'
        WHEN (ABS(stop_lat - prev_lat) < 0.002 AND ABS(stop_lng - prev_lng) < 0.002) THEN '✅ Close Enough'
        ELSE '❌ Too Far' 
    END as dist_check,
    
    -- Final Decision
    CASE 
        WHEN prev_end IS NOT NULL 
             AND (stop_start - prev_end) <= INTERVAL '2 hours'
             AND (
                h3_index = prev_h3 
                OR (ABS(stop_lat - prev_lat) < 0.002 AND ABS(stop_lng - prev_lng) < 0.002)
             )
        THEN '🔗 STITCH'
        ELSE '🆕 NEW VISIT'
    END as decision

FROM calc_gaps
ORDER BY tracker_id, stop_start;
