-- =============================================================
-- TAT V2 REFACTOR: Phase 74c
-- Remove irrelevant geofence_master entries with no matching Navixy polygon
--
-- These 7 entries have no geometry and no matching geofence in Navixy.
-- They are not operationally relevant and are removed from master.
-- Aliases and role_map entries are deleted first (FK dependency).
-- =============================================================

-- Remove dependent aliases first
DELETE FROM public.geofence_aliases
WHERE geofence_id IN (
    SELECT geofence_id FROM public.geofence_master
    WHERE canonical_name IN (
        'CHIMUTANDA', 'IGAWA', 'KIGOMA',
        'KOLWEZI OFFLOADING', 'LUBUMBASHI',
        'ORYX DAR DEPO', 'WORLD OIL DEPOT'
    )
);

-- Remove dependent role_map entries
DELETE FROM public.geofence_role_map
WHERE geofence_id IN (
    SELECT geofence_id FROM public.geofence_master
    WHERE canonical_name IN (
        'CHIMUTANDA', 'IGAWA', 'KIGOMA',
        'KOLWEZI OFFLOADING', 'LUBUMBASHI',
        'ORYX DAR DEPO', 'WORLD OIL DEPOT'
    )
);

-- Remove from master
DELETE FROM public.geofence_master
WHERE canonical_name IN (
    'CHIMUTANDA', 'IGAWA', 'KIGOMA',
    'KOLWEZI OFFLOADING', 'LUBUMBASHI',
    'ORYX DAR DEPO', 'WORLD OIL DEPOT'
);

-- Confirm: should return 0
SELECT COUNT(*) AS remaining_with_no_geom
FROM public.geofence_master
WHERE geom IS NULL;
