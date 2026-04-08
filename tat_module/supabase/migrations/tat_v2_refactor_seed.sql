DO $$ 
DECLARE 
    v_run_id UUID;
BEGIN
    -- Start Run Logging
    INSERT INTO tat_refactor_runs (phase, status, parameters)
    VALUES ('PHASE_1_SEED', 'running', '{"mode": "initial_seed"}'::jsonb)
    RETURNING run_id INTO v_run_id;

    -- Helper Function for seeding
    -- Arguments: raw_name, canonical_name, role_code, trip_stage, country_code, priority, site_type
    CREATE TEMP TABLE tmp_geofence_seed (
        raw_name TEXT,
        canonical_name TEXT,
        role_code TEXT,
        trip_stage TEXT,
        country_code TEXT,
        priority INTEGER,
        site_type TEXT
    ) ON COMMIT DROP;

    -- SEED DATA: Origin Terminals
    INSERT INTO tmp_geofence_seed VALUES
    ('TIPER DEPOT', 'TIPER DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('PUMA DEPO KURASINI', 'PUMA KURASINI', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('ORYX LOADING DEPO (KIGAMBONI)', 'ORYX KIGAMBONI', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('ORYX DAR DEPO', 'ORYX DAR DEPO', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('OILCOM DAR DEPO', 'OILCOM DAR DEPO', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('OILCOM LIMITED TERMINAL DEPOT', 'OILCOM TERMINAL', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('MERU TERMINAL DEPOT', 'MOUNT MERU DAR TERMINAL', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('MOGAS OIL DEPOT', 'MOGAS OIL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('SUPERSTAR FUEL DEPOT', 'SUPERSTAR FUEL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('GBP DRS DEPOT', 'GBP DAR DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('ORYX FUEL DEPOT', 'ORYX FUEL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('WORLD OIL DEPOT', 'WORLD OIL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('GBP TANGA TERMINAL', 'GBP TANGA TERMINAL', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('CAMEL OIL', 'CAMEL OIL', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('PETROBEIRA', 'PETROBEIRA', 'origin_terminal', 'loading', 'MZ', 5, 'terminal'),
    ('PETRODA', 'PETRODA', 'origin_terminal', 'loading', 'MZ', 5, 'terminal'),
    ('LAKE OIL', 'LAKE OIL', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('INPETRO', 'INPETRO', 'origin_terminal', 'loading', 'MZ', 5, 'terminal'),
    ('XSTORAGE', 'XSTORAGE', 'origin_terminal', 'loading', 'MZ', 5, 'terminal'),
    ('MOUNT MERU', 'MOUNT MERU', 'origin_terminal', 'loading', 'MZ', 5, 'terminal'),
    ('ORYX MTWARA DEPOT', 'ORYX MTWARA DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('OILCOM MTWARA DEPOT', 'OILCOM MTWARA DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('VIVO ENERGY MOMBASA TERMINAL', 'VIVO MOMBASA', 'origin_terminal', 'loading', 'KE', 5, 'terminal'),
    ('WORLD OIL T2 DEPOT', 'WORLD OIL T2', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('AFROIL DEPOT', 'AFROIL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('LAKE OIL TANZANIA DEPOT', 'LAKE OIL TANZANIA', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('WORLD OIL T1 DEPOT', 'WORLD OIL T1', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('SAHARA DEPOT', 'SAHARA DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('HASS DEPOT', 'HASS DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('MOUNT MERU (T) DEPOT', 'MOUNT MERU (T)', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('MOIL DEPOT', 'MOIL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('STAR OIL DEPOT', 'STAR OIL DEPOT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('CAMEL OIL (T) DEPOT', 'CAMEL OIL (T)', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('GAPCO TOTAL DEPOT', 'TOTAL GAPCO DAR', 'origin_terminal', 'loading', 'TZ', 5, 'terminal'),
    ('ORYX LUBRICANT DEPOT', 'ORYX LUBRICANT', 'origin_terminal', 'loading', 'TZ', 5, 'terminal');

    -- SEED DATA: Origin Regions / Zones
    INSERT INTO tmp_geofence_seed VALUES
    ('DAR GEOFENCE', 'DAR GEOFENCE', 'origin_gateway', 'loading', 'TZ', 1, 'gateway'),
    ('KILUVYA TO MBEZI GEOFENCE', 'KILUVYA GATEWAY', 'origin_gateway', 'loading', 'TZ', 1, 'gateway'),
    ('KILUVYA GEOFENCE', 'KILUVYA GATEWAY', 'origin_gateway', 'loading', 'TZ', 1, 'gateway'),
    ('TANGA GF', 'TANGA ZONE', 'origin_zone', 'loading', 'TZ', 3, 'zone'),
    ('MTWARA GF', 'MTWARA ZONE', 'origin_zone', 'loading', 'TZ', 3, 'zone'),
    ('BEIRA GF', 'BEIRA ZONE', 'origin_zone', 'loading', 'MZ', 3, 'zone'),
    ('BEIRA GEOFENCE', 'BEIRA ZONE', 'origin_zone', 'loading', 'MZ', 3, 'zone'),
    ('BEIRA', 'BEIRA ZONE', 'origin_zone', 'loading', 'MZ', 3, 'zone'),
    ('KURASINI ALL TOGETHER', 'KURASINI ZONE', 'origin_zone', 'loading', 'TZ', 3, 'zone'),
    ('MOMBASA GF', 'MOMBASA ZONE', 'origin_zone', 'loading', 'KE', 3, 'zone'),
    ('TANGA PARKING', 'TANGA PARKING', 'origin_zone', 'loading', 'TZ', 3, 'zone');

    -- SEED DATA: Ops Yards / ASAS Bases
    INSERT INTO tmp_geofence_seed VALUES
    ('ASAS DSM OFFICE / DAR W/SHOP', 'ASAS DAR OFFICE', 'ops_yard', 'pre_transit', 'TZ', 2, 'yard'),
    ('ASAS KIBAHA DSM -YARD', 'ASAS KIBAHA YARD', 'ops_yard', 'pre_transit', 'TZ', 2, 'yard'),
    ('ASAS TABATA', 'ASAS TABATA', 'ops_yard', 'pre_transit', 'TZ', 2, 'yard');

    -- SEED DATA: Borders
    INSERT INTO tmp_geofence_seed VALUES
    ('TUNDUMA BORDER TZ SIDE', 'TUNDUMA BORDER', 'border_tz', 'transit', 'TZ', 0, 'border'),
    ('TANZANIA TUNDUMA BORDER', 'TUNDUMA BORDER', 'border_tz', 'transit', 'TZ', 0, 'border'),
    ('NAKONDE BORDER ZMB SIDE', 'NAKONDE BORDER', 'border_zm', 'transit', 'ZM', 0, 'border'),
    ('ZAMBIA NAKONDE BORDER', 'NAKONDE BORDER', 'border_zm', 'transit', 'ZM', 0, 'border'),
    ('TUNDUMA BORDER 1', 'TUNDUMA BORDER', 'border_other', 'transit', 'TZ', 0, 'border'),
    ('KASUMBALESA ZMB SIDE', 'KASUMBALESA BORDER', 'border_zm', 'transit', 'ZM', 0, 'border'),
    ('KASUMBALESA BORDER DRC SIDE', 'KASUMBALESA BORDER', 'border_drc', 'transit', 'CD', 0, 'border'),
    ('KASUMBALESA BORDER (DRC)', 'KASUMBALESA BORDER', 'border_drc', 'transit', 'CD', 0, 'border'),
    ('KASUMBALESA', 'KASUMBALESA BORDER', 'border_drc', 'transit', 'CD', 0, 'border'),
    ('SAKANIA ZMB SIDE', 'SAKANIA BORDER', 'border_zm', 'transit', 'ZM', 0, 'border'),
    ('SAKANIA BORDER', 'SAKANIA BORDER', 'border_zm', 'transit', 'ZM', 0, 'border'),
    ('SAKANIA DRC', 'SAKANIA BORDER', 'border_drc', 'transit', 'CD', 0, 'border'),
    ('CHEMBE BORDER', 'CHEMBE BORDER', 'border_other', 'transit', 'ZM', 0, 'border'),
    ('CHEMBE BORDER POST', 'CHEMBE BORDER', 'border_other', 'transit', 'ZM', 0, 'border'),
    ('MOKAMBO BORDER', 'MOKAMBO BORDER', 'border_other', 'transit', 'ZM', 0, 'border'),
    ('KASUMULU BORDER', 'KASUMULU BORDER', 'border_other', 'transit', 'TZ', 0, 'border'),
    ('CHIRUNDU BORDER', 'CHIRUNDU BORDER', 'border_other', 'transit', 'ZM', 0, 'border'),
    ('KABANGA BORDER', 'KABANGA BORDER', 'border_other', 'transit', 'TZ', 0, 'border'),
    ('RUSUMO BORDER', 'RUSUMO BORDER', 'border_other', 'transit', 'TZ', 0, 'border');

    -- SEED DATA: Destinations / Customers
    INSERT INTO tmp_geofence_seed VALUES
    ('DRC OFFLOADING GEO', 'DRC REGION', 'destination_region', 'at_destination', 'CD', 0, 'region'),
    ('EXPREE OIL DEPOT', 'EXPREE OIL', 'customer_site', 'at_destination', 'CD', 1, 'customer'),
    ('SEP CONGO', 'SEP CONGO', 'customer_site', 'at_destination', 'CD', 1, 'customer'),
    ('UNITED PETROLEUM LUBUMBASHI', 'UNITED PETROLEUM LUBUMBASHI', 'customer_site', 'at_destination', 'CD', 1, 'customer'),
    ('LUSAKA DEPOT', 'LUSAKA DEPOT', 'destination_site', 'at_destination', 'ZM', 1, 'terminal'),
    ('NDOLA OFFLOADING', 'NDOLA OFFLOADING', 'destination_site', 'at_destination', 'ZM', 1, 'terminal'),
    ('ISAKA LPG DEPOT', 'ISAKA LPG', 'lpg_site', 'at_destination', 'TZ', 1, 'terminal');

    -- SEED DATA: Corridor / Checkpoints
    INSERT INTO tmp_geofence_seed VALUES
    ('MISUGUSUGU CHECK POINT', 'MISUGUSUGU', 'corridor_checkpoint', 'transit', 'TZ', 0, 'checkpoint'),
    ('MISUGUSUGU', 'MISUGUSUGU', 'corridor_checkpoint', 'transit', 'TZ', 0, 'checkpoint'),
    ('MOROGORO', 'MOROGORO', 'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('MBEYA', 'MBEYA', 'corridor_region', 'transit', 'TZ', 0, 'region'),
    ('MPIKA', 'MPIKA', 'corridor_region', 'transit', 'ZM', 0, 'region');

    -- Process Seeds into Final Tables
    -- 1. Insert Master Sites (Distinct canonical names)
    INSERT INTO geofence_master (canonical_name, default_role_code, country_code, site_type)
    SELECT DISTINCT canonical_name, role_code, country_code, site_type
    FROM tmp_geofence_seed
    ON CONFLICT (canonical_name) DO NOTHING;

    -- 2. Insert Aliases (Raw names)
    INSERT INTO geofence_aliases (geofence_id, alias_name, normalized_name)
    SELECT gm.geofence_id, s.raw_name, normalize_geofence_name(s.raw_name)
    FROM tmp_geofence_seed s
    JOIN geofence_master gm ON gm.canonical_name = s.canonical_name
    ON CONFLICT (alias_name) DO NOTHING;

    -- 3. Insert Roles
    INSERT INTO geofence_role_map (geofence_id, role_code, trip_stage, priority)
    SELECT DISTINCT gm.geofence_id, s.role_code, s.trip_stage, s.priority
    FROM tmp_geofence_seed s
    JOIN geofence_master gm ON gm.canonical_name = s.canonical_name
    ON CONFLICT (geofence_id, role_code) DO NOTHING;

    -- Finish Run Logging
    UPDATE tat_refactor_runs 
    SET status = 'completed', end_time = clock_timestamp(),
        metrics = jsonb_build_object(
            'master_count', (SELECT count(*) FROM geofence_master),
            'alias_count', (SELECT count(*) FROM geofence_aliases)
        )
    WHERE run_id = v_run_id;

EXCEPTION WHEN OTHERS THEN
    UPDATE tat_refactor_runs 
    SET status = 'failed', end_time = clock_timestamp(), error_message = SQLERRM
    WHERE run_id = v_run_id;
    RAISE;
END $$;
