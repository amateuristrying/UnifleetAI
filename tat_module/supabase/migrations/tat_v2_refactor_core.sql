-- Helper: Internal Normalization Logic
CREATE OR REPLACE FUNCTION normalize_geofence_name(p_name TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT regexp_replace(UPPER(TRIM(p_name)), '\s+', ' ', 'g');
$$;

-- Phase 0: Safety and Migration Guardrails
CREATE TABLE IF NOT EXISTS tat_refactor_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_time TIMESTAMPTZ DEFAULT clock_timestamp(),
    end_time TIMESTAMPTZ,
    phase TEXT NOT NULL,
    status TEXT DEFAULT 'running', -- 'running', 'completed', 'failed'
    parameters JSONB,
    metrics JSONB,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS tat_data_quality_issues (
    issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES tat_refactor_runs(run_id),
    tracker_id INTEGER,
    trip_key TEXT,
    issue_type TEXT NOT NULL, -- 'unmapped_geofence', 'invalid_chronology', 'low_confidence', etc.
    severity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    description TEXT,
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp(),
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT
);

-- Phase 1: Metadata Layer
CREATE TABLE IF NOT EXISTS geofence_master (
    geofence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name TEXT UNIQUE NOT NULL,
    default_role_code TEXT, -- Primary role (e.g., 'origin_terminal')
    site_type TEXT, -- 'terminal', 'border', 'checkpoint', 'customer'
    country_code TEXT, -- 'TZ', 'ZM', 'DRC', 'MW', etc.
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS geofence_aliases (
    alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id UUID REFERENCES geofence_master(geofence_id),
    alias_name TEXT UNIQUE NOT NULL, -- Raw name from Navixy/geofence_visits
    normalized_name TEXT NOT NULL, -- result of normalize_geofence_name(alias_name)
    confidence_score NUMERIC(3,2) DEFAULT 1.00,
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS geofence_role_map (
    map_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id UUID REFERENCES geofence_master(geofence_id),
    role_code TEXT NOT NULL, -- taxonomy: 'border_tz', 'origin_terminal', etc.
    trip_stage TEXT, -- 'loading', 'transit', 'destination', 'returning'
    priority INTEGER DEFAULT 0, -- Higher priority wins in multi-geofence collisions
    description TEXT,
    UNIQUE(geofence_id, role_code)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_geofence_aliases_norm ON geofence_aliases(normalized_name);
CREATE INDEX IF NOT EXISTS idx_geofence_role_map_role ON geofence_role_map(role_code);
CREATE INDEX IF NOT EXISTS idx_tat_dq_run ON tat_data_quality_issues(run_id);
