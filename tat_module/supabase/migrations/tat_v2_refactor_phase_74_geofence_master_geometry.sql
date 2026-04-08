-- =============================================================
-- TAT V2 REFACTOR: Phase 74
-- Populate geofence_master.geom from geofences table
--
-- Problem:
--   geofence_master stores canonical names for all operational sites
--   but has no spatial geometry. The `geofences` table (Navixy-synced)
--   has polygon/circle geometries but is not linked to geofence_master.
--   Phase 72 live engine uses geofences.geom for real-time detection,
--   so loading terminals (origin_terminal) are undetectable unless their
--   polygons exist in `geofences` with a matching name.
--
-- This migration:
--   1. Adds geom column to geofence_master (if not already present)
--   2. Populates geom by matching geofence_master.canonical_name
--      against geofences.name (case-insensitive, exact then via aliases)
--   3. Creates a spatial index for fast intersection queries
--
-- Match priority:
--   Pass 1 — exact case-insensitive match: canonical_name = geofences.name
--   Pass 2 — alias match: geofence_aliases.alias_name = geofences.name
--            (covers geofences whose Navixy name is an alias, not canonical)
-- =============================================================

-- 1. Add geom column to geofence_master (safe, no-op if already exists)
ALTER TABLE public.geofence_master
    ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326);

-- 2. Pass 1 — direct name match
UPDATE public.geofence_master gm
SET geom = g.geom
FROM public.geofences g
WHERE UPPER(g.name) = UPPER(gm.canonical_name)
  AND g.geom IS NOT NULL
  AND gm.geom IS NULL;   -- don't overwrite existing geometry

-- 3. Pass 2 — alias fallback (for geofences whose Navixy name is an alias)
UPDATE public.geofence_master gm
SET geom = g.geom
FROM public.geofence_aliases ga
JOIN public.geofences g
  ON UPPER(g.name) = UPPER(ga.alias_name)
WHERE ga.geofence_id = gm.geofence_id
  AND g.geom IS NOT NULL
  AND gm.geom IS NULL;   -- only fill gaps not covered by Pass 1

-- 4. Spatial index for intersection queries
CREATE INDEX IF NOT EXISTS idx_geofence_master_geom
    ON public.geofence_master USING GIST (geom);

-- 5. Summary report — shows what was matched and what is still missing
SELECT
    gm.default_role_code,
    COUNT(*)                                         AS total,
    COUNT(gm.geom)                                   AS geometry_populated,
    COUNT(*) FILTER (WHERE gm.geom IS NULL)          AS geometry_missing,
    ROUND(COUNT(gm.geom) * 100.0 / COUNT(*), 1)     AS pct_covered
FROM public.geofence_master gm
GROUP BY gm.default_role_code
ORDER BY total DESC;
