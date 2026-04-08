ALTER TABLE route_edge_mapping ADD COLUMN IF NOT EXISTS is_return BOOLEAN DEFAULT false;

DROP FUNCTION IF EXISTS get_route_edges(UUID);

CREATE OR REPLACE FUNCTION get_route_edges(p_route_id UUID)
RETURNS TABLE (
  edge_id UUID,
  from_node TEXT,
  to_node TEXT,
  geometry JSONB,
  distance_km DOUBLE PRECISION,
  sequence_order INT,
  direction TEXT,
  is_return BOOLEAN
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
    m.direction,
    m.is_return
  FROM route_edge_mapping m
  JOIN route_network_edges e ON e.id = m.edge_id
  WHERE m.route_id = p_route_id
  ORDER BY m.sequence_order;
END;
$$;
