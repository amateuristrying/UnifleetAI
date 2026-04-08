-- =============================================================
-- TAT V2 REFACTOR: Extended Seed — Missing Geofences from V1
-- Dependency: tat_v2_refactor_seed.sql (initial seed must run first)
-- Purpose: Fills every geofence that exists in v1's CASE block but
--   was absent from the initial seed. Without this, Phase 2
--   normalization will mark these visits as 'unmapped' (confidence 0.20)
--   and trip lifecycle inference will silently degrade.
-- =============================================================
DO $$
DECLARE
    v_run_id UUID;
BEGIN
    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES ('PHASE_1_SEED_EXTENDED', 'running', '{"mode": "extended_seed"}'::jsonb)
    RETURNING run_id INTO v_run_id;

    CREATE TEMP TABLE tmp_ext_seed (
        raw_name      TEXT,
        canonical_name TEXT,
        role_code     TEXT,
        trip_stage    TEXT,
        country_code  TEXT,
        priority      INTEGER,
        site_type     TEXT
    ) ON COMMIT DROP;

    -- ─── LPG DEPOTS ─────────────────────────────────────────────────────────
    -- v1: L1_LPG_DEPOT  |  v2 role: lpg_site (Priority 5)
    INSERT INTO tmp_ext_seed VALUES
    ('DODOMA LPG DEPOT',        'DODOMA LPG DEPOT',       'lpg_site', 'at_destination', 'TZ', 5, 'terminal'),
    ('ORYX DODOMA LPG DEPOT',   'DODOMA LPG DEPOT',       'lpg_site', 'at_destination', 'TZ', 5, 'terminal'),
    ('MWANZA LPG DEPOT',        'MWANZA LPG DEPOT',       'lpg_site', 'at_destination', 'TZ', 5, 'terminal'),
    ('MOSHI LPG DEPOT',         'MOSHI LPG DEPOT',        'lpg_site', 'at_destination', 'TZ', 5, 'terminal'),
    ('IRINGA LPG DEPOT',        'IRINGA LPG DEPOT',       'lpg_site', 'at_destination', 'TZ', 5, 'terminal'),
    ('MBEYA LPG DEPOT',         'MBEYA LPG DEPOT',        'lpg_site', 'at_destination', 'TZ', 5, 'terminal');

    -- ─── OFFLOADING DESTINATIONS (Zambia / Malawi / East Africa) ────────────
    -- v1: L1_OFFLOADING  |  v2 role: destination_site (Priority 10)
    INSERT INTO tmp_ext_seed VALUES
    ('MZUZU OFFLOADING',    'MZUZU OFFLOADING',    'destination_site', 'at_destination', 'MW', 10, 'terminal'),
    ('LILONGWE',            'LILONGWE',            'destination_site', 'at_destination', 'MW', 10, 'terminal'),
    ('JINJA GF',            'JINJA',               'destination_site', 'at_destination', 'UG', 10, 'terminal'),
    ('KAMPALA GF',          'KAMPALA',             'destination_site', 'at_destination', 'UG', 10, 'terminal'),
    ('BUJUMBURA GF',        'BUJUMBURA',           'destination_site', 'at_destination', 'BI', 10, 'terminal'),
    ('KIGALI GF',           'KIGALI',              'destination_site', 'at_destination', 'RW', 10, 'terminal'),
    ('BLANTYRE',            'BLANTYRE',            'destination_site', 'at_destination', 'MW', 10, 'terminal'),
    ('BLANTYRE OFFLOADING', 'BLANTYRE',            'destination_site', 'at_destination', 'MW', 10, 'terminal'),
    ('NDOLA OFFLOADING',    'NDOLA OFFLOADING',    'destination_site', 'at_destination', 'ZM', 10, 'terminal'),
    ('NDOLA DEPOT',         'NDOLA OFFLOADING',    'destination_site', 'at_destination', 'ZM', 10, 'terminal'),
    ('LUSAKA DEPOT',        'LUSAKA DEPOT',        'destination_site', 'at_destination', 'ZM', 10, 'terminal');

    -- ─── DRC CUSTOMER SITES ─────────────────────────────────────────────────
    -- v1: L3_CUSTOMER  |  v2 role: customer_site (Priority 10)
    INSERT INTO tmp_ext_seed VALUES
    ('KANATA PETROLEUM DEPOT (CONSTALINA)', 'KANATA PETROLEUM LUBUMBASHI', 'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('KOLWEZI OFFLOADING',                 'KOLWEZI OFFLOADING',          'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('LUALABA OIL (KOLWEZI)',              'LUALABA OIL KOLWEZI',         'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('UNITED PETROLEUM KOLWEZI',           'UNITED PETROLEUM KOLWEZI',    'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('FRONTIER',                           'FRONTIER',                    'customer_site', 'at_destination', 'ZM', 10, 'customer'),
    ('LUMWANA MINES',                      'LUMWANA MINES',               'customer_site', 'at_destination', 'ZM', 10, 'customer'),
    ('MALEBO PETROLEUM LUBUMBASHI',        'MALEBO PETROLEUM LUBUMBASHI', 'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('UNITED PETROLEUM LUBUMBASHI',        'UNITED PETROLEUM LUBUMBASHI', 'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('SEP CONGO',                          'SEP CONGO',                   'customer_site', 'at_destination', 'CD', 10, 'customer'),
    ('EXPREE OIL DEPOT',                   'EXPREE OIL',                  'customer_site', 'at_destination', 'CD', 10, 'customer');

    -- ─── DRC NAMED AREAS ────────────────────────────────────────────────────
    INSERT INTO tmp_ext_seed VALUES
    ('LUBUMBASHI',  'LUBUMBASHI',  'destination_region', 'at_destination', 'CD', 0, 'region'),
    ('CHAPWA',      'CHAPWA',      'corridor_checkpoint','transit',         'ZM', 0, 'checkpoint');

    -- ─── CUSTOMS SITES ──────────────────────────────────────────────────────
    -- v1: L2_CUSTOMS_DRC  |  v2 role: customs_site
    INSERT INTO tmp_ext_seed VALUES
    ('KANYAKA CUSTOMS', 'KANYAKA CUSTOMS', 'customs_site', 'transit', 'CD', 0, 'customs'),
    ('WHISK DRC',       'KANYAKA CUSTOMS', 'customs_site', 'transit', 'CD', 0, 'customs');

    -- ─── LOCAL DELIVERY & DUAL-PURPOSE SITES ────────────────────────────────
    -- These act as BOTH transit cities and potential destinations.
    -- Priority 1 allows 'True' destinations (Prio 10) to override them in long-haul trips.
    INSERT INTO tmp_ext_seed VALUES
    ('ASAS HEAD OFFICE IPOGOLO YARD -IRINGA', 'ASAS IRINGA YARD', 'local_delivery_site', 'at_destination', 'TZ', 1, 'terminal'),
    ('IPOGORO',                               'ASAS IRINGA YARD', 'local_delivery_site', 'at_destination', 'TZ', 1, 'terminal'),
    ('MOROGORO',                              'MOROGORO',         'local_delivery_site', 'at_destination', 'TZ', 1, 'region'),
    ('MBEYA',                                 'MBEYA',            'local_delivery_site', 'at_destination', 'TZ', 1, 'region'),
    ('MAKAMBAKO',                             'MAKAMBAKO',        'local_delivery_site', 'at_destination', 'TZ', 1, 'region');

    -- ─── SERVICE SITES ──────────────────────────────────────────────────────
    -- v1: L2_SERVICE (these are wash bays, service yards — not destinations)
    INSERT INTO tmp_ext_seed VALUES
    ('KIMARA FUELING POINT',            'KIMARA FUELING POINT',   'service_site', 'transit', 'TZ', 0, 'service'),
    ('MLANDIZI WASHING BAY',            'MLANDIZI WASHING BAY',   'service_site', 'transit', 'TZ', 0, 'service'),
    ('DELTA CAR WASH MSOLWA',           'DELTA MSOLWA WASH',      'service_site', 'transit', 'TZ', 0, 'service'),
    ('ASAS CHAPWA YARD',                'CHAPWA',                  'corridor_checkpoint', 'transit', 'ZM', 0, 'checkpoint'),
    ('GRW ENGINEERING',                 'GRW ENGINEERING',        'service_site', 'transit', 'TZ', 0, 'service'),
    ('SCANIA DAR ES SALAAM SERVICE YARD','SCANIA DAR',             'service_site', 'transit', 'TZ', 0, 'service'),
    ('SCANIA TANZANIA',                 'SCANIA DAR',             'service_site', 'transit', 'TZ', 0, 'service'),
    ('SERIN YARD',                      'SERIN YARD',             'service_site', 'transit', 'TZ', 0, 'service');

    -- ─── BORDER ALIASES MISSING FROM INITIAL SEED ───────────────────────────
    INSERT INTO tmp_ext_seed VALUES
    -- Chirundu variants (Zimbabwe / Zambia border)
    ('CHIRUNDU BORDER ZIM SIDE',    'CHIRUNDU BORDER', 'border_other', 'transit', 'ZW', 0, 'border'),
    ('CHIRUNDU BORDER ZAMBIA SIDE', 'CHIRUNDU BORDER', 'border_other', 'transit', 'ZM', 0, 'border'),
    ('CHIMEFUSA BORDER',            'CHIRUNDU BORDER', 'border_other', 'transit', 'ZM', 0, 'border'),
    -- Other East/Southern African borders
    ('MALABA BORDER',               'MALABA BORDER',   'border_other', 'transit', 'UG', 0, 'border'),
    ('HOROHORO BORDER',             'HOROHORO BORDER', 'border_other', 'transit', 'TZ', 0, 'border'),
    ('MUTUKULA BORDER',             'MUTUKULA BORDER', 'border_other', 'transit', 'TZ', 0, 'border'),
    ('MANYOUVU BORDER',             'MANYOUVU BORDER', 'border_other', 'transit', 'TZ', 0, 'border'),
    ('MUTARE BORDER',               'MUTARE BORDER',   'border_other', 'transit', 'ZW', 0, 'border'),
    ('KASUMBALESA BORDER  DRC SIDE', 'KASUMBALESA BORDER', 'border_drc', 'transit', 'CD', 0, 'border');

    -- ─── CORRIDOR ZONES (Tanzania) ──────────────────────────────────────────
    INSERT INTO tmp_ext_seed VALUES
    ('MOROGORO',               'MOROGORO',  'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('MBEYA',                  'MBEYA',     'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('MBEYA (UYOLE - MBALIZI)','MBEYA',     'corridor_region', 'transit', 'TZ', 0, 'region');

    -- v1: L2_TZ_CORRIDOR
    INSERT INTO tmp_ext_seed VALUES
    ('IFUNDA',            'IFUNDA',        'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('MAKAMBAKO',         'MAKAMBAKO',     'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('NYORORO',           'NYORORO',       'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('TUKUYU',            'TUKUYU',        'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('UYOLE MIZANI',      'UYOLE MIZANI',  'corridor_checkpoint', 'transit', 'TZ', 0, 'checkpoint'),
    ('UYOLE',             'UYOLE MIZANI',  'corridor_checkpoint', 'transit', 'TZ', 0, 'checkpoint'),
    ('IGAWA',             'IGAWA',         'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('RUAHA MBUYUNI',     'RUAHA MBUYUNI', 'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('MIKUMI',            'MIKUMI',        'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('RUVU',              'RUVU',          'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('KIGOMA',            'KIGOMA',        'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('TUKUYU (USHILIKA)', 'TUKUYU',        'corridor_region', 'transit', 'TZ', 0, 'region');

    -- ─── CORRIDOR ZONES (Zambia) ────────────────────────────────────────────
    INSERT INTO tmp_ext_seed VALUES
    ('KAPIRI',         'KAPIRI MPOSHI',  'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('SERENJE',        'SERENJE',        'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('CHIMUTANDA',     'CHIMUTANDA',     'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('MATUMBO',        'MATUMBO',        'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('MKUSHI',         'MKUSHI',         'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('KANONA',         'KANONA',         'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('KASAMA',         'KASAMA',         'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('ISOKA',          'ISOKA',          'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('SANGA HILL',     'SANGA HILL',     'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('LUWINGU',        'LUWINGU',        'corridor_region', 'transit', 'ZM', 0, 'region'),
    ('MPIKA, ZAMBIA',  'MPIKA',          'corridor_region', 'transit', 'ZM', 0, 'region');

    -- ─── KENYA / ZIMBABWE CORRIDORS ─────────────────────────────────────────
    INSERT INTO tmp_ext_seed VALUES
    ('NAIROBI GF', 'NAIROBI', 'corridor_region', 'transit', 'KE', 0, 'region'),
    ('HARARE GF',  'HARARE',  'corridor_region', 'transit', 'ZW', 0, 'region');

    -- ─── UNMAPPED GEOFENCES (found in production data) ───────────────────────
    INSERT INTO tmp_ext_seed VALUES
    ('Segera GF',             'SEGERA',              'corridor_checkpoint', 'transit', 'TZ', 0, 'checkpoint'),
    ('TSHISENDA',             'TSHISENDA',            'corridor_region',    'transit', 'CD', 0, 'region'),
    ('MISGUSUGU',             'MISGUSUGU',           'corridor_checkpoint', 'transit', 'TZ', 0, 'checkpoint'),
    ('MOSHI TOTAL FUEL DEPOT','MOSHI TOTAL FUEL DEPOT','service_site',      'transit', 'TZ', 0, 'service');

    -- ── Process seeds into final tables ─────────────────────────────────────
    -- Step 1: Upsert canonical master entries
    -- Use DISTINCT ON (canonical_name) to avoid the "cannot affect row a second time"
    -- error when the same canonical_name appears with different country_code values
    -- (e.g. CHIRUNDU BORDER has both ZW and ZM entries). Pick the highest-priority row.
    INSERT INTO geofence_master (canonical_name, default_role_code, country_code, site_type)
    SELECT DISTINCT ON (canonical_name)
        canonical_name, role_code, country_code, site_type
    FROM tmp_ext_seed
    ORDER BY canonical_name, priority DESC
    ON CONFLICT (canonical_name) DO UPDATE
        SET default_role_code = EXCLUDED.default_role_code,
            site_type         = EXCLUDED.site_type,
            country_code      = EXCLUDED.country_code;

    -- Step 2: Upsert aliases
    INSERT INTO geofence_aliases (geofence_id, alias_name, normalized_name)
    SELECT gm.geofence_id, s.raw_name, normalize_geofence_name(s.raw_name)
    FROM tmp_ext_seed s
    JOIN geofence_master gm ON gm.canonical_name = s.canonical_name
    ON CONFLICT (alias_name) DO NOTHING;

    -- Step 3: Upsert roles (Use DO UPDATE to ensure priority overrides from Seed 1)
    INSERT INTO geofence_role_map (geofence_id, role_code, trip_stage, priority)
    SELECT DISTINCT gm.geofence_id, s.role_code, s.trip_stage, s.priority
    FROM tmp_ext_seed s
    JOIN geofence_master gm ON gm.canonical_name = s.canonical_name
    ON CONFLICT (geofence_id, role_code) DO UPDATE
       SET priority   = EXCLUDED.priority,
           trip_stage = EXCLUDED.trip_stage;

    UPDATE tat_refactor_runs
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'master_total', (SELECT count(*) FROM geofence_master),
            'alias_total',  (SELECT count(*) FROM geofence_aliases)
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    UPDATE tat_refactor_runs
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;
