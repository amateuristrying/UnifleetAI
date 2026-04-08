-- ============================================================
-- SAP Route Master Integration
-- Tables: sap_route_master, route_waypoints, route_benchmarks
-- RPCs: get_route_master, get_route_by_trip, get_route_performance,
--        get_route_comparison, get_route_network
-- ============================================================

-- 1. Master Route Definitions
CREATE TABLE IF NOT EXISTS sap_route_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sap_code TEXT NOT NULL,
  route_name TEXT NOT NULL,
  point_a TEXT NOT NULL,
  point_b TEXT NOT NULL,
  point_c TEXT,
  point_a_lat DOUBLE PRECISION,
  point_a_lng DOUBLE PRECISION,
  point_b_lat DOUBLE PRECISION,
  point_b_lng DOUBLE PRECISION,
  point_c_lat DOUBLE PRECISION,
  point_c_lng DOUBLE PRECISION,
  country_a TEXT,
  country_b TEXT,
  country_c TEXT,
  estimated_distance_km DOUBLE PRECISION,
  estimated_duration_hrs DOUBLE PRECISION,
  is_active BOOLEAN DEFAULT TRUE,
  corridor_type TEXT DEFAULT 'long_haul',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_master_sap_code ON sap_route_master(sap_code);
CREATE INDEX IF NOT EXISTS idx_route_master_points ON sap_route_master(point_a, point_b);
CREATE INDEX IF NOT EXISTS idx_route_master_active ON sap_route_master(is_active);

-- 2. Route Waypoints (ordered stops along each route)
CREATE TABLE IF NOT EXISTS route_waypoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES sap_route_master(id) ON DELETE CASCADE,
  sequence_order INT NOT NULL,
  waypoint_name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  waypoint_type TEXT DEFAULT 'transit',
  expected_arrival_offset_hrs DOUBLE PRECISION,
  geofence_radius_km DOUBLE PRECISION DEFAULT 5.0,
  UNIQUE(route_id, sequence_order)
);

CREATE INDEX IF NOT EXISTS idx_waypoints_route ON route_waypoints(route_id);

-- 3. Route Performance Benchmarks
CREATE TABLE IF NOT EXISTS route_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES sap_route_master(id) ON DELETE CASCADE,
  benchmark_type TEXT NOT NULL,
  value_hrs DOUBLE PRECISION NOT NULL,
  sample_count INT DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(route_id, benchmark_type)
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_route ON route_benchmarks(route_id);

-- ============================================================
-- RPC 1: get_route_master — return all active routes
-- ============================================================
CREATE OR REPLACE FUNCTION get_route_master()
RETURNS TABLE (
  id UUID,
  sap_code TEXT,
  route_name TEXT,
  point_a TEXT,
  point_b TEXT,
  point_c TEXT,
  point_a_lat DOUBLE PRECISION,
  point_a_lng DOUBLE PRECISION,
  point_b_lat DOUBLE PRECISION,
  point_b_lng DOUBLE PRECISION,
  point_c_lat DOUBLE PRECISION,
  point_c_lng DOUBLE PRECISION,
  country_a TEXT,
  country_b TEXT,
  country_c TEXT,
  estimated_distance_km DOUBLE PRECISION,
  estimated_duration_hrs DOUBLE PRECISION,
  corridor_type TEXT,
  waypoint_count BIGINT,
  benchmark_target_hrs DOUBLE PRECISION
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.sap_code,
    r.route_name,
    r.point_a,
    r.point_b,
    r.point_c,
    r.point_a_lat,
    r.point_a_lng,
    r.point_b_lat,
    r.point_b_lng,
    r.point_c_lat,
    r.point_c_lng,
    r.country_a,
    r.country_b,
    r.country_c,
    r.estimated_distance_km,
    r.estimated_duration_hrs,
    r.corridor_type,
    (SELECT COUNT(*) FROM route_waypoints w WHERE w.route_id = r.id) AS waypoint_count,
    (SELECT b.value_hrs FROM route_benchmarks b WHERE b.route_id = r.id AND b.benchmark_type = 'target_tat' LIMIT 1) AS benchmark_target_hrs
  FROM sap_route_master r
  WHERE r.is_active = TRUE
  ORDER BY r.route_name;
END;
$$;

-- ============================================================
-- RPC 2: get_route_by_trip — auto-match a trip to SAP route
-- Uses proximity matching: finds the route whose origin is
-- closest to trip start and whose destination is closest to trip end
-- ============================================================
CREATE OR REPLACE FUNCTION get_route_by_trip(p_trip_id UUID)
RETURNS TABLE (
  route_id UUID,
  sap_code TEXT,
  route_name TEXT,
  match_confidence DOUBLE PRECISION,
  origin_distance_km DOUBLE PRECISION,
  destination_distance_km DOUBLE PRECISION
) LANGUAGE plpgsql AS $$
DECLARE
  v_start_lat DOUBLE PRECISION;
  v_start_lng DOUBLE PRECISION;
  v_end_lat   DOUBLE PRECISION;
  v_end_lng   DOUBLE PRECISION;
BEGIN
  -- Get trip start/end coordinates from v_ai_trip_logs
  -- We need to extract lat/lng from start_location and end_location
  SELECT
    t.start_lat, t.start_lng,
    t.end_lat, t.end_lng
  INTO v_start_lat, v_start_lng, v_end_lat, v_end_lng
  FROM v_ai_trip_logs t
  WHERE t.trip_id = p_trip_id;

  IF v_start_lat IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id AS route_id,
    r.sap_code,
    r.route_name,
    -- Confidence: inverse of total distance error (max 100)
    GREATEST(0, 100 - (
      (earth_distance(ll_to_earth(v_start_lat, v_start_lng), ll_to_earth(r.point_a_lat, r.point_a_lng)) / 1000.0) +
      (earth_distance(ll_to_earth(v_end_lat, v_end_lng),   ll_to_earth(r.point_b_lat, r.point_b_lng)) / 1000.0)
    )) AS match_confidence,
    earth_distance(ll_to_earth(v_start_lat, v_start_lng), ll_to_earth(r.point_a_lat, r.point_a_lng)) / 1000.0 AS origin_distance_km,
    earth_distance(ll_to_earth(v_end_lat, v_end_lng),   ll_to_earth(r.point_b_lat, r.point_b_lng)) / 1000.0 AS destination_distance_km
  FROM sap_route_master r
  WHERE r.is_active = TRUE
    AND r.point_a_lat IS NOT NULL
    AND r.point_b_lat IS NOT NULL
  ORDER BY match_confidence DESC
  LIMIT 5;
END;
$$;

-- ============================================================
-- RPC 3: get_route_performance — TAT stats for a specific route
-- ============================================================
CREATE OR REPLACE FUNCTION get_route_performance(
  p_route_id UUID,
  p_start_date TEXT DEFAULT NULL,
  p_end_date TEXT DEFAULT NULL
)
RETURNS TABLE (
  route_id UUID,
  route_name TEXT,
  sap_code TEXT,
  benchmark_target_hrs DOUBLE PRECISION,
  total_trips BIGINT,
  avg_tat_hrs DOUBLE PRECISION,
  min_tat_hrs DOUBLE PRECISION,
  max_tat_hrs DOUBLE PRECISION,
  p90_tat_hrs DOUBLE PRECISION,
  on_time_pct DOUBLE PRECISION,
  avg_deviation_from_benchmark DOUBLE PRECISION
) LANGUAGE plpgsql AS $$
DECLARE
  v_benchmark DOUBLE PRECISION;
  v_point_a_lat DOUBLE PRECISION;
  v_point_a_lng DOUBLE PRECISION;
  v_point_b_lat DOUBLE PRECISION;
  v_point_b_lng DOUBLE PRECISION;
BEGIN
  -- Get route details
  SELECT r.point_a_lat, r.point_a_lng, r.point_b_lat, r.point_b_lng
  INTO v_point_a_lat, v_point_a_lng, v_point_b_lat, v_point_b_lng
  FROM sap_route_master r WHERE r.id = p_route_id;

  -- Get benchmark
  SELECT b.value_hrs INTO v_benchmark
  FROM route_benchmarks b
  WHERE b.route_id = p_route_id AND b.benchmark_type = 'target_tat';

  IF v_benchmark IS NULL THEN
    v_benchmark := 0;
  END IF;

  RETURN QUERY
  WITH matched_trips AS (
    SELECT
      t.trip_id,
      EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600.0 AS tat_hrs
    FROM v_ai_trip_logs t
    WHERE t.start_lat IS NOT NULL
      AND t.end_lat IS NOT NULL
      AND earth_distance(
        ll_to_earth(t.start_lat, t.start_lng),
        ll_to_earth(v_point_a_lat, v_point_a_lng)
      ) / 1000.0 < 50  -- within 50km of origin
      AND earth_distance(
        ll_to_earth(t.end_lat, t.end_lng),
        ll_to_earth(v_point_b_lat, v_point_b_lng)
      ) / 1000.0 < 50  -- within 50km of destination
      AND (p_start_date IS NULL OR t.start_time >= p_start_date::timestamptz)
      AND (p_end_date IS NULL OR t.start_time <= p_end_date::timestamptz)
      AND t.end_time IS NOT NULL
  )
  SELECT
    p_route_id AS route_id,
    r.route_name,
    r.sap_code,
    v_benchmark AS benchmark_target_hrs,
    COUNT(*)::BIGINT AS total_trips,
    ROUND(AVG(mt.tat_hrs)::NUMERIC, 1)::DOUBLE PRECISION AS avg_tat_hrs,
    ROUND(MIN(mt.tat_hrs)::NUMERIC, 1)::DOUBLE PRECISION AS min_tat_hrs,
    ROUND(MAX(mt.tat_hrs)::NUMERIC, 1)::DOUBLE PRECISION AS max_tat_hrs,
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mt.tat_hrs)::NUMERIC, 1)::DOUBLE PRECISION AS p90_tat_hrs,
    CASE WHEN v_benchmark > 0 THEN
      ROUND((COUNT(*) FILTER (WHERE mt.tat_hrs <= v_benchmark) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC, 1)::DOUBLE PRECISION
    ELSE 0 END AS on_time_pct,
    CASE WHEN v_benchmark > 0 THEN
      ROUND((AVG(mt.tat_hrs) - v_benchmark)::NUMERIC, 1)::DOUBLE PRECISION
    ELSE 0 END AS avg_deviation_from_benchmark
  FROM matched_trips mt
  CROSS JOIN sap_route_master r
  WHERE r.id = p_route_id
  GROUP BY r.route_name, r.sap_code;
END;
$$;

-- ============================================================
-- RPC 4: get_route_comparison — multi-route KPI comparison
-- ============================================================
CREATE OR REPLACE FUNCTION get_route_comparison(
  p_start_date TEXT DEFAULT NULL,
  p_end_date TEXT DEFAULT NULL
)
RETURNS TABLE (
  route_id UUID,
  route_name TEXT,
  sap_code TEXT,
  point_a TEXT,
  point_b TEXT,
  estimated_distance_km DOUBLE PRECISION,
  benchmark_target_hrs DOUBLE PRECISION,
  total_trips BIGINT,
  avg_tat_hrs DOUBLE PRECISION,
  on_time_pct DOUBLE PRECISION,
  point_a_lat DOUBLE PRECISION,
  point_a_lng DOUBLE PRECISION,
  point_b_lat DOUBLE PRECISION,
  point_b_lng DOUBLE PRECISION
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id AS route_id,
    r.route_name,
    r.sap_code,
    r.point_a,
    r.point_b,
    r.estimated_distance_km,
    COALESCE(b.value_hrs, 0) AS benchmark_target_hrs,
    0::BIGINT AS total_trips,
    0::DOUBLE PRECISION AS avg_tat_hrs,
    0::DOUBLE PRECISION AS on_time_pct,
    r.point_a_lat,
    r.point_a_lng,
    r.point_b_lat,
    r.point_b_lng
  FROM sap_route_master r
  LEFT JOIN route_benchmarks b ON b.route_id = r.id AND b.benchmark_type = 'target_tat'
  WHERE r.is_active = TRUE
    AND r.point_a_lat IS NOT NULL
    AND r.point_b_lat IS NOT NULL
  ORDER BY r.route_name;
END;
$$;

-- ============================================================
-- RPC 5: get_route_network — lightweight for map rendering
-- Returns just coords + metadata for arc lines
-- ============================================================
CREATE OR REPLACE FUNCTION get_route_network()
RETURNS TABLE (
  id UUID,
  route_name TEXT,
  sap_code TEXT,
  point_a TEXT,
  point_b TEXT,
  point_c TEXT,
  point_a_lat DOUBLE PRECISION,
  point_a_lng DOUBLE PRECISION,
  point_b_lat DOUBLE PRECISION,
  point_b_lng DOUBLE PRECISION,
  point_c_lat DOUBLE PRECISION,
  point_c_lng DOUBLE PRECISION,
  corridor_type TEXT,
  estimated_distance_km DOUBLE PRECISION
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.route_name,
    r.sap_code,
    r.point_a,
    r.point_b,
    r.point_c,
    r.point_a_lat,
    r.point_a_lng,
    r.point_b_lat,
    r.point_b_lng,
    r.point_c_lat,
    r.point_c_lng,
    r.corridor_type,
    r.estimated_distance_km
  FROM sap_route_master r
  WHERE r.is_active = TRUE
    AND r.point_a_lat IS NOT NULL
    AND r.point_b_lat IS NOT NULL
  ORDER BY r.route_name;
END;
$$;
