-- 1. Create Spatial Index
CREATE INDEX IF NOT EXISTS idx_geofences_geom ON public.geofences USING GIST (geom);

-- 2. Wipe the erroneous states entirely
TRUNCATE TABLE public.live_tracker_geofence_state CASCADE;
TRUNCATE TABLE public.native_geofence_visits_log CASCADE;
UPDATE public.sys_telemetry_watermark SET last_processed_id = 0 WHERE key = 'live_geofence_engine';

-- 3. Permanently compile the Flawless Tanzanian Microbatch Engine
CREATE OR REPLACE FUNCTION public.process_live_telemetry_batch(p_batch_size INTEGER DEFAULT 5000)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_last_id BIGINT;
    v_max_id BIGINT := 0;
    v_processed INT := 0;
    v_start_time TIMESTAMPTZ := clock_timestamp();
    v_state RECORD;
    v_active_visit_id BIGINT;
    r RECORD;
BEGIN
    SELECT last_processed_id INTO v_last_id 
    FROM public.sys_telemetry_watermark WHERE key = 'live_geofence_engine' FOR UPDATE;
    IF NOT FOUND THEN v_last_id := 0; END IF;
    v_max_id := v_last_id;

    FOR r IN (
        SELECT vt.id, vt.tracker_id, vt.tracker_name, vt.ops_region, vt.ingested_at, geo.geofence_id, geo.geofence_name
        FROM public.vehicle_telemetry vt
        LEFT JOIN LATERAL (
            SELECT g.zone_id::TEXT AS geofence_id, g.name AS geofence_name
            FROM public.geofences g
            WHERE g.geom IS NOT NULL AND ST_Intersects(g.geom, ST_SetSRID(ST_MakePoint(vt.lng, vt.lat), 4326))
              AND LOWER(g.ops_region) = 'tanzania' 
            ORDER BY ST_Area(g.geom::geography) ASC LIMIT 1
        ) geo ON true
        WHERE vt.id > v_last_id 
          AND vt.lat IS NOT NULL AND vt.lng IS NOT NULL 
          AND vt.lat != 0 AND vt.lng != 0
        ORDER BY vt.id ASC
        LIMIT p_batch_size
    ) LOOP
        -- DYNAMIC IN-MEMORY FILTER FOR ULTRA FAST STREAMING
        IF LOWER(r.ops_region) != 'tanzania' OR r.tracker_name ILIKE '%ZM%' THEN
            v_max_id := GREATEST(v_max_id, r.id);
            v_processed := v_processed + 1;
            CONTINUE;
        END IF;

        SELECT * INTO v_state FROM public.live_tracker_geofence_state WHERE tracker_id = r.tracker_id;
        IF NOT FOUND THEN
            IF r.geofence_id IS NOT NULL THEN
                INSERT INTO public.native_geofence_visits_log (tracker_id, tracker_name, geofence_id, geofence_name, in_time, is_open) 
                VALUES (r.tracker_id, r.tracker_name, r.geofence_id, r.geofence_name, r.ingested_at, true) RETURNING visit_id INTO v_active_visit_id;
                INSERT INTO public.live_tracker_geofence_state (tracker_id, tracker_name, current_geofence_id, current_geofence_name, active_visit_id, session_start, last_ping) 
                VALUES (r.tracker_id, r.tracker_name, r.geofence_id, r.geofence_name, v_active_visit_id, r.ingested_at, r.ingested_at);
            ELSE
                INSERT INTO public.live_tracker_geofence_state (tracker_id, tracker_name, current_geofence_id, current_geofence_name, active_visit_id, session_start, last_ping) 
                VALUES (r.tracker_id, r.tracker_name, NULL, NULL, NULL, NULL, r.ingested_at);
            END IF;
        ELSE
            IF v_state.current_geofence_id IS NOT DISTINCT FROM r.geofence_id THEN
                UPDATE public.live_tracker_geofence_state SET last_ping = GREATEST(last_ping, r.ingested_at), updated_at = clock_timestamp() WHERE tracker_id = r.tracker_id;
            ELSE
                IF v_state.current_geofence_id IS NOT NULL THEN
                    UPDATE public.native_geofence_visits_log SET out_time = GREATEST(in_time, v_state.last_ping), duration_seconds = EXTRACT(EPOCH FROM (GREATEST(in_time, v_state.last_ping) - in_time))::INTEGER, is_open = false, updated_at = clock_timestamp() WHERE visit_id = v_state.active_visit_id;
                END IF;
                v_active_visit_id := NULL;
                IF r.geofence_id IS NOT NULL THEN
                    INSERT INTO public.native_geofence_visits_log (tracker_id, tracker_name, geofence_id, geofence_name, in_time, is_open) 
                    VALUES (r.tracker_id, r.tracker_name, r.geofence_id, r.geofence_name, r.ingested_at, true) RETURNING visit_id INTO v_active_visit_id;
                END IF;
                UPDATE public.live_tracker_geofence_state SET current_geofence_id = r.geofence_id, current_geofence_name = r.geofence_name, active_visit_id = v_active_visit_id, session_start = CASE WHEN r.geofence_id IS NOT NULL THEN r.ingested_at ELSE NULL END, last_ping = GREATEST(last_ping, r.ingested_at), updated_at = clock_timestamp() WHERE tracker_id = r.tracker_id;
            END IF;
        END IF;
        v_max_id := GREATEST(v_max_id, r.id);
        v_processed := v_processed + 1;
    END LOOP;

    IF v_processed > 0 THEN
        UPDATE public.sys_telemetry_watermark SET last_processed_id = v_max_id, updated_at = clock_timestamp() WHERE key = 'live_geofence_engine';
    END IF;
    RETURN FORMAT('Processed %s rows. Watermark moved from %s to %s in %s', v_processed, v_last_id, v_max_id, (clock_timestamp() - v_start_time));
END;
$$;
