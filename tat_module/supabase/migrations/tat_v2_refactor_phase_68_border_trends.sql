-- =============================================================
-- TAT V2 REFACTOR: Phase 68
-- Advanced Borders API & Dual Trend Analysis
--
-- 1) Fixes 'get_active_borders_v2' to use the new exact mapping
--    from 'resolve_border_code' instead of relying on role_code.
-- 2) Upgrades trend query to split dwell_hrs into Outbound and Return
--    so the UI can visualize directionality.
-- =============================================================

CREATE OR REPLACE FUNCTION get_active_borders_v2()
RETURNS TABLE(
    canonical_name TEXT,
    border_code TEXT,
    border_family TEXT,
    country_code TEXT,
    site_type TEXT
) 
LANGUAGE sql STABLE 
SECURITY DEFINER SET search_path = public
AS $$
    SELECT 
        gm.canonical_name,
        rb.border_code,
        rb.border_family,
        COALESCE(rb.country_code, gm.country_code) AS country_code,
        gm.site_type
    FROM geofence_master gm
    JOIN geofence_role_map rm ON rm.geofence_id = gm.geofence_id
    CROSS JOIN LATERAL resolve_border_code(gm.canonical_name) rb
    WHERE gm.site_type = 'border'
      AND gm.is_active = TRUE
      AND (rm.role_code LIKE 'border_%' OR gm.canonical_name ILIKE '%asas chapwa%')
    ORDER BY gm.canonical_name;
$$;

DROP FUNCTION IF EXISTS get_border_wait_trend_v2(timestamptz, timestamptz, text, text);

CREATE OR REPLACE FUNCTION get_border_wait_trend_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ,
    p_border_family TEXT DEFAULT NULL,
    p_border_code   TEXT DEFAULT NULL
)
RETURNS TABLE(
    day_date DATE,
    avg_outbound_dwell_hrs NUMERIC,
    avg_return_dwell_hrs NUMERIC,
    truck_count INTEGER
)
LANGUAGE plpgsql STABLE 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH daily_stats AS (
        SELECT 
            entry_time::date as d_date,
            leg_direction,
            dwell_hrs
        FROM tat_trip_border_facts_v2
        WHERE entry_time >= p_start_date
          AND entry_time <= p_end_date
          AND (p_border_family IS NULL OR border_family = p_border_family)
          AND (p_border_code IS NULL OR border_code = p_border_code)
          AND exit_time IS NOT NULL
          AND dwell_hrs > 0
    )
    SELECT 
        d_date as day_date,
        -- Aggregate exclusively for Outbound
        ROUND(COALESCE(AVG(dwell_hrs) FILTER (WHERE leg_direction = 'outbound'), 0), 2) as avg_outbound_dwell_hrs,
        -- Aggregate exclusively for Return
        ROUND(COALESCE(AVG(dwell_hrs) FILTER (WHERE leg_direction = 'return'), 0), 2) as avg_return_dwell_hrs,
        COUNT(*)::INTEGER as truck_count
    FROM daily_stats
    GROUP BY d_date
    ORDER BY d_date;
END;
$$;

-- Ensure grants remain intact
GRANT EXECUTE ON FUNCTION public.get_active_borders_v2() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_border_wait_trend_v2(timestamptz, timestamptz, text, text) TO anon, authenticated, service_role;
