-- Broader candidate search for the 7 remaining entries with no geometry.
-- Searches geofences.name for ANY word from the canonical name (not just the first).
-- Also shows entries with NULL geom in geofences (polygon not drawn in Navixy).

SELECT
    m.canonical_name,
    gm.default_role_code,
    g.name        AS geofences_name,
    g.ops_region,
    g.geom IS NOT NULL AS has_geom,
    g.radius_meters
FROM (VALUES
    ('ORYX DAR DEPO'),
    ('WORLD OIL DEPOT'),
    ('KOLWEZI OFFLOADING'),
    ('LUBUMBASHI'),
    ('CHIMUTANDA'),
    ('IGAWA'),
    ('KIGOMA')
) AS m(canonical_name)
JOIN public.geofence_master gm ON gm.canonical_name = m.canonical_name
CROSS JOIN LATERAL (
    -- Split canonical into words, find any geofence containing any of them
    SELECT g.name, g.ops_region, g.geom, g.radius_meters
    FROM public.geofences g
    WHERE (
        -- Word 1
        UPPER(g.name) LIKE '%' || SPLIT_PART(UPPER(m.canonical_name), ' ', 1) || '%'
        OR
        -- Word 2 (if exists)
        (SPLIT_PART(UPPER(m.canonical_name), ' ', 2) != ''
         AND UPPER(g.name) LIKE '%' || SPLIT_PART(UPPER(m.canonical_name), ' ', 2) || '%')
        OR
        -- Word 3 (if exists)
        (SPLIT_PART(UPPER(m.canonical_name), ' ', 3) != ''
         AND UPPER(g.name) LIKE '%' || SPLIT_PART(UPPER(m.canonical_name), ' ', 3) || '%')
    )
    ORDER BY
        -- Exact matches first
        (UPPER(TRIM(g.name)) = UPPER(TRIM(m.canonical_name))) DESC,
        -- Then entries with geometry
        (g.geom IS NOT NULL) DESC,
        g.name ASC
    LIMIT 5
) g
ORDER BY m.canonical_name, g.geom IS NOT NULL DESC, g.name;
