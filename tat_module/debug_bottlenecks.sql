-- DEBUG: Inspect Aggregated Bottlenecks (matches Map Logic)
-- Run this to see what the map "sees" after aggregation.

SELECT 
    vss.h3_index,
    COUNT(*) as visit_count,
    SUM(vss.duration_hours) as total_dwell_time_hours,
    AVG(vss.duration_hours) as avg_dwell_per_visit,
    
    -- Check if it passes the 24h filter
    CASE WHEN SUM(vss.duration_hours) >= 24 THEN '✅ SHOW' ELSE '❌ HIDE' END as visibility_check,
    
    -- Check stats for the top bottlenecks
    MAX(vss.duration_hours) as max_single_session,
    MIN(vss.start_time) as first_stop,
    MAX(vss.start_time) as last_stop

FROM vehicle_stop_sessions vss
WHERE vss.start_time >= '2025-10-01' -- Matches map default
GROUP BY vss.h3_index
ORDER BY total_dwell_time_hours DESC
LIMIT 50;
