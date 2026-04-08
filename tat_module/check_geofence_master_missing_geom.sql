-- Show exactly which geofence_master entries have no geometry,
-- alongside any candidate matches in geofences (partial name similarity)
-- so you can decide whether to add aliases or if the Navixy geofence is missing entirely.

SELECT
    gm.default_role_code,
    gm.canonical_name                              AS missing_canonical,
    -- Candidate matches from geofences: names containing the first word of canonical
    -- (e.g. canonical "ORYX MTWARA DEPOT" → look for geofences containing "ORYX")
    (
        SELECT string_agg(g.name, ' | ' ORDER BY g.name)
        FROM public.geofences g
        WHERE g.geom IS NOT NULL
          AND UPPER(g.name) LIKE '%' || SPLIT_PART(UPPER(gm.canonical_name), ' ', 1) || '%'
        LIMIT 5
    )                                              AS candidate_geofence_names
FROM public.geofence_master gm
WHERE gm.geom IS NULL
ORDER BY gm.default_role_code, gm.canonical_name;
