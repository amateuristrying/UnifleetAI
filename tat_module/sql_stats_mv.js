const fs = require('fs');

const sql = `
-- =============================================================
-- Fleet KPI Stats for TAT Dashboard (Reading from Materialized View)
-- =============================================================
DROP FUNCTION IF EXISTS get_tat_fleet_stats(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS get_tat_fleet_stats(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION get_tat_fleet_stats(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
    v_trips_departed BIGINT;
    v_trips_completed BIGINT;
    v_avg_waiting NUMERIC;
    v_avg_transit_to_load NUMERIC;
    v_avg_loading NUMERIC;
    v_avg_border NUMERIC;
    v_avg_offloading NUMERIC;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE t.dest_exit IS NOT NULL)
    INTO v_trips_departed, v_trips_completed
    FROM tat_trips_view t
    WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    SELECT COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (t.loading_start - t.dar_arrival))/3600.0
    )::numeric, 1), 0) INTO v_avg_waiting
    FROM tat_trips_view t
    WHERE t.dar_arrival IS NOT NULL
      AND t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    -- 2. Transit to loading terminal is part of Wait in MV simplification. Skipping separate logic.
    v_avg_transit_to_load := 0;

    SELECT COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (t.loading_end - t.loading_start))/3600.0
    )::numeric, 1), 0) INTO v_avg_loading
    FROM tat_trips_view t
    WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    -- 4. Border Tunduma/Kasumbalesa
    SELECT COALESCE(ROUND(
        (
            COALESCE(AVG(EXTRACT(EPOCH FROM (t.border_tunduma_exit - t.border_tunduma_entry))), 0) +
            COALESCE(AVG(EXTRACT(EPOCH FROM (t.border_kasumbalesa_exit - t.border_kasumbalesa_entry))), 0)
        ) / 3600.0
    ::numeric, 1), 0) INTO v_avg_border
    FROM tat_trips_view t
    WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination)
      AND (t.border_tunduma_entry IS NOT NULL OR t.border_kasumbalesa_entry IS NOT NULL);

    -- 5. Offloading Time (Destination Dwell)
    SELECT COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0
    )::numeric, 1), 0) INTO v_avg_offloading
    FROM tat_trips_view t
    WHERE t.dest_entry IS NOT NULL AND t.dest_exit IS NOT NULL
      AND t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    v_result := json_build_object(
        'avg_mobilization_hours', v_avg_waiting,       -- using waiting for orders as mobilization metric
        'avg_border_wait_hours', v_avg_border,         
        'avg_unloading_hours', v_avg_offloading,       -- newly tracked
        'trip_completion_rate', CASE WHEN v_trips_departed > 0 THEN ROUND((v_trips_completed::NUMERIC / v_trips_departed) * 100, 1) ELSE 0 END,
        'trips_departed', v_trips_departed,
        'trips_completed', v_trips_completed
    );

    RETURN v_result;
END;
$$;
`;

fs.appendFileSync('supabase/migrations/tat_optimization_mv_only.sql', sql);
