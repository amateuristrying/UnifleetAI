-- 1. Add columns to route_security_events
ALTER TABLE route_security_events 
ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS risk_reasons TEXT[];

-- 2. Update the RPC function
create or replace function upsert_security_analysis(
  p_trip_id uuid,
  p_tracker_id bigint,
  p_tracker_name text,
  p_proposed_km double precision,
  p_actual_km double precision,
  p_deviation_km double precision,
  p_deviation_severity_ratio double precision,
  p_severity_level text,
  p_route_breaches integer,
  p_unauthorized_stops integer,
  p_deviation_segments jsonb,
  p_stop_events jsonb,
  p_risk_score integer DEFAULT 0,
  p_risk_reasons text[] DEFAULT ARRAY[]::text[]
)
returns void
language plpgsql
as $$
begin
  insert into route_security_events (
    trip_id,
    tracker_id,
    tracker_name,
    proposed_km,
    actual_km,
    deviation_km,
    deviation_severity_ratio,
    severity_level,
    route_breaches,
    unauthorized_stops,
    deviation_segments,
    stop_events,
    risk_score,
    risk_reasons,
    analyzed_at
  )
  values (
    p_trip_id,
    p_tracker_id,
    p_tracker_name,
    p_proposed_km,
    p_actual_km,
    p_deviation_km,
    p_deviation_severity_ratio,
    p_severity_level,
    p_route_breaches,
    p_unauthorized_stops,
    p_deviation_segments,
    p_stop_events,
    p_risk_score,
    p_risk_reasons,
    now()
  )
  on conflict (trip_id) do update set
    tracker_id = excluded.tracker_id,
    tracker_name = excluded.tracker_name,
    proposed_km = excluded.proposed_km,
    actual_km = excluded.actual_km,
    deviation_km = excluded.deviation_km,
    deviation_severity_ratio = excluded.deviation_severity_ratio,
    severity_level = excluded.severity_level,
    route_breaches = excluded.route_breaches,
    unauthorized_stops = excluded.unauthorized_stops,
    deviation_segments = excluded.deviation_segments,
    stop_events = excluded.stop_events,
    risk_score = excluded.risk_score,
    risk_reasons = excluded.risk_reasons,
    analyzed_at = now();
end;
$$;
