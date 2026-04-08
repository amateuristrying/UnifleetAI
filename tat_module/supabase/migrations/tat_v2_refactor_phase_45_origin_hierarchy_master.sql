-- =============================================================
-- TAT V2 REFACTOR: Phase 45
-- Origin hierarchy rollout:
--   1) Apply user-approved master hierarchy in geofence metadata.
--   2) Enforce one active origin role per listed canonical geofence.
--   3) Make stop-state + trip-builder logic prefix-aware for role families:
--      origin_terminal_*, origin_zone_*, origin_gateway*.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Master hierarchy upsert (metadata + role map)
-- -------------------------------------------------------------
WITH hierarchy_mapping AS (
    SELECT *
    FROM (
        VALUES
            ('DAR GEOFENCE',             'origin_gateway',          'gateway',  'TZ', TRUE),
            ('KILUVYA GATEWAY',          'origin_gateway',          'gateway',  'TZ', TRUE),
            ('CAMEL OIL',                'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('INPETRO',                  'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('LAKE OIL',                 'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('MOUNT MERU',               'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('PETROBEIRA',               'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('PETRODA',                  'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('XSTORAGE',                 'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('AFROIL DEPOT',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('CAMEL OIL (T)',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('GBP DAR DEPOT',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('HASS DEPOT',               'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('LAKE OIL TANZANIA',        'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOGAS OIL DEPOT',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOIL DEPOT',               'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOUNT MERU (T)',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOUNT MERU DAR TERMINAL',  'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('OILCOM DAR DEPO',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('OILCOM TERMINAL',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX DAR DEPO',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX FUEL DEPOT',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX KIGAMBONI',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX LUBRICANT',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('PUMA KURASINI',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('SAHARA DEPOT',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('STAR OIL DEPOT',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('SUPERSTAR FUEL DEPOT',     'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('TIPER DEPOT',              'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('TOTAL GAPCO DAR',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('WORLD OIL DEPOT',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('WORLD OIL T1',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('WORLD OIL T2',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('VIVO MOMBASA',             'origin_terminal_mombasa', 'terminal', 'KE', TRUE),
            ('OILCOM MTWARA DEPOT',      'origin_terminal_mtwara',  'terminal', 'TZ', TRUE),
            ('ORYX MTWARA DEPOT',        'origin_terminal_mtwara',  'terminal', 'TZ', TRUE),
            ('GBP TANGA TERMINAL',       'origin_terminal_tanga',   'terminal', 'TZ', TRUE),
            ('BEIRA ZONE',               'origin_zone_beira',       'zone',     'MZ', TRUE),
            ('KURASINI ZONE',            'origin_zone_kurasini',    'zone',     'TZ', TRUE),
            ('MOMBASA ZONE',             'origin_zone_mombasa',     'zone',     'KE', TRUE),
            ('MTWARA ZONE',              'origin_zone_mtwara',      'zone',     'TZ', TRUE),
            ('TANGA ZONE',               'origin_zone_tanga',       'zone',     'TZ', TRUE)
    ) AS t(canonical_name, default_role_code, site_type, country_code, is_active)
),
typed_mapping AS (
    SELECT
        hm.canonical_name,
        hm.default_role_code,
        hm.site_type,
        hm.country_code,
        hm.is_active,
        'loading'::text AS trip_stage,
        CASE
            WHEN hm.site_type = 'terminal' THEN 5
            WHEN hm.site_type = 'zone'     THEN 3
            WHEN hm.site_type = 'gateway'  THEN 1
            ELSE 1
        END AS priority
    FROM hierarchy_mapping hm
)
INSERT INTO geofence_master (canonical_name, default_role_code, site_type, country_code, is_active)
SELECT
    tm.canonical_name,
    tm.default_role_code,
    tm.site_type,
    tm.country_code,
    tm.is_active
FROM typed_mapping tm
ON CONFLICT (canonical_name) DO UPDATE
SET
    default_role_code = EXCLUDED.default_role_code,
    site_type = EXCLUDED.site_type,
    country_code = EXCLUDED.country_code,
    is_active = EXCLUDED.is_active;

WITH hierarchy_mapping AS (
    SELECT *
    FROM (
        VALUES
            ('DAR GEOFENCE',             'origin_gateway',          'gateway',  'TZ', TRUE),
            ('KILUVYA GATEWAY',          'origin_gateway',          'gateway',  'TZ', TRUE),
            ('CAMEL OIL',                'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('INPETRO',                  'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('LAKE OIL',                 'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('MOUNT MERU',               'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('PETROBEIRA',               'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('PETRODA',                  'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('XSTORAGE',                 'origin_terminal_beira',   'terminal', 'MZ', TRUE),
            ('AFROIL DEPOT',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('CAMEL OIL (T)',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('GBP DAR DEPOT',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('HASS DEPOT',               'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('LAKE OIL TANZANIA',        'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOGAS OIL DEPOT',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOIL DEPOT',               'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOUNT MERU (T)',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('MOUNT MERU DAR TERMINAL',  'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('OILCOM DAR DEPO',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('OILCOM TERMINAL',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX DAR DEPO',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX FUEL DEPOT',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX KIGAMBONI',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('ORYX LUBRICANT',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('PUMA KURASINI',            'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('SAHARA DEPOT',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('STAR OIL DEPOT',           'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('SUPERSTAR FUEL DEPOT',     'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('TIPER DEPOT',              'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('TOTAL GAPCO DAR',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('WORLD OIL DEPOT',          'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('WORLD OIL T1',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('WORLD OIL T2',             'origin_terminal_dar',     'terminal', 'TZ', TRUE),
            ('VIVO MOMBASA',             'origin_terminal_mombasa', 'terminal', 'KE', TRUE),
            ('OILCOM MTWARA DEPOT',      'origin_terminal_mtwara',  'terminal', 'TZ', TRUE),
            ('ORYX MTWARA DEPOT',        'origin_terminal_mtwara',  'terminal', 'TZ', TRUE),
            ('GBP TANGA TERMINAL',       'origin_terminal_tanga',   'terminal', 'TZ', TRUE),
            ('BEIRA ZONE',               'origin_zone_beira',       'zone',     'MZ', TRUE),
            ('KURASINI ZONE',            'origin_zone_kurasini',    'zone',     'TZ', TRUE),
            ('MOMBASA ZONE',             'origin_zone_mombasa',     'zone',     'KE', TRUE),
            ('MTWARA ZONE',              'origin_zone_mtwara',      'zone',     'TZ', TRUE),
            ('TANGA ZONE',               'origin_zone_tanga',       'zone',     'TZ', TRUE)
    ) AS t(canonical_name, default_role_code, site_type, country_code, is_active)
),
typed_mapping AS (
    SELECT
        hm.canonical_name,
        hm.default_role_code,
        hm.country_code,
        'loading'::text AS trip_stage,
        CASE
            WHEN hm.site_type = 'terminal' THEN 5
            WHEN hm.site_type = 'zone'     THEN 3
            WHEN hm.site_type = 'gateway'  THEN 1
            ELSE 1
        END AS priority
    FROM hierarchy_mapping hm
)
INSERT INTO geofence_role_map (geofence_id, role_code, trip_stage, priority)
SELECT
    gm.geofence_id,
    tm.default_role_code,
    tm.trip_stage,
    tm.priority
FROM typed_mapping tm
JOIN geofence_master gm
  ON gm.canonical_name = tm.canonical_name
ON CONFLICT (geofence_id, role_code) DO UPDATE
SET
    trip_stage = EXCLUDED.trip_stage,
    priority = EXCLUDED.priority;

-- Keep listed canonicals single-role for deterministic normalization.
WITH hierarchy_mapping AS (
    SELECT *
    FROM (
        VALUES
            ('DAR GEOFENCE'),
            ('KILUVYA GATEWAY'),
            ('CAMEL OIL'),
            ('INPETRO'),
            ('LAKE OIL'),
            ('MOUNT MERU'),
            ('PETROBEIRA'),
            ('PETRODA'),
            ('XSTORAGE'),
            ('AFROIL DEPOT'),
            ('CAMEL OIL (T)'),
            ('GBP DAR DEPOT'),
            ('HASS DEPOT'),
            ('LAKE OIL TANZANIA'),
            ('MOGAS OIL DEPOT'),
            ('MOIL DEPOT'),
            ('MOUNT MERU (T)'),
            ('MOUNT MERU DAR TERMINAL'),
            ('OILCOM DAR DEPO'),
            ('OILCOM TERMINAL'),
            ('ORYX DAR DEPO'),
            ('ORYX FUEL DEPOT'),
            ('ORYX KIGAMBONI'),
            ('ORYX LUBRICANT'),
            ('PUMA KURASINI'),
            ('SAHARA DEPOT'),
            ('STAR OIL DEPOT'),
            ('SUPERSTAR FUEL DEPOT'),
            ('TIPER DEPOT'),
            ('TOTAL GAPCO DAR'),
            ('WORLD OIL DEPOT'),
            ('WORLD OIL T1'),
            ('WORLD OIL T2'),
            ('VIVO MOMBASA'),
            ('OILCOM MTWARA DEPOT'),
            ('ORYX MTWARA DEPOT'),
            ('GBP TANGA TERMINAL'),
            ('BEIRA ZONE'),
            ('KURASINI ZONE'),
            ('MOMBASA ZONE'),
            ('MTWARA ZONE'),
            ('TANGA ZONE')
    ) AS t(canonical_name)
)
DELETE FROM geofence_role_map rm
USING geofence_master gm
JOIN hierarchy_mapping hm
  ON hm.canonical_name = gm.canonical_name
WHERE rm.geofence_id = gm.geofence_id
  AND rm.role_code <> gm.default_role_code;

-- -------------------------------------------------------------
-- 2) Role-family helper + stop-state mapping (prefix-aware)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.role_family_v2(
    p_role_code TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    WITH norm AS (
        SELECT LOWER(COALESCE(p_role_code, '')) AS rc
    )
    SELECT
        CASE
            WHEN rc LIKE 'origin_terminal%' THEN 'origin_terminal'
            WHEN rc LIKE 'origin_zone%'     THEN 'origin_zone'
            WHEN rc LIKE 'origin_gateway%'  THEN 'origin_gateway'
            WHEN rc LIKE 'origin_region%'   THEN 'origin_region'
            ELSE rc
        END
    FROM norm;
$$;

CREATE OR REPLACE FUNCTION public.map_role_to_stop_state_v2(
    p_role_code TEXT,
    p_trip_stage TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    WITH role_norm AS (
        SELECT public.role_family_v2(p_role_code) AS role_family
    )
    SELECT
        CASE
            WHEN role_family IN ('destination_site', 'customer_site', 'lpg_site')
                THEN 'destination_stop'
            WHEN role_family IN ('origin_terminal', 'origin_zone')
                THEN 'origin_loading_stop'
            WHEN role_family = 'customs_site'
                THEN 'customs_stop'
            WHEN role_family IN ('ops_yard', 'origin_base', 'origin_gateway', 'origin_region')
                THEN 'operational_stop'
            WHEN role_family IN ('destination_region', 'local_delivery_site')
                THEN 'destination_region_presence'
            WHEN role_family IN ('border_tz', 'border_zm', 'border_drc', 'border_other')
                THEN 'border_crossing'
            WHEN role_family IN ('corridor_checkpoint', 'corridor_region')
                THEN 'corridor_transit'
            ELSE 'other'
        END
    FROM role_norm;
$$;

CREATE OR REPLACE FUNCTION public.map_visit_stop_state_v2(
    p_canonical_name TEXT,
    p_role_code TEXT,
    p_trip_stage TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    WITH ctx AS (
        SELECT
            UPPER(COALESCE(p_canonical_name, '')) AS canonical_name_up,
            public.role_family_v2(p_role_code) AS role_family
    )
    SELECT
        CASE
            -- ASAS control-tower yards can still express destination/loading
            -- if source role indicates so; otherwise they are operational.
            WHEN canonical_name_up IN (
                'ASAS IRINGA YARD',
                'ASAS TABATA',
                'ASAS KIBAHA YARD',
                'ASAS DAR OFFICE'
            )
                THEN CASE
                    WHEN role_family IN ('customer_site', 'destination_site', 'lpg_site')
                        THEN 'destination_stop'
                    WHEN role_family IN ('local_delivery_site', 'destination_region')
                        THEN 'destination_region_presence'
                    WHEN role_family IN ('origin_terminal', 'origin_zone')
                        THEN 'origin_loading_stop'
                    ELSE 'operational_stop'
                END

            ELSE public.map_role_to_stop_state_v2(p_role_code, NULL)
        END
    FROM ctx;
$$;

-- -------------------------------------------------------------
-- 3) Backfill normalized rows for updated canonicals
-- -------------------------------------------------------------
WITH hierarchy_mapping AS (
    SELECT *
    FROM (
        VALUES
            ('DAR GEOFENCE',             'origin_gateway',          'TZ', 'gateway'),
            ('KILUVYA GATEWAY',          'origin_gateway',          'TZ', 'gateway'),
            ('CAMEL OIL',                'origin_terminal_beira',   'MZ', 'terminal'),
            ('INPETRO',                  'origin_terminal_beira',   'MZ', 'terminal'),
            ('LAKE OIL',                 'origin_terminal_beira',   'MZ', 'terminal'),
            ('MOUNT MERU',               'origin_terminal_beira',   'MZ', 'terminal'),
            ('PETROBEIRA',               'origin_terminal_beira',   'MZ', 'terminal'),
            ('PETRODA',                  'origin_terminal_beira',   'MZ', 'terminal'),
            ('XSTORAGE',                 'origin_terminal_beira',   'MZ', 'terminal'),
            ('AFROIL DEPOT',             'origin_terminal_dar',     'TZ', 'terminal'),
            ('CAMEL OIL (T)',            'origin_terminal_dar',     'TZ', 'terminal'),
            ('GBP DAR DEPOT',            'origin_terminal_dar',     'TZ', 'terminal'),
            ('HASS DEPOT',               'origin_terminal_dar',     'TZ', 'terminal'),
            ('LAKE OIL TANZANIA',        'origin_terminal_dar',     'TZ', 'terminal'),
            ('MOGAS OIL DEPOT',          'origin_terminal_dar',     'TZ', 'terminal'),
            ('MOIL DEPOT',               'origin_terminal_dar',     'TZ', 'terminal'),
            ('MOUNT MERU (T)',           'origin_terminal_dar',     'TZ', 'terminal'),
            ('MOUNT MERU DAR TERMINAL',  'origin_terminal_dar',     'TZ', 'terminal'),
            ('OILCOM DAR DEPO',          'origin_terminal_dar',     'TZ', 'terminal'),
            ('OILCOM TERMINAL',          'origin_terminal_dar',     'TZ', 'terminal'),
            ('ORYX DAR DEPO',            'origin_terminal_dar',     'TZ', 'terminal'),
            ('ORYX FUEL DEPOT',          'origin_terminal_dar',     'TZ', 'terminal'),
            ('ORYX KIGAMBONI',           'origin_terminal_dar',     'TZ', 'terminal'),
            ('ORYX LUBRICANT',           'origin_terminal_dar',     'TZ', 'terminal'),
            ('PUMA KURASINI',            'origin_terminal_dar',     'TZ', 'terminal'),
            ('SAHARA DEPOT',             'origin_terminal_dar',     'TZ', 'terminal'),
            ('STAR OIL DEPOT',           'origin_terminal_dar',     'TZ', 'terminal'),
            ('SUPERSTAR FUEL DEPOT',     'origin_terminal_dar',     'TZ', 'terminal'),
            ('TIPER DEPOT',              'origin_terminal_dar',     'TZ', 'terminal'),
            ('TOTAL GAPCO DAR',          'origin_terminal_dar',     'TZ', 'terminal'),
            ('WORLD OIL DEPOT',          'origin_terminal_dar',     'TZ', 'terminal'),
            ('WORLD OIL T1',             'origin_terminal_dar',     'TZ', 'terminal'),
            ('WORLD OIL T2',             'origin_terminal_dar',     'TZ', 'terminal'),
            ('VIVO MOMBASA',             'origin_terminal_mombasa', 'KE', 'terminal'),
            ('OILCOM MTWARA DEPOT',      'origin_terminal_mtwara',  'TZ', 'terminal'),
            ('ORYX MTWARA DEPOT',        'origin_terminal_mtwara',  'TZ', 'terminal'),
            ('GBP TANGA TERMINAL',       'origin_terminal_tanga',   'TZ', 'terminal'),
            ('BEIRA ZONE',               'origin_zone_beira',       'MZ', 'zone'),
            ('KURASINI ZONE',            'origin_zone_kurasini',    'TZ', 'zone'),
            ('MOMBASA ZONE',             'origin_zone_mombasa',     'KE', 'zone'),
            ('MTWARA ZONE',              'origin_zone_mtwara',      'TZ', 'zone'),
            ('TANGA ZONE',               'origin_zone_tanga',       'TZ', 'zone')
    ) AS t(canonical_name, role_code, country_code, site_type)
),
typed_mapping AS (
    SELECT
        hm.canonical_name,
        hm.role_code,
        hm.country_code,
        'loading'::text AS trip_stage,
        CASE
            WHEN hm.site_type = 'terminal' THEN 5
            WHEN hm.site_type = 'zone'     THEN 3
            WHEN hm.site_type = 'gateway'  THEN 1
            ELSE 1
        END AS priority
    FROM hierarchy_mapping hm
)
UPDATE trip_geofence_events_normalized n
SET
    role_code = tm.role_code,
    trip_stage = tm.trip_stage,
    priority = tm.priority,
    country_code = tm.country_code,
    stop_state = public.map_visit_stop_state_v2(n.canonical_name, tm.role_code, tm.trip_stage)
FROM typed_mapping tm
WHERE n.canonical_name = tm.canonical_name
  AND (
      COALESCE(n.role_code, '') <> COALESCE(tm.role_code, '')
      OR COALESCE(n.trip_stage, '') <> COALESCE(tm.trip_stage, '')
      OR COALESCE(n.priority, -1) <> COALESCE(tm.priority, -1)
      OR COALESCE(n.country_code, '') <> COALESCE(tm.country_code, '')
      OR COALESCE(n.stop_state, '') <> COALESCE(public.map_visit_stop_state_v2(n.canonical_name, tm.role_code, tm.trip_stage), '')
  );

-- -------------------------------------------------------------
-- 4) Prefix-aware role checks in stream + state machine builder
-- -------------------------------------------------------------
DO $$
DECLARE
    v_stream_def TEXT;
    v_stream_new TEXT;
    v_state_def  TEXT;
    v_state_new  TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.get_tat_operational_visit_stream_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_stream_def;

    v_stream_new := v_stream_def;
    v_stream_new := REPLACE(
        v_stream_new,
        'AND cbr.role_code_l = ''origin_terminal''',
        'AND cbr.role_code_l LIKE ''origin_terminal%'''
    );
    v_stream_new := REPLACE(
        v_stream_new,
        'AND LOWER(COALESCE(n.role_code, '''')) = ''origin_terminal''',
        'AND LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_terminal%'''
    );

    IF v_stream_new <> v_stream_def THEN
        EXECUTE v_stream_new;
    END IF;

    SELECT pg_get_functiondef(
        'public.build_trip_state_events_v2(timestamptz,timestamptz,integer)'::regprocedure
    ) INTO v_state_def;

    v_state_new := v_state_def;

    v_state_new := REPLACE(
        v_state_new,
        'n.role_code IN (''origin_terminal'',''origin_zone'')',
        '(LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_terminal%'' OR LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_zone%'')'
    );
    v_state_new := REPLACE(
        v_state_new,
        'n.role_code IN (''origin_terminal'', ''origin_zone'')',
        '(LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_terminal%'' OR LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_zone%'')'
    );
    v_state_new := REPLACE(
        v_state_new,
        'role_code IN (''origin_terminal'', ''origin_zone'')',
        '(LOWER(COALESCE(role_code, '''')) LIKE ''origin_terminal%'' OR LOWER(COALESCE(role_code, '''')) LIKE ''origin_zone%'')'
    );
    v_state_new := REPLACE(
        v_state_new,
        'role_code IN (''origin_terminal'',''origin_zone'')',
        '(LOWER(COALESCE(role_code, '''')) LIKE ''origin_terminal%'' OR LOWER(COALESCE(role_code, '''')) LIKE ''origin_zone%'')'
    );
    v_state_new := REPLACE(
        v_state_new,
        'n.role_code = ''origin_zone''',
        'LOWER(COALESCE(n.role_code, '''')) LIKE ''origin_zone%'''
    );

    IF v_state_new <> v_state_def THEN
        EXECUTE v_state_new;
    END IF;
END;
$$;

-- -------------------------------------------------------------
-- 5) Lightweight diagnostics
-- -------------------------------------------------------------
DO $$
DECLARE
    v_master_count BIGINT;
    v_role_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_master_count
    FROM geofence_master
    WHERE canonical_name IN (
        'DAR GEOFENCE', 'KILUVYA GATEWAY', 'CAMEL OIL', 'INPETRO', 'LAKE OIL',
        'MOUNT MERU', 'PETROBEIRA', 'PETRODA', 'XSTORAGE', 'AFROIL DEPOT',
        'CAMEL OIL (T)', 'GBP DAR DEPOT', 'HASS DEPOT', 'LAKE OIL TANZANIA',
        'MOGAS OIL DEPOT', 'MOIL DEPOT', 'MOUNT MERU (T)', 'MOUNT MERU DAR TERMINAL',
        'OILCOM DAR DEPO', 'OILCOM TERMINAL', 'ORYX DAR DEPO', 'ORYX FUEL DEPOT',
        'ORYX KIGAMBONI', 'ORYX LUBRICANT', 'PUMA KURASINI', 'SAHARA DEPOT',
        'STAR OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'TIPER DEPOT', 'TOTAL GAPCO DAR',
        'WORLD OIL DEPOT', 'WORLD OIL T1', 'WORLD OIL T2', 'VIVO MOMBASA',
        'OILCOM MTWARA DEPOT', 'ORYX MTWARA DEPOT', 'GBP TANGA TERMINAL',
        'BEIRA ZONE', 'KURASINI ZONE', 'MOMBASA ZONE', 'MTWARA ZONE', 'TANGA ZONE'
    );

    SELECT COUNT(*) INTO v_role_count
    FROM geofence_role_map rm
    JOIN geofence_master gm ON gm.geofence_id = rm.geofence_id
    WHERE gm.canonical_name IN (
        'DAR GEOFENCE', 'KILUVYA GATEWAY', 'CAMEL OIL', 'INPETRO', 'LAKE OIL',
        'MOUNT MERU', 'PETROBEIRA', 'PETRODA', 'XSTORAGE', 'AFROIL DEPOT',
        'CAMEL OIL (T)', 'GBP DAR DEPOT', 'HASS DEPOT', 'LAKE OIL TANZANIA',
        'MOGAS OIL DEPOT', 'MOIL DEPOT', 'MOUNT MERU (T)', 'MOUNT MERU DAR TERMINAL',
        'OILCOM DAR DEPO', 'OILCOM TERMINAL', 'ORYX DAR DEPO', 'ORYX FUEL DEPOT',
        'ORYX KIGAMBONI', 'ORYX LUBRICANT', 'PUMA KURASINI', 'SAHARA DEPOT',
        'STAR OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'TIPER DEPOT', 'TOTAL GAPCO DAR',
        'WORLD OIL DEPOT', 'WORLD OIL T1', 'WORLD OIL T2', 'VIVO MOMBASA',
        'OILCOM MTWARA DEPOT', 'ORYX MTWARA DEPOT', 'GBP TANGA TERMINAL',
        'BEIRA ZONE', 'KURASINI ZONE', 'MOMBASA ZONE', 'MTWARA ZONE', 'TANGA ZONE'
    );

    RAISE NOTICE 'Phase45 hierarchy applied: master_rows=%, role_rows=%', v_master_count, v_role_count;
END;
$$;
