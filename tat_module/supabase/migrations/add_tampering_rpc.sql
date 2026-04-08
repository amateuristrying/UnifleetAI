-- RPC to fetch GPS Tampering / Anomaly Events for Visualization
-- Identifies "Impossible Speed" jumps (Teleportation) excluding midnight artifacts.

CREATE OR REPLACE FUNCTION get_tampering_events(
    min_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
    max_date TIMESTAMPTZ DEFAULT NOW(),
    p_limit INT DEFAULT 500
)
RETURNS TABLE (
    tracker_id BIGINT,
    departed_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    gap_minutes FLOAT,
    distance_km FLOAT,
    implied_speed_kmh FLOAT,
    prev_lat FLOAT,
    prev_lng FLOAT,
    new_lat FLOAT,
    new_lng FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER -- Use Security Definer to ensure access
AS $$
BEGIN
    RETURN QUERY
    WITH ordered_stops AS (
        SELECT
            id,
            srs.tracker_id,
            stop_start,
            stop_end,
            stop_lat,
            stop_lng,
            LAG(stop_end) OVER (PARTITION BY srs.tracker_id ORDER BY stop_start) as prev_end,
            LAG(stop_lat) OVER (PARTITION BY srs.tracker_id ORDER BY stop_start) as prev_lat,
            LAG(stop_lng) OVER (PARTITION BY srs.tracker_id ORDER BY stop_start) as prev_lng
        FROM stop_risk_scores srs
        WHERE stop_start >= min_date AND stop_start <= max_date
    ),
    anomalies AS (
        SELECT
            os.id,
            os.tracker_id,
            os.stop_start,
            os.stop_end,
            os.stop_lat,
            os.stop_lng,
            os.prev_end,
            os.prev_lat,
            os.prev_lng,
            EXTRACT(EPOCH FROM (os.stop_start - os.prev_end)) / 60.0 as gap_minutes,
            SQRT(POWER(os.stop_lat - os.prev_lat, 2) + POWER(os.stop_lng - os.prev_lng, 2)) * 111 as dist_km
        FROM ordered_stops os
        WHERE 
            os.prev_end IS NOT NULL
            AND (os.stop_start - os.prev_end) < INTERVAL '1 hour'
    )
    SELECT 
        a.tracker_id,
        a.prev_end as departed_at,
        a.stop_start as arrived_at,
        a.gap_minutes::FLOAT,
        a.dist_km::FLOAT as distance_km,
        (a.dist_km / NULLIF(a.gap_minutes / 60.0, 0))::FLOAT as implied_speed_kmh,
        a.prev_lat::FLOAT,
        a.prev_lng::FLOAT,
        a.stop_lat::FLOAT as new_lat,
        a.stop_lng::FLOAT as new_lng
    FROM anomalies a
    WHERE 
        a.dist_km > 5 -- At least 5km jump
        AND (a.dist_km / NULLIF(a.gap_minutes / 60.0, 0)) > 200 -- Speed > 200 km/h
        -- EXCLUDE Midnight Splits
        AND NOT (
            EXTRACT(HOUR FROM a.prev_end) = 23 AND EXTRACT(MINUTE FROM a.prev_end) >= 55
            OR 
            EXTRACT(HOUR FROM a.stop_start) = 0 AND EXTRACT(MINUTE FROM a.stop_start) <= 5
        )
    ORDER BY implied_speed_kmh DESC
    LIMIT p_limit;
END;
$$;

NOTIFY pgrst, 'reload schema';
