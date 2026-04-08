-- =============================================================
-- TAT V2 REFACTOR: Phase 33
-- Performance hardening for full rebuilds after Phase 32 lineage.
--
-- Problem:
--   Phase 32 added transition-policy enrichment inside
--   tse_set_stop_state_v2(), including per-row previous-state lookup.
--   On high-volume rebuilds this becomes the primary bottleneck.
--
-- Approach:
--   1) Add lookup indexes used by trigger + lineage lookups.
--   2) Add fast rebuild mode in trigger (session GUC):
--      tat.fast_rebuild_mode=1 skips expensive previous-state probe.
--   3) Patch build_trip_state_events_v2() to enable fast mode during
--      bulk state-event construction.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Indexes for hot lookup paths
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tse_trip_key_event_time_created_at
ON public.trip_state_events (trip_key, event_time DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tse_trip_key_event_time_event_id
ON public.trip_state_events (trip_key, event_time, event_id);

CREATE INDEX IF NOT EXISTS idx_tse_trip_key
ON public.trip_state_events (trip_key);

CREATE INDEX IF NOT EXISTS idx_tat_transition_policy_lookup
ON public.tat_state_transition_policy_v2 (
    event_code,
    from_stop_state,
    to_stop_state,
    is_active,
    priority DESC
);

-- -------------------------------------------------------------
-- 2) Fast-mode aware stop-state trigger
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tse_set_stop_state_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_stop_state TEXT;
    v_prev_state TEXT;
    v_policy_id UUID;
    v_policy_rule_version TEXT;
    v_run_text TEXT;
    v_rule_text TEXT;
    v_fast_mode BOOLEAN := false;
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
        public.map_event_to_stop_state_v2(NEW.event_code, NEW.role_code, NULL, NEW.event_meta)
    );
    NEW.stop_state := v_stop_state;

    IF COALESCE(NEW.event_meta->>'stop_state', '') = '' AND v_stop_state IS NOT NULL THEN
        NEW.event_meta := jsonb_set(NEW.event_meta, '{stop_state}', to_jsonb(v_stop_state), true);
    END IF;

    IF COALESCE(NEW.trip_stage, '') = '' THEN
        NEW.trip_stage := public.map_stop_state_to_trip_stage_v2(v_stop_state, NEW.trip_stage);
    END IF;

    v_fast_mode := LOWER(COALESCE(current_setting('tat.fast_rebuild_mode', true), '0')) IN ('1', 'true', 't', 'on', 'yes');

    IF NOT v_fast_mode THEN
        -- Full-fidelity mode: derive previous state in trip timeline.
        SELECT e.stop_state
          INTO v_prev_state
        FROM public.trip_state_events e
        WHERE e.trip_key = NEW.trip_key
          AND e.event_time < NEW.event_time
          AND (TG_OP = 'INSERT' OR e.event_id <> NEW.event_id)
        ORDER BY e.event_time DESC, e.created_at DESC
        LIMIT 1;
    ELSE
        -- Bulk fast mode: skip previous-state probe to avoid row-by-row hotspot.
        v_prev_state := NULL;
    END IF;

    -- Resolve best transition policy match.
    -- In fast mode we only consider generic rules (from_stop_state IS NULL).
    SELECT p.policy_id, p.rule_version
      INTO v_policy_id, v_policy_rule_version
    FROM public.tat_state_transition_policy_v2 p
    WHERE p.is_active
      AND p.event_code = NEW.event_code
      AND (p.to_stop_state IS NULL OR p.to_stop_state = v_stop_state)
      AND (
            (NOT v_fast_mode AND (p.from_stop_state IS NULL OR p.from_stop_state = v_prev_state))
         OR (v_fast_mode AND p.from_stop_state IS NULL)
      )
    ORDER BY
      CASE WHEN p.from_stop_state IS NULL THEN 1 ELSE 0 END,
      CASE WHEN p.to_stop_state IS NULL THEN 1 ELSE 0 END,
      p.priority DESC,
      p.updated_at DESC
    LIMIT 1;

    IF NEW.transition_policy_id IS NULL THEN
        NEW.transition_policy_id := v_policy_id;
    END IF;

    v_run_text := NULLIF(current_setting('tat.current_build_run_id', true), '');
    IF NEW.build_run_id IS NULL AND v_run_text IS NOT NULL THEN
        BEGIN
            NEW.build_run_id := v_run_text::uuid;
        EXCEPTION WHEN OTHERS THEN
            NEW.build_run_id := NULL;
        END;
    END IF;

    v_rule_text := NULLIF(current_setting('tat.current_rule_version', true), '');
    NEW.rule_version := COALESCE(NULLIF(NEW.rule_version, ''), v_rule_text, v_policy_rule_version, 'phase33_v1');

    IF (NEW.source_event_ids IS NULL OR cardinality(NEW.source_event_ids) = 0) AND NEW.source_visit_id IS NOT NULL THEN
        NEW.source_event_ids := ARRAY[NEW.source_visit_id];
    END IF;

    IF COALESCE(NEW.derivation_path, '{}'::jsonb) = '{}'::jsonb THEN
        NEW.derivation_path := jsonb_strip_nulls(jsonb_build_object(
            'entity', 'trip_state_events',
            'event_code', NEW.event_code,
            'resolved_stop_state', v_stop_state,
            'previous_stop_state', v_prev_state,
            'policy_id', v_policy_id,
            'policy_rule_version', v_policy_rule_version,
            'fast_rebuild_mode', v_fast_mode,
            'inference_rule', NEW.inference_rule
        ));
    END IF;

    RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 3) Patch build_trip_state_events_v2() to enable fast mode
-- -------------------------------------------------------------
DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    IF position('tat.fast_rebuild_mode' in v_def) = 0 THEN
        v_new := regexp_replace(
            v_def,
            '(PERFORM set_config\(''tat.current_rule_version'', ''phase32_v1'', true\);)',
            E'\\1\n    PERFORM set_config(''tat.fast_rebuild_mode'', ''1'', true);',
            'n'
        );

        -- Fallback pattern if rule version has already moved to phase33.
        IF v_new = v_def THEN
            v_new := regexp_replace(
                v_def,
                '(PERFORM set_config\(''tat.current_rule_version'', ''phase33_v1'', true\);)',
                E'\\1\n    PERFORM set_config(''tat.fast_rebuild_mode'', ''1'', true);',
                'n'
            );
        END IF;

        EXECUTE v_new;
    END IF;
END;
$$;

-- Keep planner stats fresh for newly created indexes.
ANALYZE public.trip_state_events;
ANALYZE public.tat_state_transition_policy_v2;
