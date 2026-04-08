-- SQL Script to Auto-Fix "Teleporting" Stops
-- This identifies stops that occur immediately after another stop (< 2 min) but jump a large distance (> 10km)
-- It "snaps" the second stop back to the location of the first stop, assuming it's a continuation of the same dwell event.

WITH ordered_stops AS (
    SELECT
        id,
        tracker_id,
        stop_start,
        stop_end,
        stop_lat,
        stop_lng,
        h3_index,
        -- Get previous stop details
        LAG(stop_end) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_end,
        LAG(stop_lat) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lat,
        LAG(stop_lng) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_lng,
        LAG(h3_index) OVER (PARTITION BY tracker_id ORDER BY stop_start) as prev_h3
    FROM stop_risk_scores
    -- WHERE stop_start > '2025-01-01' -- Comment out to fix ALL history
),
bad_stops AS (
    SELECT 
        id,
        prev_h3,
        prev_lat,
        prev_lng
    FROM ordered_stops
    WHERE 
        prev_end IS NOT NULL
        AND (stop_start - prev_end) < INTERVAL '2 minutes' -- Gap less than 2 minutes
        AND (POWER(stop_lat - prev_lat, 2) + POWER(stop_lng - prev_lng, 2)) > 0.01 -- Approx distance check (> ~10km)
)
UPDATE stop_risk_scores srs
SET 
    -- Fix the location to match the previous stop (snap back)
    stop_lat = bs.prev_lat,
    stop_lng = bs.prev_lng,
    h3_index = bs.prev_h3,
    updated_at = NOW()
FROM bad_stops bs
WHERE srs.id = bs.id;

-- Optional: Verify the fix by selecting again (should return 0 rows)
SELECT count(*) as remaining_bad_rows FROM stop_risk_scores srs
JOIN stop_risk_scores prev ON srs.tracker_id = prev.tracker_id 
    AND prev.stop_end < srs.stop_start 
    AND prev.stop_end > (srs.stop_start - INTERVAL '2 minutes')
WHERE 
    (POWER(srs.stop_lat - prev.stop_lat, 2) + POWER(srs.stop_lng - prev.stop_lng, 2)) > 0.01;
