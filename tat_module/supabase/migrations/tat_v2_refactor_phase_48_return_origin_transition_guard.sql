-- =============================================================
-- TAT V2 REFACTOR: Phase 48
-- Guard return-origin closure path with outbound-transition evidence.
--
-- Requirement:
--   Allow return-origin closure only if the trip has at least one prior
--   outbound progression signal before return-origin timestamp:
--     origin_exit / corridor_entry / border_entry / destination_*
--
-- This avoids premature closure while still supporting:
--   - local deliveries (origin_exit or corridor evidence)
--   - missed-destination completed trips (no destination but outbound evidence)
-- =============================================================

-- -------------------------------------------------------------
-- 1) Policy guard hardening (event-level safety net)
-- -------------------------------------------------------------
-- Return-origin entry must have at least one prior outbound transition.
UPDATE public.tat_state_transition_policy_v2
SET
    guard_sql = $g$
        EXISTS (
            SELECT 1
            FROM public.trip_state_events e
            WHERE e.trip_key = $9
              AND e.event_time <= $7
              AND e.event_code IN (
                  'origin_exit',
                  'corridor_entry',
                  'border_entry',
                  'destination_entry',
                  'destination_exit',
                  'destination_region_entry',
                  'destination_region_exit'
              )
        )
    $g$,
    rule_version = 'phase48_v1',
    updated_at = NOW()
WHERE is_active
  AND event_code = 'return_origin_entry'
  AND to_stop_state = 'operational_stop';

-- Trip_closed guard applies only to closed_by_return_origin.
-- next_loading / timeout closures remain allowed.
UPDATE public.tat_state_transition_policy_v2
SET
    guard_sql = $g$
        CASE
            WHEN COALESCE($4->>'reason', '') = 'closed_by_return_origin' THEN
                EXISTS (
                    SELECT 1
                    FROM public.trip_state_events e
                    WHERE e.trip_key = $9
                      AND e.event_time <= $7
                      AND e.event_code IN (
                          'origin_exit',
                          'corridor_entry',
                          'border_entry',
                          'destination_entry',
                          'destination_exit',
                          'destination_region_entry',
                          'destination_region_exit'
                      )
                )
            ELSE TRUE
        END
    $g$,
    rule_version = 'phase48_v1',
    updated_at = NOW()
WHERE is_active
  AND event_code = 'trip_closed'
  AND to_stop_state = 'trip_closure';

-- -------------------------------------------------------------
-- 2) Builder hardening: do not emit return-origin milestones unless
--    outbound transition evidence exists.
-- -------------------------------------------------------------
DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_anchor_filter TEXT := E'    WHERE tc.return_origin_entry IS NOT NULL\n      AND UPPER(COALESCE(tc.return_origin_name, '''')) <> ''ASAS IRINGA YARD''\n      AND NOT EXISTS (';
    v_anchor_filter_new TEXT := E'    WHERE tc.return_origin_entry IS NOT NULL\n      AND UPPER(COALESCE(tc.return_origin_name, '''')) <> ''ASAS IRINGA YARD''\n      AND EXISTS (\n          SELECT 1\n          FROM trip_state_events p\n          WHERE p.trip_key = tc.trip_key\n            AND p.event_time <= tc.return_origin_entry\n            AND p.event_code IN (\n                ''origin_exit'',\n                ''corridor_entry'',\n                ''border_entry'',\n                ''destination_entry'',\n                ''destination_exit'',\n                ''destination_region_entry'',\n                ''destination_region_exit''\n            )\n      )\n      AND NOT EXISTS (';
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := REPLACE(v_def, v_anchor_filter, v_anchor_filter_new);

    -- Idempotent behavior:
    -- 1) If old block exists -> patch it.
    -- 2) If already patched -> leave function as-is.
    -- 3) Otherwise fail loudly (unexpected function drift).
    IF v_new = v_def THEN
        IF POSITION(v_anchor_filter_new IN v_def) > 0 THEN
            v_new := v_def;
        ELSE
            RAISE EXCEPTION 'Phase 48 patch failed: expected return-origin WHERE block not found in build_trip_state_events_v2.';
        END IF;
    END IF;

    -- keep rule tag aligned in builder context
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase48_v1'', true);',
        'n'
    );

    EXECUTE v_new;
END;
$$;
