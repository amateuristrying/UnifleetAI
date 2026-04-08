-- Route Network Edges: each unique highway segment between two adjacent cities
-- Fetched ONCE from Mapbox Directions and shared across all routes that use it
CREATE TABLE IF NOT EXISTS route_network_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  from_lat DOUBLE PRECISION NOT NULL,
  from_lng DOUBLE PRECISION NOT NULL,
  to_lat DOUBLE PRECISION NOT NULL,
  to_lng DOUBLE PRECISION NOT NULL,
  geometry JSONB NOT NULL,
  distance_km DOUBLE PRECISION,
  duration_hrs DOUBLE PRECISION,
  edge_key TEXT NOT NULL UNIQUE, -- "CityA|CityB" (alphabetical order)
  route_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Route-to-Edge mapping: which edges compose each route, in order
CREATE TABLE IF NOT EXISTS route_edge_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES sap_route_master(id) ON DELETE CASCADE,
  edge_id UUID REFERENCES route_network_edges(id) ON DELETE CASCADE,
  sequence_order INT NOT NULL,
  direction TEXT DEFAULT 'forward', -- 'forward' or 'reverse' (edge can be traversed both ways)
  UNIQUE(route_id, sequence_order)
);

CREATE INDEX IF NOT EXISTS idx_edge_mapping_route ON route_edge_mapping(route_id);
CREATE INDEX IF NOT EXISTS idx_edge_mapping_edge ON route_edge_mapping(edge_id);
CREATE INDEX IF NOT EXISTS idx_network_edges_key ON route_network_edges(edge_key);

-- RPC: Get the full network for rendering
CREATE OR REPLACE FUNCTION get_route_network_graph()
RETURNS TABLE (
  edge_id UUID,
  from_node TEXT,
  to_node TEXT,
  geometry JSONB,
  distance_km DOUBLE PRECISION,
  duration_hrs DOUBLE PRECISION,
  route_count INT,
  route_ids UUID[],
  route_names TEXT[],
  corridor_types TEXT[]
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS edge_id,
    e.from_node,
    e.to_node,
    e.geometry,
    e.distance_km,
    e.duration_hrs,
    e.route_count,
    ARRAY_AGG(DISTINCT m.route_id) AS route_ids,
    ARRAY_AGG(DISTINCT r.route_name) AS route_names,
    ARRAY_AGG(DISTINCT r.corridor_type) AS corridor_types
  FROM route_network_edges e
  JOIN route_edge_mapping m ON m.edge_id = e.id
  JOIN sap_route_master r ON r.id = m.route_id
  GROUP BY e.id, e.from_node, e.to_node, e.geometry, e.distance_km, e.duration_hrs, e.route_count
  ORDER BY e.route_count DESC;
END;
$$;

-- RPC: Get edges for a specific route
CREATE OR REPLACE FUNCTION get_route_edges(p_route_id UUID)
RETURNS TABLE (
  edge_id UUID,
  from_node TEXT,
  to_node TEXT,
  geometry JSONB,
  distance_km DOUBLE PRECISION,
  sequence_order INT,
  direction TEXT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS edge_id,
    e.from_node,
    e.to_node,
    e.geometry,
    e.distance_km,
    m.sequence_order,
    m.direction
  FROM route_edge_mapping m
  JOIN route_network_edges e ON e.id = m.edge_id
  WHERE m.route_id = p_route_id
  ORDER BY m.sequence_order;
END;
$$;
