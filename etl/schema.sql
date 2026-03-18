-- ============================================
-- Unifleet Live Telemetry Tables
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. LATEST STATE TABLE (upsert — always contains most recent state per vehicle)
-- This replaces the browser-side IndexedDB for live fleet view
CREATE TABLE IF NOT EXISTS vehicle_latest_state (
    tracker_id       BIGINT PRIMARY KEY,
    source_id        BIGINT,
    tracker_name     TEXT,
    label            TEXT,
    ops_region       TEXT NOT NULL DEFAULT 'tanzania',  -- 'tanzania' | 'zambia'

    -- GPS
    lat              DOUBLE PRECISION,
    lng              DOUBLE PRECISION,
    speed            DOUBLE PRECISION DEFAULT 0,
    heading          DOUBLE PRECISION DEFAULT 0,

    -- Status
    connection_status TEXT DEFAULT 'unknown',     -- 'active' | 'idle' | 'offline'
    movement_status   TEXT DEFAULT 'unknown',     -- 'moving' | 'stopped' | 'parked'
    ignition          BOOLEAN DEFAULT FALSE,
    battery_level     DOUBLE PRECISION DEFAULT 0,

    -- Timestamps
    gps_updated      TIMESTAMPTZ,                -- When the GPS fix was taken
    last_update      TIMESTAMPTZ,                -- When Navixy last heard from device
    ingested_at      TIMESTAMPTZ DEFAULT NOW(),   -- When our ETL wrote this row

    -- Raw JSON for any extra fields
    raw_state        JSONB
);

-- Index for ops-region filtering
CREATE INDEX IF NOT EXISTS idx_vls_ops_region ON vehicle_latest_state(ops_region);
CREATE INDEX IF NOT EXISTS idx_vls_movement   ON vehicle_latest_state(movement_status);
CREATE INDEX IF NOT EXISTS idx_vls_connection ON vehicle_latest_state(connection_status);


-- 2. TELEMETRY HISTORY TABLE (append-only time-series)
-- Every WebSocket update gets a row here for historical analysis
CREATE TABLE IF NOT EXISTS vehicle_telemetry (
    id               BIGSERIAL PRIMARY KEY,
    tracker_id       BIGINT NOT NULL,
    source_id        BIGINT,
    tracker_name     TEXT,
    ops_region       TEXT NOT NULL DEFAULT 'tanzania',

    -- GPS
    lat              DOUBLE PRECISION,
    lng              DOUBLE PRECISION,
    speed            DOUBLE PRECISION DEFAULT 0,
    heading          DOUBLE PRECISION DEFAULT 0,

    -- Status
    connection_status TEXT,
    movement_status   TEXT,
    ignition          BOOLEAN,
    battery_level     DOUBLE PRECISION,

    -- Timestamps
    gps_updated      TIMESTAMPTZ,
    last_update      TIMESTAMPTZ,
    ingested_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Critical index: time-range queries per vehicle
CREATE INDEX IF NOT EXISTS idx_vt_tracker_time ON vehicle_telemetry(tracker_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_vt_ops_time     ON vehicle_telemetry(ops_region, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_vt_ingested     ON vehicle_telemetry(ingested_at DESC);

-- Optional: Enable Supabase Realtime on latest_state so frontend can subscribe
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_latest_state;


-- 3. TRACKER REGISTRY (static info about each tracker)
CREATE TABLE IF NOT EXISTS tracker_registry (
    tracker_id       BIGINT PRIMARY KEY,
    source_id        BIGINT,
    label            TEXT,
    group_id         BIGINT,
    model            TEXT,
    phone            TEXT,
    device_id        TEXT,
    ops_region       TEXT NOT NULL DEFAULT 'tanzania',
    tariff_end_date  TEXT,
    first_seen       TIMESTAMPTZ DEFAULT NOW(),
    last_seen        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tr_ops ON tracker_registry(ops_region);


-- 4. HELPER VIEW: Join latest state with tracker info
CREATE OR REPLACE VIEW vehicle_live_view AS
SELECT
    r.tracker_id,
    r.source_id,
    r.label,
    r.group_id,
    r.model,
    r.ops_region,
    s.lat,
    s.lng,
    s.speed,
    s.heading,
    s.connection_status,
    s.movement_status,
    s.ignition,
    s.battery_level,
    s.gps_updated,
    s.last_update,
    s.ingested_at
FROM tracker_registry r
LEFT JOIN vehicle_latest_state s ON r.tracker_id = s.tracker_id;


-- 5. RPC: Get telemetry for a specific vehicle within a time range
CREATE OR REPLACE FUNCTION get_vehicle_telemetry(
    p_tracker_id BIGINT,
    p_from TIMESTAMPTZ DEFAULT NOW() - INTERVAL '24 hours',
    p_to TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    tracker_id BIGINT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    heading DOUBLE PRECISION,
    movement_status TEXT,
    connection_status TEXT,
    ignition BOOLEAN,
    gps_updated TIMESTAMPTZ,
    ingested_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        vt.tracker_id,
        vt.lat,
        vt.lng,
        vt.speed,
        vt.heading,
        vt.movement_status,
        vt.connection_status,
        vt.ignition,
        vt.gps_updated,
        vt.ingested_at
    FROM vehicle_telemetry vt
    WHERE vt.tracker_id = p_tracker_id
      AND vt.ingested_at >= p_from
      AND vt.ingested_at <= p_to
    ORDER BY vt.ingested_at DESC;
END;
$$ LANGUAGE plpgsql;


-- 6. RPC: Fleet summary — count by status for a given ops region
CREATE OR REPLACE FUNCTION get_fleet_live_summary(p_ops_region TEXT DEFAULT 'tanzania')
RETURNS TABLE (
    total_vehicles BIGINT,
    moving BIGINT,
    stopped BIGINT,
    parked BIGINT,
    active_connections BIGINT,
    offline BIGINT,
    avg_speed DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT AS total_vehicles,
        COUNT(*) FILTER (WHERE s.movement_status = 'moving')::BIGINT AS moving,
        COUNT(*) FILTER (WHERE s.movement_status = 'stopped')::BIGINT AS stopped,
        COUNT(*) FILTER (WHERE s.movement_status = 'parked')::BIGINT AS parked,
        COUNT(*) FILTER (WHERE s.connection_status = 'active')::BIGINT AS active_connections,
        COUNT(*) FILTER (WHERE s.connection_status = 'offline')::BIGINT AS offline,
        ROUND(AVG(s.speed)::NUMERIC, 1)::DOUBLE PRECISION AS avg_speed
    FROM vehicle_latest_state s
    WHERE s.ops_region = p_ops_region;
END;
$$ LANGUAGE plpgsql;


-- 7. AUTO-CLEANUP: Partition/clean old telemetry (optional — run via cron)
-- Keeps last 90 days of per-second data
-- You can set this up as a Supabase pg_cron job:
-- SELECT cron.schedule('cleanup-telemetry', '0 3 * * *',
--   $$DELETE FROM vehicle_telemetry WHERE ingested_at < NOW() - INTERVAL '90 days'$$
-- );
