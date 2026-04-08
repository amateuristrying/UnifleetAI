-- Add route_geometry column to store Mapbox Directions API road geometry
ALTER TABLE sap_route_master
ADD COLUMN IF NOT EXISTS route_geometry JSONB;

-- Index for fast non-null geometry lookups
CREATE INDEX IF NOT EXISTS idx_route_geometry_exists
ON sap_route_master (id) WHERE route_geometry IS NOT NULL;
