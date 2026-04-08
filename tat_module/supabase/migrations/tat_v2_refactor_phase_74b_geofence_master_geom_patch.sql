-- =============================================================
-- TAT V2 REFACTOR: Phase 74b
-- Geometry patch: alias inserts + TRIM re-pass for whitespace mismatches
--
-- Phase 74 Pass 1 missed 4 entries with whitespace/case differences:
--   MOKAMBO BORDER, UYOLE MIZANI, LUWINGU, MLANDIZI WASHING BAY
--   → geofences.name has extra/double spaces; UPPER() alone didn't match.
--
-- Also adds aliases for 5 clear name mismatches identified by diagnostic.
-- Entries with no Navixy polygon (CHIMUTANDA, IGAWA, KIGOMA, ORYX DAR DEPO,
-- WORLD OIL DEPOT, KOLWEZI OFFLOADING, LUBUMBASHI) are left for manual action.
-- =============================================================

-- ── Pass 1b: re-run with TRIM to catch trailing/double-space mismatches ──
UPDATE public.geofence_master gm
SET geom = g.geom
FROM public.geofences g
WHERE UPPER(TRIM(REGEXP_REPLACE(g.name, '\s+', ' ', 'g')))
    = UPPER(TRIM(REGEXP_REPLACE(gm.canonical_name, '\s+', ' ', 'g')))
  AND g.geom IS NOT NULL
  AND gm.geom IS NULL;

-- ── Aliases for clear name mismatches ────────────────────────────────────
-- Each INSERT maps the Navixy geofences.name (alias_name) to the
-- geofence_master entry it represents, so Pass 2 can copy the geometry.

INSERT INTO public.geofence_aliases (geofence_id, alias_name, normalized_name, confidence_score)
SELECT
    gm.geofence_id,
    candidate.alias_name,
    UPPER(TRIM(REGEXP_REPLACE(candidate.alias_name, '\s+', ' ', 'g'))),
    candidate.confidence
FROM (VALUES
    -- CHAPWA (corridor_checkpoint) → Navixy "ASAS Chapwa  Yard"
    ('CHAPWA',          'ASAS Chapwa  Yard',              0.85),
    -- UYOLE MIZANI (corridor_checkpoint) → Navixy "UYOLE  MIZANI" (double space)
    ('UYOLE MIZANI',    'UYOLE  MIZANI',                  0.95),
    -- KILUVYA GATEWAY (origin_gateway) → Navixy "Kiluvya to Mbezi  Geofence"
    ('KILUVYA GATEWAY', 'Kiluvya to Mbezi  Geofence',     0.85),
    -- ASAS DAR OFFICE (ops_yard) → Navixy "ASAS DSM Office / Dar W/Shop"
    ('ASAS DAR OFFICE', 'ASAS DSM Office / Dar W/Shop',   0.90),
    -- OILCOM TERMINAL (origin_terminal_dar) → Navixy "Oilcom Dar Depo"
    ('OILCOM TERMINAL', 'Oilcom Dar Depo',                0.90)
) AS candidate(canonical_name, alias_name, confidence)
JOIN public.geofence_master gm
  ON gm.canonical_name = candidate.canonical_name
-- Skip if alias already exists
ON CONFLICT (alias_name) DO NOTHING;

-- ── Pass 2 re-run: pick up newly added aliases ────────────────────────────
UPDATE public.geofence_master gm
SET geom = g.geom
FROM public.geofence_aliases ga
JOIN public.geofences g
  ON UPPER(TRIM(REGEXP_REPLACE(g.name, '\s+', ' ', 'g')))
   = UPPER(TRIM(REGEXP_REPLACE(ga.alias_name, '\s+', ' ', 'g')))
WHERE ga.geofence_id = gm.geofence_id
  AND g.geom IS NOT NULL
  AND gm.geom IS NULL;

-- ── Final coverage report ────────────────────────────────────────────────
SELECT
    gm.default_role_code,
    COUNT(*)                                     AS total,
    COUNT(gm.geom)                               AS geometry_populated,
    COUNT(*) FILTER (WHERE gm.geom IS NULL)      AS geometry_missing
FROM public.geofence_master gm
GROUP BY gm.default_role_code
HAVING COUNT(*) FILTER (WHERE gm.geom IS NULL) > 0
ORDER BY gm.default_role_code;

-- ── Remaining missing — require manual Navixy polygon or review ──────────
SELECT
    gm.default_role_code,
    gm.canonical_name AS still_missing
FROM public.geofence_master gm
WHERE gm.geom IS NULL
ORDER BY gm.default_role_code, gm.canonical_name;
