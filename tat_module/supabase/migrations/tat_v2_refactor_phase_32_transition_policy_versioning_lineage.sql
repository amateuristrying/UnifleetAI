-- =============================================================
-- TAT V2 REFACTOR: Phase 32
-- Feature set:
--   1) Explicit state transition policy table
--   2) Rule version + build run tracking on derived milestones/facts
--   3) Lineage columns (source_event_ids + derivation_path) on facts
-- =============================================================

-- -------------------------------------------------------------
-- 1) Transition policy registry
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tat_state_transition_policy_v2 (
    policy_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_name       TEXT NOT NULL,
    from_stop_state   TEXT,
    event_code        TEXT NOT NULL,
    to_stop_state     TEXT,
    guard_sql         TEXT,
    priority          INTEGER NOT NULL DEFAULT 100,
    rule_version      TEXT NOT NULL DEFAULT 'phase32_v1',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tat_transition_policy_v2_key
ON public.tat_state_transition_policy_v2 (
    COALESCE(from_stop_state, '*'),
    event_code,
    COALESCE(to_stop_state, '*')
);

CREATE INDEX IF NOT EXISTS idx_tat_transition_policy_v2_event
ON public.tat_state_transition_policy_v2 (event_code, is_active, priority DESC);

-- Seed baseline policy rules (idempotent).
INSERT INTO public.tat_state_transition_policy_v2 (
    policy_name, from_stop_state, event_code, to_stop_state, guard_sql, priority, rule_version, description
)
SELECT *
FROM (
    VALUES
      ('Anchor from operational',        'operational_stop',         'trip_anchor_start',      'operational_stop',         NULL, 300, 'phase32_v1', 'Trip anchor starts from operational stop context'),
      ('Loading start',                  NULL,                       'loading_start',           'origin_loading_stop',      NULL, 300, 'phase32_v1', 'Trip loading begins'),
      ('Loading end',                    'origin_loading_stop',      'loading_end',             'origin_loading_stop',      NULL, 250, 'phase32_v1', 'Loading stop closes'),
      ('Origin exit',                    'origin_loading_stop',      'origin_exit',             'corridor_transit',         NULL, 260, 'phase32_v1', 'Exit from origin stop to transit'),
      ('Corridor transit',               NULL,                       'corridor_entry',          'corridor_transit',         NULL, 180, 'phase32_v1', 'Transit checkpoint event'),
      ('Outbound border entry',          NULL,                       'border_entry',            'border_crossing',          NULL, 220, 'phase32_v1', 'Outbound border entry'),
      ('Outbound border exit',           'border_crossing',          'border_exit',             'border_crossing',          NULL, 220, 'phase32_v1', 'Outbound border exit'),
      ('Customs entry',                  NULL,                       'customs_entry',           'customs_stop',             NULL, 220, 'phase32_v1', 'Customs entry'),
      ('Customs exit',                   'customs_stop',             'customs_exit',            'customs_stop',             NULL, 220, 'phase32_v1', 'Customs exit'),
      ('Destination region entry',       NULL,                       'destination_region_entry','destination_region_presence',NULL,170, 'phase32_v1', 'Broad destination region observed'),
      ('Destination entry',              NULL,                       'destination_entry',       'destination_stop',         NULL, 280, 'phase32_v1', 'Destination site entry'),
      ('Customer entry',                 NULL,                       'customer_entry',          'destination_stop',         NULL, 280, 'phase32_v1', 'Customer site entry'),
      ('Destination exit',               'destination_stop',         'destination_exit',        'destination_stop',         NULL, 260, 'phase32_v1', 'Destination site exit'),
      ('Customer exit',                  'destination_stop',         'customer_exit',           'destination_stop',         NULL, 260, 'phase32_v1', 'Customer site exit'),
      ('Return leg start',               NULL,                       'return_leg_start',        'return_transit',           NULL, 240, 'phase32_v1', 'Return leg starts'),
      ('Return border entry',            NULL,                       'return_border_entry',     'border_crossing',          NULL, 220, 'phase32_v1', 'Return border entry'),
      ('Return border exit',             'border_crossing',          'return_border_exit',      'border_crossing',          NULL, 220, 'phase32_v1', 'Return border exit'),
      ('Return origin entry',            NULL,                       'return_origin_entry',     'operational_stop',         NULL, 260, 'phase32_v1', 'Returned to operational origin context'),
      ('Trip closure',                   NULL,                       'trip_closed',             'trip_closure',             NULL, 320, 'phase32_v1', 'Trip closure event')
) AS s(policy_name, from_stop_state, event_code, to_stop_state, guard_sql, priority, rule_version, description)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tat_state_transition_policy_v2 p
    WHERE COALESCE(p.from_stop_state, '*') = COALESCE(s.from_stop_state, '*')
      AND p.event_code = s.event_code
      AND COALESCE(p.to_stop_state, '*') = COALESCE(s.to_stop_state, '*')
);

-- -------------------------------------------------------------
-- 2) Schema additions for versioning/lineage
-- -------------------------------------------------------------
ALTER TABLE public.trip_state_events
    ADD COLUMN IF NOT EXISTS transition_policy_id UUID REFERENCES public.tat_state_transition_policy_v2(policy_id),
    ADD COLUMN IF NOT EXISTS rule_version TEXT,
    ADD COLUMN IF NOT EXISTS build_run_id UUID REFERENCES public.tat_refactor_runs(run_id),
    ADD COLUMN IF NOT EXISTS derivation_path JSONB;

CREATE INDEX IF NOT EXISTS idx_tse_build_run_id ON public.trip_state_events(build_run_id);
CREATE INDEX IF NOT EXISTS idx_tse_rule_version ON public.trip_state_events(rule_version);
CREATE INDEX IF NOT EXISTS idx_tse_transition_policy ON public.trip_state_events(transition_policy_id);

ALTER TABLE public.tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS rule_version TEXT,
    ADD COLUMN IF NOT EXISTS build_run_id UUID REFERENCES public.tat_refactor_runs(run_id),
    ADD COLUMN IF NOT EXISTS source_event_ids UUID[],
    ADD COLUMN IF NOT EXISTS derivation_path JSONB;

CREATE INDEX IF NOT EXISTS idx_ttf_build_run_id ON public.tat_trip_facts_v2(build_run_id);
CREATE INDEX IF NOT EXISTS idx_ttf_rule_version ON public.tat_trip_facts_v2(rule_version);

ALTER TABLE public.tat_trip_border_facts_v2
    ADD COLUMN IF NOT EXISTS rule_version TEXT,
    ADD COLUMN IF NOT EXISTS build_run_id UUID REFERENCES public.tat_refactor_runs(run_id),
    ADD COLUMN IF NOT EXISTS derivation_path JSONB;

CREATE INDEX IF NOT EXISTS idx_tbf_build_run_id ON public.tat_trip_border_facts_v2(build_run_id);
CREATE INDEX IF NOT EXISTS idx_tbf_rule_version ON public.tat_trip_border_facts_v2(rule_version);

-- -------------------------------------------------------------
-- 3) Build-context stamping helpers (rule_version + build_run_id)
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

    -- Previous state context within trip timeline (for policy matching).
    SELECT e.stop_state
      INTO v_prev_state
    FROM public.trip_state_events e
    WHERE e.trip_key = NEW.trip_key
      AND e.event_time < NEW.event_time
      AND (TG_OP = 'INSERT' OR e.event_id <> NEW.event_id)
    ORDER BY e.event_time DESC, e.created_at DESC
    LIMIT 1;

    -- Resolve best transition policy match.
    SELECT p.policy_id, p.rule_version
      INTO v_policy_id, v_policy_rule_version
    FROM public.tat_state_transition_policy_v2 p
    WHERE p.is_active
      AND p.event_code = NEW.event_code
      AND (p.from_stop_state IS NULL OR p.from_stop_state = v_prev_state)
      AND (p.to_stop_state IS NULL OR p.to_stop_state = v_stop_state)
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
    NEW.rule_version := COALESCE(NULLIF(NEW.rule_version, ''), v_rule_text, v_policy_rule_version, 'phase32_v1');

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
            'inference_rule', NEW.inference_rule
        ));
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ttf_set_lineage_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_run_text TEXT;
    v_rule_text TEXT;
BEGIN
    v_run_text := NULLIF(current_setting('tat.current_build_run_id', true), '');
    IF NEW.build_run_id IS NULL AND v_run_text IS NOT NULL THEN
        BEGIN
            NEW.build_run_id := v_run_text::uuid;
        EXCEPTION WHEN OTHERS THEN
            NEW.build_run_id := NULL;
        END;
    END IF;

    v_rule_text := NULLIF(current_setting('tat.current_rule_version', true), '');
    NEW.rule_version := COALESCE(NULLIF(NEW.rule_version, ''), v_rule_text, 'phase32_v1');

    IF NEW.source_event_ids IS NULL OR cardinality(NEW.source_event_ids) = 0 THEN
        SELECT array_agg(e.event_id ORDER BY e.event_time, e.event_id)
          INTO NEW.source_event_ids
        FROM public.trip_state_events e
        WHERE e.trip_key = NEW.trip_key;
    END IF;

    IF COALESCE(NEW.derivation_path, '{}'::jsonb) = '{}'::jsonb THEN
        NEW.derivation_path := jsonb_strip_nulls(jsonb_build_object(
            'entity', 'tat_trip_facts_v2',
            'source_table', 'trip_state_events',
            'trip_key', NEW.trip_key,
            'event_count', COALESCE(cardinality(NEW.source_event_ids), 0),
            'builder', 'build_tat_trip_facts_v2'
        ));
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ttf_set_lineage_v2 ON public.tat_trip_facts_v2;
CREATE TRIGGER trg_ttf_set_lineage_v2
BEFORE INSERT OR UPDATE
ON public.tat_trip_facts_v2
FOR EACH ROW
EXECUTE FUNCTION public.ttf_set_lineage_v2();

CREATE OR REPLACE FUNCTION public.tbf_set_lineage_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_run_text TEXT;
    v_rule_text TEXT;
BEGIN
    v_run_text := NULLIF(current_setting('tat.current_build_run_id', true), '');
    IF NEW.build_run_id IS NULL AND v_run_text IS NOT NULL THEN
        BEGIN
            NEW.build_run_id := v_run_text::uuid;
        EXCEPTION WHEN OTHERS THEN
            NEW.build_run_id := NULL;
        END;
    END IF;

    v_rule_text := NULLIF(current_setting('tat.current_rule_version', true), '');
    NEW.rule_version := COALESCE(NULLIF(NEW.rule_version, ''), v_rule_text, 'phase32_v1');

    IF COALESCE(NEW.derivation_path, '{}'::jsonb) = '{}'::jsonb THEN
        NEW.derivation_path := jsonb_strip_nulls(jsonb_build_object(
            'entity', 'tat_trip_border_facts_v2',
            'source_table', 'trip_state_events',
            'trip_key', NEW.trip_key,
            'leg_direction', NEW.leg_direction,
            'border_code', NEW.border_code,
            'inference_rule', NEW.inference_rule,
            'source_event_count', COALESCE(cardinality(NEW.source_event_ids), 0),
            'builder', 'build_tat_trip_border_facts_v2'
        ));
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tbf_set_lineage_v2 ON public.tat_trip_border_facts_v2;
CREATE TRIGGER trg_tbf_set_lineage_v2
BEFORE INSERT OR UPDATE
ON public.tat_trip_border_facts_v2
FOR EACH ROW
EXECUTE FUNCTION public.tbf_set_lineage_v2();

-- -------------------------------------------------------------
-- 4) Patch builders to publish build context via session GUC
-- -------------------------------------------------------------
DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;
    IF position('tat.current_build_run_id' in v_def) = 0 THEN
        v_new := regexp_replace(
            v_def,
            '(RETURNING run_id INTO v_run_id;)',
            E'\\1\n\n    PERFORM set_config(''tat.current_build_run_id'', v_run_id::text, true);\n    PERFORM set_config(''tat.current_rule_version'', ''phase32_v1'', true);',
            'n'
        );
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
    IF position('tat.current_build_run_id' in v_def) = 0 THEN
        v_new := regexp_replace(
            v_def,
            '(RETURNING run_id INTO v_run_id;)',
            E'\\1\n\n    PERFORM set_config(''tat.current_build_run_id'', v_run_id::text, true);\n    PERFORM set_config(''tat.current_rule_version'', ''phase32_v1'', true);',
            'n'
        );
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
    IF position('tat.current_build_run_id' in v_def) = 0 THEN
        v_new := regexp_replace(
            v_def,
            '(RETURNING run_id INTO v_run_id;)',
            E'\\1\n\n    PERFORM set_config(''tat.current_build_run_id'', v_run_id::text, true);\n    PERFORM set_config(''tat.current_rule_version'', ''phase32_v1'', true);',
            'n'
        );
        EXECUTE v_new;
    END IF;
END;
$$;

-- -------------------------------------------------------------
-- 5) Backfill metadata on existing rows
-- -------------------------------------------------------------
DO $$
DECLARE
    v_backfill_run_id UUID;
BEGIN
    INSERT INTO public.tat_refactor_runs (phase, status, parameters, metrics, end_time)
    VALUES (
        'PHASE_32_METADATA_BACKFILL',
        'completed',
        jsonb_build_object('scope', 'existing_rows'),
        '{}'::jsonb,
        clock_timestamp()
    )
    RETURNING run_id INTO v_backfill_run_id;

    UPDATE public.trip_state_events e
    SET
        rule_version = COALESCE(NULLIF(e.rule_version, ''), 'phase32_v1'),
        build_run_id = COALESCE(e.build_run_id, v_backfill_run_id),
        source_event_ids = CASE
            WHEN (e.source_event_ids IS NULL OR cardinality(e.source_event_ids) = 0) AND e.source_visit_id IS NOT NULL
                THEN ARRAY[e.source_visit_id]
            ELSE e.source_event_ids
        END,
        derivation_path = COALESCE(
            e.derivation_path,
            jsonb_strip_nulls(jsonb_build_object(
                'entity', 'trip_state_events',
                'event_code', e.event_code,
                'resolved_stop_state', e.stop_state,
                'inference_rule', e.inference_rule
            ))
        );

    -- Backfill transition policy IDs on existing events where applicable.
    WITH prev_state AS (
        SELECT
            e.event_id,
            (
                SELECT p.stop_state
                FROM public.trip_state_events p
                WHERE p.trip_key = e.trip_key
                  AND p.event_time < e.event_time
                ORDER BY p.event_time DESC, p.created_at DESC
                LIMIT 1
            ) AS prev_stop_state,
            e.event_code,
            e.stop_state
        FROM public.trip_state_events e
    ),
    matched AS (
        SELECT DISTINCT ON (ps.event_id)
            ps.event_id,
            pol.policy_id
        FROM prev_state ps
        JOIN public.tat_state_transition_policy_v2 pol
          ON pol.is_active
         AND pol.event_code = ps.event_code
         AND (pol.from_stop_state IS NULL OR pol.from_stop_state = ps.prev_stop_state)
         AND (pol.to_stop_state IS NULL OR pol.to_stop_state = ps.stop_state)
        ORDER BY
            ps.event_id,
            CASE WHEN pol.from_stop_state IS NULL THEN 1 ELSE 0 END,
            CASE WHEN pol.to_stop_state IS NULL THEN 1 ELSE 0 END,
            pol.priority DESC,
            pol.updated_at DESC
    )
    UPDATE public.trip_state_events e
    SET transition_policy_id = m.policy_id
    FROM matched m
    WHERE e.event_id = m.event_id
      AND e.transition_policy_id IS NULL;

    UPDATE public.tat_trip_facts_v2 f
    SET
        rule_version = COALESCE(NULLIF(f.rule_version, ''), 'phase32_v1'),
        build_run_id = COALESCE(f.build_run_id, v_backfill_run_id),
        source_event_ids = COALESCE(
            f.source_event_ids,
            (
                SELECT array_agg(e.event_id ORDER BY e.event_time, e.event_id)
                FROM public.trip_state_events e
                WHERE e.trip_key = f.trip_key
            )
        ),
        derivation_path = COALESCE(
            f.derivation_path,
            jsonb_strip_nulls(jsonb_build_object(
                'entity', 'tat_trip_facts_v2',
                'source_table', 'trip_state_events',
                'trip_key', f.trip_key,
                'event_count', COALESCE((
                    SELECT count(*)
                    FROM public.trip_state_events e
                    WHERE e.trip_key = f.trip_key
                ), 0),
                'builder', 'build_tat_trip_facts_v2'
            ))
        );

    UPDATE public.tat_trip_border_facts_v2 bf
    SET
        rule_version = COALESCE(NULLIF(bf.rule_version, ''), 'phase32_v1'),
        build_run_id = COALESCE(bf.build_run_id, v_backfill_run_id),
        derivation_path = COALESCE(
            bf.derivation_path,
            jsonb_strip_nulls(jsonb_build_object(
                'entity', 'tat_trip_border_facts_v2',
                'source_table', 'trip_state_events',
                'trip_key', bf.trip_key,
                'border_code', bf.border_code,
                'leg_direction', bf.leg_direction,
                'source_event_count', COALESCE(cardinality(bf.source_event_ids), 0),
                'builder', 'build_tat_trip_border_facts_v2'
            ))
        );
END;
$$;

GRANT SELECT ON public.tat_state_transition_policy_v2 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ttf_set_lineage_v2() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tbf_set_lineage_v2() TO anon, authenticated, service_role;
