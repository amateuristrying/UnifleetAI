-- =============================================================
-- TAT V2 REFACTOR: Phase 69 Hotfix
-- Re-sweep 'other' border facts directly from the border_name.
-- 
-- The previous phase updated trip_state_events first, which
-- accidentally broke the JOIN condition for the border_facts
-- update table. This sweeps border_facts directly.
-- =============================================================

UPDATE tat_trip_border_facts_v2 bf
SET
    border_code = rb.border_code,
    border_family = rb.border_family,
    country_code = rb.country_code
FROM tat_trip_border_facts_v2 t
CROSS JOIN LATERAL resolve_border_code(t.border_name) rb
WHERE bf.trip_border_id = t.trip_border_id
  AND t.border_code = 'other';
