-- ============================================================
-- Pilferage Risk Intelligence Engine Schema
-- ============================================================

-- 1. Fleet Corridors
-- Stores "normal" paths (H3 cells) to detect off-route anomalies.
CREATE TABLE IF NOT EXISTS fleet_corridors (
    h3_index TEXT PRIMARY KEY,
    visit_count INTEGER DEFAULT 1,
    last_visit_at TIMESTAMPTZ DEFAULT now(),
    is_night_route BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_corridors_visit_count ON fleet_corridors(visit_count);

-- 2. Risk Zone Definitions
-- Hotspots for theft or unauthorized stops based on history.
CREATE TABLE IF NOT EXISTS risk_zone_definitions (
    h3_index TEXT PRIMARY KEY,
    risk_score INTEGER DEFAULT 0,
    incident_count INTEGER DEFAULT 0,
    risk_type TEXT CHECK (risk_type IN ('THEFT', 'UNAUTHORIZED_STOP', 'DEV_START')),
    updated_at TIMESTAMPTZ DEFAULT now(),
    boundary_geom GEOMETRY(POLYGON, 4326) -- Optional visualization
);

CREATE INDEX IF NOT EXISTS idx_risk_zone_score ON risk_zone_definitions(risk_score);

-- 3. Derived Stops  
-- Normalized stop events for spatial clustering and meet-up detection.
CREATE TABLE IF NOT EXISTS derived_stops (
    stop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID, -- References v_ai_trip_logs(trip_id) logically, but cannot FK to a view
    tracker_id BIGINT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_mins INTEGER,
    location GEOMETRY(POINT, 4326),
    location_h3 TEXT,
    is_night_stop BOOLEAN DEFAULT FALSE,
    risk_score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_derived_stops_h3 ON derived_stops(location_h3);
CREATE INDEX IF NOT EXISTS idx_derived_stops_time ON derived_stops(start_time);
CREATE INDEX IF NOT EXISTS idx_derived_stops_tracker ON derived_stops(tracker_id);
CREATE INDEX IF NOT EXISTS idx_derived_stops_location ON derived_stops USING GIST(location);

-- 4. Meetup Events
-- Potential vehicle-to-vehicle fuel transfers.
CREATE TABLE IF NOT EXISTS meetup_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_a_id BIGINT,
    vehicle_b_id BIGINT,
    location_h3 TEXT,
    start_time TIMESTAMPTZ,
    duration_overlap_mins INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetup_events_time ON meetup_events(start_time);

-- 5. RPC: Bulk Upsert Corridors
CREATE OR REPLACE FUNCTION upsert_fleet_corridors(
    p_h3_indices TEXT[],
    p_is_night BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO fleet_corridors (h3_index, visit_count, is_night_route, last_visit_at)
    SELECT 
        unnest(p_h3_indices), 
        1, 
        p_is_night,
        now()
    ON CONFLICT (h3_index) 
    DO UPDATE SET 
        visit_count = fleet_corridors.visit_count + 1,
        last_visit_at = now(),
        is_night_route = CASE WHEN p_is_night THEN TRUE ELSE fleet_corridors.is_night_route END;
END;
$$;

-- 6. RPC: Find Risks for Points (Batch)
-- Returns risk info for a list of H3 points
CREATE OR REPLACE FUNCTION check_security_risks(
    p_h3_indices TEXT[]
)
RETURNS TABLE (
    h3_index TEXT,
    is_in_corridor BOOLEAN,
    corridor_visits INTEGER,
    risk_zone_score INTEGER,
    risk_zone_type TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.h,
        (fc.h3_index IS NOT NULL) as is_in_corridor,
        COALESCE(fc.visit_count, 0) as corridor_visits,
        COALESCE(rz.risk_score, 0) as risk_zone_score,
        rz.risk_type as risk_zone_type
    FROM unnest(p_h3_indices) AS p(h)
    LEFT JOIN fleet_corridors fc ON fc.h3_index = p.h
    LEFT JOIN risk_zone_definitions rz ON rz.h3_index = p.h;
END;
$$;
