-- =============================================================
-- TAT V2 REFACTOR: Phase 60
-- Dynamic Border Analysis
-- Purpose: 
--   1) Provide an RPC to list all active borders from geofence_master.
--   2) Provide a dynamic trend analysis RPC that works for any border_family.
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
        rm.role_code as border_code,
        CASE 
            WHEN gm.canonical_name ILIKE '%tunduma%' THEN 'tunduma_nakonde'
            WHEN gm.canonical_name ILIKE '%nakonde%' THEN 'tunduma_nakonde'
            WHEN gm.canonical_name ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
            WHEN gm.canonical_name ILIKE '%sakania%' THEN 'sakania'
            WHEN gm.canonical_name ILIKE '%mokambo%' THEN 'mokambo'
            WHEN gm.canonical_name ILIKE '%chembe%' THEN 'chembe'
            WHEN gm.canonical_name ILIKE '%kasumulu%' THEN 'kasumulu'
            ELSE LOWER(REPLACE(gm.canonical_name, ' BORDER', ''))
        END as border_family,
        gm.country_code,
        gm.site_type
    FROM geofence_master gm
    JOIN geofence_role_map rm ON rm.geofence_id = gm.geofence_id
    WHERE gm.site_type = 'border'
      AND gm.is_active = TRUE
      AND rm.role_code LIKE 'border_%'
    ORDER BY gm.canonical_name;
$$;

CREATE OR REPLACE FUNCTION get_border_wait_trend_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ,
    p_border_family TEXT DEFAULT NULL,
    p_border_code   TEXT DEFAULT NULL
)
RETURNS TABLE(
    day_date DATE,
    avg_dwell_hrs NUMERIC,
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
            dwell_hrs
        FROM tat_trip_border_facts_v2
        WHERE entry_time >= p_start_date
          AND entry_time <= p_end_date
          AND (p_border_family IS NULL OR border_family = p_border_family)
          AND (p_border_code IS NULL OR border_code = p_border_code)
          AND exit_time IS NOT NULL  -- Only completed crossings for trend
          AND dwell_hrs > 0          -- Filter out data entry anomalies
    )
    SELECT 
        d_date as day_date,
        ROUND(AVG(dwell_hrs), 2) as avg_dwell_hrs,
        COUNT(*)::INTEGER as truck_count
    FROM daily_stats
    GROUP BY d_date
    ORDER BY d_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_borders_v2() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_border_wait_trend_v2(timestamptz, timestamptz, text, text) TO anon, authenticated, service_role;
