-- SQL Query to Detect Potential GPS Tampering (Excluding Midnight Splits)
-- This looks for "Impossible Speed" jumps that happen at random times, suggesting GPS Spoofing/Jamming.

WITH ordered_stops AS (
    SELECT
        id,
        tracker_id,
        stop_start,
        stop_end,
        stop_lat,
        stop_lng,
        -- Get previous stop details
        LAG(stop_end) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_end,
        LAG(stop_lat) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lat,
        LAG(stop_lng) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lng
    FROM stop_risk_scores
    WHERE stop_start > '2025-01-01' -- Search recent history
),
anomalies AS (
    SELECT
        *,
        -- Time Gap in Hours
        EXTRACT(EPOCH FROM (stop_start - prev_end)) / 3600.0 as gap_hours,
        
        -- Distance Gap in Km
        SQRT(POWER(stop_lat - prev_lat, 2) + POWER(stop_lng - prev_lng, 2)) * 111 as dist_km
    FROM ordered_stops
    WHERE 
        prev_end IS NOT NULL
        AND (stop_start - prev_end) < INTERVAL '1 hour' -- Only check short gaps
)
SELECT 
    tracker_id,
    prev_end as departed_at,
    stop_start as arrived_at,
    gap_hours * 60 as travel_minutes,
    ROUND(dist_km::numeric, 2) as distance_km,
    ROUND((dist_km / NULLIF(gap_hours, 0))::numeric, 2) as implied_speed_kmh,
    prev_lat, prev_lng,
    stop_lat, stop_lng
FROM anomalies
WHERE 
    dist_km > 5 -- Moved at least 5km
    AND (dist_km / NULLIF(gap_hours, 0)) > 200 -- Implied speed > 200 km/h (Impossible for truck)
    
    -- EXCLUDE Midnight Splits (System Artifacts)
    AND NOT (
        EXTRACT(HOUR FROM prev_end) = 23 AND EXTRACT(MINUTE FROM prev_end) >= 55
        OR 
        EXTRACT(HOUR FROM stop_start) = 0 AND EXTRACT(MINUTE FROM stop_start) <= 5
    )
ORDER BY implied_speed_kmh DESC;
