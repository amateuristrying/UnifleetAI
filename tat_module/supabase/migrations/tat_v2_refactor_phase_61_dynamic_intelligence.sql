-- =============================================================
-- TAT V2 REFACTOR: Phase 61 — Dynamic Intelligence Layer
-- Adds meta-driven operational domain analysis functions.
-- =============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_operational_phases_v2
-- Returns all distinct trip stages and roles for UI dynamic rendering.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_operational_phases_v2()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT DISTINCT 
            trip_stage,
            role_code,
            description
        FROM geofence_role_map
        ORDER BY trip_stage, role_code
    ) r;
    RETURN COALESCE(v_result, '[]'::json);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_loading_zone_stats_v2
-- Returns aggregate performance for loading and origin domains.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_loading_zone_stats_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT 
            loading_terminal AS zone_name,
            COUNT(*) AS trip_count,
            ROUND(AVG(loading_phase_hrs)::NUMERIC, 1) AS avg_dwell_hrs,
            ROUND(AVG(waiting_for_orders_hrs)::NUMERIC, 1) AS avg_wait_hrs,
            -- Facility efficiency: (avg_loading / total_tat) share? 
            -- Here we'll use a simple proxy for congestion: count of concurrent trips in loading state
            COUNT(*) FILTER (WHERE loading_end IS NULL) AS queue_count,
            ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY loading_phase_hrs)::NUMERIC, 1) AS p90_dwell_hrs
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date 
          AND loading_start <= p_end_date
          AND loading_terminal IS NOT NULL
        GROUP BY loading_terminal
        ORDER BY trip_count DESC
    ) r;
    RETURN COALESCE(v_result, '[]'::json);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_unloading_zone_stats_v2
-- Returns aggregate performance for unloading and destination domains.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_unloading_zone_stats_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT 
            COALESCE(destination_name, customer_name) AS zone_name,
            COUNT(*) AS trip_count,
            ROUND(AVG(COALESCE(destination_dwell_hrs, customer_dwell_hrs))::NUMERIC, 1) AS avg_dwell_hrs,
            ROUND(AVG(total_tat_hrs)::NUMERIC, 1) AS avg_tat_hrs,
            ROUND(AVG(transit_hrs)::NUMERIC, 1) AS avg_transit_hrs,
            COUNT(*) FILTER (WHERE dest_exit IS NULL AND dest_entry IS NOT NULL) AS queue_count
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date 
          AND loading_start <= p_end_date
          AND (destination_name IS NOT NULL OR customer_name IS NOT NULL)
        GROUP BY COALESCE(destination_name, customer_name)
        ORDER BY trip_count DESC
    ) r;
    RETURN COALESCE(v_result, '[]'::json);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_route_performance_v2
-- Returns comparative analysis for all active routing corridors.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_route_performance_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(r)) INTO v_result
    FROM (
        SELECT 
            loading_terminal || ' -> ' || COALESCE(destination_name, customer_name) AS route_key,
            loading_terminal AS origin,
            COALESCE(destination_name, customer_name) AS destination,
            COUNT(*) AS trip_count,
            ROUND(AVG(total_tat_hrs)::NUMERIC, 1) AS avg_tat_hrs,
            ROUND(AVG(transit_hrs)::NUMERIC, 1) AS avg_transit_hrs,
            ROUND(AVG(border_total_hrs)::NUMERIC, 1) AS avg_border_hrs,
            ROUND(STDDEV(total_tat_hrs)::NUMERIC, 1) AS tat_variance,
            ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p50_tat_hrs,
            ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p90_tat_hrs
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date 
          AND loading_start <= p_end_date
          AND loading_terminal IS NOT NULL
          AND (destination_name IS NOT NULL OR customer_name IS NOT NULL)
        GROUP BY loading_terminal, COALESCE(destination_name, customer_name)
        ORDER BY trip_count DESC
    ) r;
    RETURN COALESCE(v_result, '[]'::json);
END $$;
