-- =============================================================
-- TAT V2 REFACTOR: Phase 49
-- Ensure return-origin is detected only AFTER trip progression starts.
--
-- Problem:
--   return_origin_entry candidate could be picked too early (still inside
--   origin context), then rejected by phase48 transition guard, and no later
--   return-origin candidate was considered. This caused fallback closure by
--   next_loading even when the truck actually returned earlier.
--
-- Fix:
--   In _trip_context return-origin derivation, require candidate origin stop
--   to be after progression threshold:
--     GREATEST(
--       destination threshold,
--       first progression signal (corridor/border/customs/destination),
--       origin_exit candidate
--     )
-- =============================================================

-- Keep transition-policy lineage in sync with current phase tag.
UPDATE public.tat_state_transition_policy_v2
SET
    rule_version = 'phase49_v1',
    updated_at = NOW()
WHERE is_active
  AND event_code IN ('return_origin_entry', 'trip_closed');

DO $$
DECLARE
    v_def TEXT;
    v_new TEXT;
    v_threshold_old TEXT := E'          AND ov.visit_start_utc > COALESCE(\n                dse.dest_exit,\n                dre.dest_region_exit,\n                ds.dest_entry,\n                dr.dest_region_entry,\n                ls.session_out\n          )';
    v_threshold_new TEXT := E'          AND ov.visit_start_utc > GREATEST(\n                COALESCE(\n                    dse.dest_exit,\n                    dre.dest_region_exit,\n                    ds.dest_entry,\n                    dr.dest_region_entry,\n                    ls.session_out\n                ),\n                COALESCE(sig.first_signal, ls.session_out),\n                COALESCE(ox.origin_exit, ls.session_out)\n          )';
BEGIN
    SELECT pg_get_functiondef('public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure)
      INTO v_def;

    v_new := REPLACE(v_def, v_threshold_old, v_threshold_new);

    -- Idempotent behavior:
    -- 1) Patch old threshold when present
    -- 2) If already patched, keep as-is
    -- 3) Fail on unexpected drift
    IF v_new = v_def THEN
        IF POSITION(v_threshold_new IN v_def) > 0 THEN
            v_new := v_def;
        ELSE
            RAISE EXCEPTION 'Phase 49 patch failed: return-origin threshold block not found in build_trip_state_events_v2.';
        END IF;
    END IF;

    -- Align builder rule tag for observability lineage.
    v_new := regexp_replace(
        v_new,
        'PERFORM set_config\(''tat.current_rule_version'', ''phase[0-9]+_v1'', true\);',
        'PERFORM set_config(''tat.current_rule_version'', ''phase49_v1'', true);',
        'n'
    );

    EXECUTE v_new;
END;
$$;

