-- =============================================================
-- TAT V2 REFACTOR: Phase 27
-- Feature: Cleanup residual origin_operational_stop values in
--          trip_state_events and harden compatibility mapping.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Compatibility-safe event mapping
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.map_event_to_stop_state_v2(
    p_event_code TEXT,
    p_role_code TEXT DEFAULT NULL,
    p_trip_stage TEXT DEFAULT NULL,
    p_event_meta JSONB DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        COALESCE(
            CASE
                WHEN LOWER(COALESCE(p_event_meta->>'stop_state', '')) = 'origin_operational_stop'
                    THEN 'operational_stop'
                ELSE NULLIF(TRIM(COALESCE(p_event_meta->>'stop_state', '')), '')
            END,
            CASE LOWER(COALESCE(p_event_code, ''))
                WHEN 'trip_anchor_start' THEN 'operational_stop'
                WHEN 'loading_start' THEN 'origin_loading_stop'
                WHEN 'loading_end' THEN 'origin_loading_stop'
                WHEN 'origin_exit' THEN 'corridor_transit'
                WHEN 'corridor_entry' THEN 'corridor_transit'
                WHEN 'border_entry' THEN 'border_crossing'
                WHEN 'border_exit' THEN 'border_crossing'
                WHEN 'return_border_entry' THEN 'border_crossing'
                WHEN 'return_border_exit' THEN 'border_crossing'
                WHEN 'customs_entry' THEN 'customs_stop'
                WHEN 'customs_exit' THEN 'customs_stop'
                WHEN 'destination_region_entry' THEN 'destination_region_presence'
                WHEN 'destination_region_exit' THEN 'destination_region_presence'
                WHEN 'destination_entry' THEN 'destination_stop'
                WHEN 'destination_exit' THEN 'destination_stop'
                WHEN 'customer_entry' THEN 'destination_stop'
                WHEN 'customer_exit' THEN 'destination_stop'
                WHEN 'return_leg_start' THEN 'return_transit'
                WHEN 'return_origin_entry' THEN 'operational_stop'
                WHEN 'trip_closed' THEN 'trip_closure'
                ELSE NULL
            END,
            public.map_role_to_stop_state_v2(p_role_code, p_trip_stage),
            'other'
        );
$$;

-- -------------------------------------------------------------
-- 2) Trigger hardening for legacy incoming values
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tse_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_stop_state TEXT;
BEGIN
    IF NEW.event_meta IS NULL THEN
        NEW.event_meta := '{}'::jsonb;
    END IF;

    IF COALESCE(NEW.event_meta->>'stop_state', '') = 'origin_operational_stop' THEN
        NEW.event_meta := jsonb_set(NEW.event_meta, '{stop_state}', to_jsonb('operational_stop'::text), true);
    END IF;

    IF COALESCE(NEW.stop_state, '') = 'origin_operational_stop' THEN
        NEW.stop_state := 'operational_stop';
    END IF;

    v_stop_state := COALESCE(
        NULLIF(NEW.stop_state, ''),
        public.map_event_to_stop_state_v2(NEW.event_code, NEW.role_code, NEW.trip_stage, NEW.event_meta)
    );

    NEW.stop_state := v_stop_state;

    IF COALESCE(NEW.event_meta->>'stop_state', '') = '' AND v_stop_state IS NOT NULL THEN
        NEW.event_meta := jsonb_set(NEW.event_meta, '{stop_state}', to_jsonb(v_stop_state), true);
    END IF;

    IF COALESCE(NEW.trip_stage, '') = '' THEN
        NEW.trip_stage := public.map_stop_state_to_trip_stage_v2(v_stop_state, NEW.trip_stage);
    END IF;

    RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 3) Global cleanup of residual persisted old label
-- -------------------------------------------------------------
UPDATE public.trip_state_events
SET event_meta = jsonb_set(COALESCE(event_meta, '{}'::jsonb), '{stop_state}', to_jsonb('operational_stop'::text), true)
WHERE COALESCE(event_meta->>'stop_state', '') = 'origin_operational_stop';

UPDATE public.trip_state_events
SET stop_state = 'operational_stop'
WHERE stop_state = 'origin_operational_stop';

GRANT EXECUTE ON FUNCTION public.map_event_to_stop_state_v2(text, text, text, jsonb)
TO anon, authenticated, service_role;
