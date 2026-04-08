
-- RPC to fetch fleet corridors (safe routes)
-- Used for visualization on Security Map

DROP FUNCTION IF EXISTS get_fleet_corridors(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION get_fleet_corridors(
    p_min_visits INTEGER DEFAULT 1,
    p_limit INTEGER DEFAULT 10000
)
RETURNS TABLE (
    h3_index TEXT,
    visit_count INTEGER,
    is_night_route BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT c.h3_index, c.visit_count, c.is_night_route
    FROM fleet_corridors c
    WHERE c.visit_count >= p_min_visits
    ORDER BY c.visit_count DESC
    LIMIT p_limit;
END;
$$;
