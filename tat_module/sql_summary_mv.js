const fs = require('fs');

const sql = `
-- =============================================================
-- Summary by Destination for TAT Dashboard (Reading from MV)
-- =============================================================
DROP FUNCTION IF EXISTS get_tat_summary_by_destination(TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION get_tat_summary_by_destination(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(res) ORDER BY trip_count DESC) INTO v_result
    FROM (
        SELECT 
            t.dest_name as location,
            COUNT(*) as trip_count,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.loading_start - t.dar_arrival))/3600.0)::numeric, 1), 0) as avg_waiting_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.loading_end - t.loading_start))/3600.0)::numeric, 1), 0) as avg_loading_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.dest_entry - t.loading_end))/3600.0)::numeric, 1), 0) as avg_transit_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (
                COALESCE(t.border_tunduma_exit, t.border_kasumbalesa_exit) - 
                COALESCE(t.border_tunduma_entry, t.border_kasumbalesa_entry)
            ))/3600.0)::numeric, 1), 0) as avg_border_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0)::numeric, 1), 0) as avg_offloading_hrs
        FROM tat_trips_view t
        WHERE t.dest_name IS NOT NULL
          AND t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
        GROUP BY t.dest_name
    ) res;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;
`;

fs.appendFileSync('supabase/migrations/tat_optimization_mv_only.sql', sql);
