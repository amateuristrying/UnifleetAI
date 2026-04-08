-- =============================================================
-- TAT V2 REFACTOR: Phase 67
-- Advanced Border Definitions & Routing Alignments
--
-- PURPOSE:
-- 1. Updates ASAS CHAPWA to act functionally as a Tunduma border
--    queue extension instead of just a generic ops yard.
-- 2. Eliminates the generic 'other' border grouping in the core
--    state machine. Borders like Chirundu, Kabanga, Rusumo will
--    now identify natively by their exact names.
-- =============================================================

-- ── 1. ASAS CHAPWA Border Reclassification ──────────────────────────────────
-- Promote ASAS CHAPWA inside the Geofence definitions so the state machine
-- treats events there natively as border crossing events.
DO $$
DECLARE
    v_geofence_id UUID;
BEGIN
    SELECT geofence_id INTO v_geofence_id
    FROM geofence_master
    WHERE UPPER(canonical_name) = 'ASAS CHAPWA';

    IF FOUND THEN
        -- Set core site type
        UPDATE geofence_master
        SET site_type = 'border'
        WHERE geofence_id = v_geofence_id;

        -- Promote to border_crossing in role mapping so state machine picks it up
        UPDATE geofence_role_map
        SET role_code = 'border_crossing'
        WHERE geofence_id = v_geofence_id;

        -- If it didn't exist in role map, insert it
        IF NOT FOUND THEN
            INSERT INTO geofence_role_map (geofence_id, role_code, priority, trip_stage)
            VALUES (v_geofence_id, 'border_crossing', 10, 'transit');
        END IF;
    END IF;
END $$;


-- ── 2. Redefine resolve_border_code without 'Other' ──────────────────────────
-- The previous version aggressively flattened any non-Congo/Zambia border
-- into 'other'. We now allow dynamic name passthrough so Routes can differentiate
-- between Kabanga, Chirundu, Rusumo, etc.
CREATE OR REPLACE FUNCTION resolve_border_code(p_canonical_name TEXT)
RETURNS TABLE(border_code TEXT, border_family TEXT, country_code TEXT)
LANGUAGE sql STABLE AS $$
    SELECT
        -- EXACT BORDER CODE (Granular Node Identity)
        CASE
            WHEN p_canonical_name ILIKE '%tunduma%'      THEN 'tunduma'
            -- Map ASAS Chapwa explicitly to Tunduma logic
            WHEN p_canonical_name ILIKE '%asas chapwa%'  THEN 'tunduma'
            WHEN p_canonical_name ILIKE '%nakonde%'      THEN 'nakonde'
            WHEN p_canonical_name ILIKE '%kasumbalesa%'  THEN 'kasumbalesa'
            WHEN p_canonical_name ILIKE '%sakania%'      THEN 'sakania'
            WHEN p_canonical_name ILIKE '%mokambo%'      THEN 'mokambo'
            WHEN p_canonical_name ILIKE '%chembe%'       THEN 'chembe'
            WHEN p_canonical_name ILIKE '%kasumulu%'     THEN 'kasumulu'
            WHEN p_canonical_name ILIKE '%chirundu%'     THEN 'chirundu'
            WHEN p_canonical_name ILIKE '%kabanga%'      THEN 'kabanga'
            WHEN p_canonical_name ILIKE '%rusumo%'       THEN 'rusumo'
            WHEN p_canonical_name ILIKE '%mutukula%'     THEN 'mutukula'
            WHEN p_canonical_name ILIKE '%namanga%'      THEN 'namanga'
            -- For any other random border, simply strip 'BORDER' out and lowercase it. NO MORE 'other'
            ELSE LOWER(TRIM(REPLACE(REPLACE(p_canonical_name, 'BORDER', ''), 'CUSTOMS', '')))
        END AS border_code,

        -- BORDER FAMILY (Queuing zones / Joint boundaries)
        CASE
            WHEN p_canonical_name ILIKE '%tunduma%'      THEN 'tunduma_nakonde'
            WHEN p_canonical_name ILIKE '%asas chapwa%'  THEN 'tunduma_nakonde'
            WHEN p_canonical_name ILIKE '%nakonde%'      THEN 'tunduma_nakonde'
            WHEN p_canonical_name ILIKE '%kasumbalesa%'  THEN 'kasumbalesa'
            WHEN p_canonical_name ILIKE '%sakania%'      THEN 'sakania'
            WHEN p_canonical_name ILIKE '%mokambo%'      THEN 'mokambo'
            WHEN p_canonical_name ILIKE '%chembe%'       THEN 'chembe'
            WHEN p_canonical_name ILIKE '%kasumulu%'     THEN 'kasumulu'
            WHEN p_canonical_name ILIKE '%chirundu%'     THEN 'chirundu_family'
            WHEN p_canonical_name ILIKE '%kabanga%'      THEN 'kabanga_family'
            WHEN p_canonical_name ILIKE '%rusumo%'       THEN 'rusumo_family'
            -- Use generic fallback based on its own name
            ELSE LOWER(TRIM(REPLACE(REPLACE(p_canonical_name, 'BORDER', ''), 'CUSTOMS', ''))) || '_family'
        END AS border_family,

        -- COUNTRY CODE (Directionality Analysis)
        CASE
            WHEN p_canonical_name ILIKE '%tunduma%'      THEN 'TZ'
            WHEN p_canonical_name ILIKE '%asas chapwa%'  THEN 'TZ'
            WHEN p_canonical_name ILIKE '%nakonde%'      THEN 'ZM'
            WHEN p_canonical_name ILIKE '%kasumbalesa%'  THEN 'ZM'
            WHEN p_canonical_name ILIKE '%sakania%'      THEN 'DRC'
            WHEN p_canonical_name ILIKE '%mokambo%'      THEN 'ZM'
            WHEN p_canonical_name ILIKE '%chembe%'       THEN 'ZM'
            WHEN p_canonical_name ILIKE '%kasumulu%'     THEN 'TZ'
            WHEN p_canonical_name ILIKE '%chirundu%'     THEN 'ZM'
            WHEN p_canonical_name ILIKE '%kabanga%'      THEN 'TZ'
            WHEN p_canonical_name ILIKE '%rusumo%'       THEN 'TZ'
            ELSE NULL
        END AS country_code
$$;

-- ── 3. Force-recalculate existing Border Facts ────────────────────────────────
-- Because we changed ASAS CHAPWA and 'other' logic, we sweep the base table
-- to ensure current active rows update themselves without needing a full rebuild.
UPDATE trip_state_events tse
SET
    border_code = rb.border_code,
    border_family = rb.border_family,
    country_code = rb.country_code
FROM trip_state_events t
CROSS JOIN LATERAL resolve_border_code(t.canonical_name) rb
WHERE tse.event_id = t.event_id
  AND tse.event_code IN ('border_entry', 'border_exit', 'return_border_entry', 'return_border_exit')
  AND (tse.border_code = 'other' OR tse.canonical_name ILIKE '%asas chapwa%');

-- Force sweep internal border facts row table with updated codes
UPDATE tat_trip_border_facts_v2 bf
SET
    border_code = rb.border_code,
    border_family = rb.border_family,
    country_code = rb.country_code
FROM tat_trip_border_facts_v2 t
JOIN trip_state_events tse ON t.trip_key = tse.trip_key AND t.border_code = tse.border_code AND t.entry_time = tse.event_time
CROSS JOIN LATERAL resolve_border_code(tse.canonical_name) rb
WHERE bf.trip_border_id = t.trip_border_id
  AND (bf.border_code = 'other' OR bf.border_code = 'asas_chapwa');
