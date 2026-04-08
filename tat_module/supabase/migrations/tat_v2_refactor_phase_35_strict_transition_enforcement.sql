-- =============================================================
-- TAT V2 REFACTOR: Phase 35
-- Feature: Strict transition-policy execution (not just annotation)
--
-- What this adds:
--   1) Fallback transition policies for emitted event codes to avoid
--      false negatives in fast rebuild mode.
--   2) Executable guard evaluation (guard_sql) for policy candidates.
--   3) Enforce-or-warn behavior controlled by GUC:
--        tat.transition_enforcement_mode = strict | warn | off
--   4) Builder wiring:
--      - single tracker -> strict enforcement, full fidelity prev-state
--      - all trackers   -> warn enforcement, fast rebuild mode
--      - rule_version bumped to phase35_v1
-- =============================================================

-- -------------------------------------------------------------
-- 1) Ensure policy coverage for all emitted event_code + stop_state combos
-- -------------------------------------------------------------
INSERT INTO public.tat_state_transition_policy_v2 (
    policy_name, from_stop_state, event_code, to_stop_state, guard_sql, priority, rule_version, description
)
SELECT *
FROM (
    VALUES
      ('Anchor from any context',               NULL, 'trip_anchor_start',       'operational_stop',            NULL, 160, 'phase35_v1', 'Fallback anchor transition from any previous state'),
      ('Loading end fallback',                  NULL, 'loading_end',             'origin_loading_stop',         NULL, 140, 'phase35_v1', 'Fallback loading_end transition'),
      ('Origin exit fallback',                  NULL, 'origin_exit',             'corridor_transit',            NULL, 140, 'phase35_v1', 'Fallback origin_exit transition'),
      ('Border exit fallback',                  NULL, 'border_exit',             'border_crossing',             NULL, 140, 'phase35_v1', 'Fallback border_exit transition'),
      ('Customs exit fallback',                 NULL, 'customs_exit',            'customs_stop',                NULL, 140, 'phase35_v1', 'Fallback customs_exit transition'),
      ('Destination exit fallback',             NULL, 'destination_exit',        'destination_stop',            NULL, 140, 'phase35_v1', 'Fallback destination_exit transition'),
      ('Customer exit fallback',                NULL, 'customer_exit',           'destination_stop',            NULL, 140, 'phase35_v1', 'Fallback customer_exit transition'),
      ('Destination region exit',               NULL, 'destination_region_exit', 'destination_region_presence', NULL, 150, 'phase35_v1', 'Destination region exit remains destination region presence'),
      ('Return border exit fallback',           NULL, 'return_border_exit',      'border_crossing',             NULL, 140, 'phase35_v1', 'Fallback return_border_exit transition')
) AS s(policy_name, from_stop_state, event_code, to_stop_state, guard_sql, priority, rule_version, description)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tat_state_transition_policy_v2 p
    WHERE COALESCE(p.from_stop_state, '*') = COALESCE(s.from_stop_state, '*')
      AND p.event_code = s.event_code
      AND COALESCE(p.to_stop_state, '*') = COALESCE(s.to_stop_state, '*')
);

-- -------------------------------------------------------------
-- 2) Guard evaluator for policy guard_sql expressions
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eval_transition_guard_v2(
    p_guard_sql TEXT,
    p_prev_stop_state TEXT,
    p_event_code TEXT,
    p_new_stop_state TEXT,
    p_event_meta JSONB,
    p_role_code TEXT,
    p_trip_stage TEXT,
    p_event_time TIMESTAMPTZ,
    p_tracker_id INTEGER,
    p_trip_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    IF p_guard_sql IS NULL OR BTRIM(p_guard_sql) = '' THEN
        RETURN TRUE;
    END IF;

    -- Guard expression must be a boolean SQL expression and may reference:
    --   $1 prev_stop_state, $2 event_code, $3 new_stop_state, $4 event_meta,
    --   $5 role_code, $6 trip_stage, $7 event_time, $8 tracker_id, $9 trip_key.
    EXECUTE 'SELECT COALESCE((' || p_guard_sql || ')::boolean, false)'
      INTO v_ok
      USING
        p_prev_stop_state,
        p_event_code,
        p_new_stop_state,
        p_event_meta,
        p_role_code,
        p_trip_stage,
        p_event_time,
        p_tracker_id,
        p_trip_key;

    RETURN COALESCE(v_ok, FALSE);
EXCEPTION WHEN OTHERS THEN
    -- Guard syntax/runtime failures are treated as guard rejection.
    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.eval_transition_guard_v2(
    TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT
) TO anon, authenticated, service_role;

-- -------------------------------------------------------------
-- 3) Trigger: strict transition-policy enforcement
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
    v_enforcement_mode TEXT := 'strict';
    v_guard_ok BOOLEAN;
    v_reject_reason TEXT;
    r_policy RECORD;
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
    v_enforcement_mode := LOWER(COALESCE(NULLIF(current_setting('tat.transition_enforcement_mode', true), ''), 'strict'));

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
        -- Bulk fast mode: skip previous-state probe for performance.
        v_prev_state := NULL;
    END IF;

    -- Try policies in specificity/priority order and accept first guard-pass.
    v_policy_id := NULL;
    v_policy_rule_version := NULL;
    v_reject_reason := NULL;

    FOR r_policy IN
        SELECT
            p.policy_id,
            p.policy_name,
            p.rule_version,
            p.guard_sql,
            p.from_stop_state,
            p.to_stop_state
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
    LOOP
        v_guard_ok := public.eval_transition_guard_v2(
            r_policy.guard_sql,
            v_prev_state,
            NEW.event_code,
            v_stop_state,
            NEW.event_meta,
            NEW.role_code,
            NEW.trip_stage,
            NEW.event_time,
            NEW.tracker_id,
            NEW.trip_key
        );

        IF v_guard_ok THEN
            v_policy_id := r_policy.policy_id;
            v_policy_rule_version := r_policy.rule_version;
            EXIT;
        ELSE
            v_reject_reason := 'guard_failed:' || COALESCE(r_policy.policy_name, 'unnamed_policy');
        END IF;
    END LOOP;

    IF NEW.transition_policy_id IS NULL THEN
        NEW.transition_policy_id := v_policy_id;
    END IF;

    -- Enforce transition validity according to mode.
    IF v_policy_id IS NULL THEN
        v_reject_reason := COALESCE(v_reject_reason, 'no_policy_match');

        NEW.event_meta := jsonb_set(
            COALESCE(NEW.event_meta, '{}'::jsonb),
            '{transition_reject_reason}',
            to_jsonb(v_reject_reason),
            true
        );
        NEW.event_meta := jsonb_set(
            COALESCE(NEW.event_meta, '{}'::jsonb),
            '{transition_enforcement_mode}',
            to_jsonb(v_enforcement_mode),
            true
        );

        IF v_enforcement_mode = 'strict' AND TG_OP = 'INSERT' THEN
            RAISE EXCEPTION
                'Transition policy rejected event. trip_key=%, tracker_id=%, event_code=%, prev_state=%, stop_state=%, reason=%',
                NEW.trip_key, NEW.tracker_id, NEW.event_code, v_prev_state, v_stop_state, v_reject_reason;
        END IF;
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
    NEW.rule_version := COALESCE(NULLIF(NEW.rule_version, ''), v_rule_text, v_policy_rule_version, 'phase35_v1');

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
            'transition_enforcement_mode', v_enforcement_mode,
            'transition_reject_reason', v_reject_reason,
            'inference_rule', NEW.inference_rule
        ));
    END IF;

    RETURN NEW;
END;
$$;

-- -------------------------------------------------------------
-- 4) Patch builders for phase35 rule version + enforcement mode
-- -------------------------------------------------------------
DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := v_def;

    -- Normalize rule version stamp to phase35_v1.
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase35_v1'', true);',
        'n'
    );

    -- Fast mode: single tracker = full fidelity, ALL trackers = fast mode.
    IF position('tat.fast_rebuild_mode' in v_new) > 0 THEN
        v_new := regexp_replace(
            v_new,
            'PERFORM set_config\(''tat.fast_rebuild_mode'',\s*''[^'']*'',\s*true\);',
            'PERFORM set_config(''tat.fast_rebuild_mode'', CASE WHEN p_tracker_id IS NULL THEN ''1'' ELSE ''0'' END, true);',
            'n'
        );
    ELSE
        v_new := regexp_replace(
            v_new,
            '(PERFORM set_config\(''tat.current_rule_version'', ''phase35_v1'', true\);)',
            E'\\1\n    PERFORM set_config(''tat.fast_rebuild_mode'', CASE WHEN p_tracker_id IS NULL THEN ''1'' ELSE ''0'' END, true);',
            'n'
        );
    END IF;

    -- Transition enforcement mode:
    --   single tracker => strict
    --   all trackers   => warn
    IF position('tat.transition_enforcement_mode' in v_new) = 0 THEN
        v_new := regexp_replace(
            v_new,
            '(PERFORM set_config\(''tat.fast_rebuild_mode'', CASE WHEN p_tracker_id IS NULL THEN ''1'' ELSE ''0'' END, true\);)',
            E'\\1\n    PERFORM set_config(''tat.transition_enforcement_mode'', CASE WHEN p_tracker_id IS NULL THEN ''strict'' ELSE ''warn'' END, true);',
            'n'
        );
    END IF;

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_tat_trip_border_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := regexp_replace(
        v_def,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase35_v1'', true);',
        'n'
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_tat_trip_facts_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := regexp_replace(
        v_def,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase35_v1'', true);',
        'n'
    );

    IF v_new <> v_def THEN
        EXECUTE v_new;
    END IF;
END;
$$;

-- -------------------------------------------------------------
-- 5) Keep metadata current in policy table
-- -------------------------------------------------------------
UPDATE public.tat_state_transition_policy_v2
SET rule_version = COALESCE(NULLIF(rule_version, ''), 'phase35_v1')
WHERE rule_version IS NULL OR rule_version = '';

