-- =============================================================
-- ASAS TAT Trip Lifecycle - INCREMENTAL TABLE ARCHITECTURE
-- Built to handle multi-year history without API timeouts
-- =============================================================
-- UNIFIED BUILD — includes all geofence alignment patches
-- =============================================================

-- 1. Create a physical table instead of a Materialized View
CREATE TABLE IF NOT EXISTS tat_trips_data (
    tracker_id INTEGER,
    tracker_name TEXT,
    session_id BIGINT,
    loading_entry TIMESTAMPTZ,
    loading_exit TIMESTAMPTZ,
    loading_terminal TEXT,
    next_loading_entry TIMESTAMPTZ,
    dar_arrival TIMESTAMPTZ,
    dar_exit TIMESTAMPTZ,
    next_dar_entry TIMESTAMPTZ,
    dest_entry TIMESTAMPTZ,
    dest_exit TIMESTAMPTZ,
    dest_name TEXT,
    has_corridor_event BOOLEAN,
    border_tunduma_entry TIMESTAMPTZ,
    border_tunduma_exit TIMESTAMPTZ,
    border_kasumbalesa_entry TIMESTAMPTZ,
    border_kasumbalesa_exit TIMESTAMPTZ,
    border_sakania_entry TIMESTAMPTZ,
    border_sakania_exit TIMESTAMPTZ,
    border_other_entry TIMESTAMPTZ,
    border_other_exit TIMESTAMPTZ,
    border_mokambo_entry TIMESTAMPTZ,
    border_mokambo_exit TIMESTAMPTZ,
    border_kasumulu_entry TIMESTAMPTZ,
    border_kasumulu_exit TIMESTAMPTZ,
    customs_entry TIMESTAMPTZ,
    customs_exit TIMESTAMPTZ,
    return_border_kasumbalesa_entry TIMESTAMPTZ,
    return_border_kasumbalesa_exit TIMESTAMPTZ,
    return_border_sakania_entry TIMESTAMPTZ,
    return_border_sakania_exit TIMESTAMPTZ,
    return_border_other_entry TIMESTAMPTZ,
    return_border_other_exit TIMESTAMPTZ,
    return_border_tunduma_entry TIMESTAMPTZ,
    return_border_tunduma_exit TIMESTAMPTZ,
    return_border_kasumulu_entry TIMESTAMPTZ,
    return_border_kasumulu_exit TIMESTAMPTZ,
    return_border_mokambo_entry TIMESTAMPTZ,
    return_border_mokambo_exit TIMESTAMPTZ,
    border_chembe_entry TIMESTAMPTZ,
    border_chembe_exit TIMESTAMPTZ,
    return_border_chembe_entry TIMESTAMPTZ,
    return_border_chembe_exit TIMESTAMPTZ,
    drc_region_entry TIMESTAMPTZ,
    drc_region_exit TIMESTAMPTZ,
    customer_name TEXT,
    customer_entry TIMESTAMPTZ,
    customer_exit TIMESTAMPTZ,
    loading_start TIMESTAMPTZ,
    loading_end TIMESTAMPTZ,
    UNIQUE(tracker_id, loading_end)
);

CREATE INDEX IF NOT EXISTS idx_tat_trips_data_dest ON tat_trips_data(dest_name);
CREATE INDEX IF NOT EXISTS idx_tat_trips_data_start ON tat_trips_data(loading_start);
CREATE INDEX IF NOT EXISTS idx_tat_trips_data_exit ON tat_trips_data(loading_exit);

-- Upgrade existing table schema if it already exists
ALTER TABLE IF EXISTS tat_trips_data 
    ADD COLUMN IF NOT EXISTS border_sakania_entry TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS border_sakania_exit TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS border_other_entry TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS border_other_exit TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_border_sakania_entry TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_border_sakania_exit TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_border_other_entry TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_border_other_exit TIMESTAMPTZ;

-- Replace the materialize view definition with the incremental processing function
DO $$ BEGIN
    DROP MATERIALIZED VIEW IF EXISTS tat_trips_view CASCADE;
EXCEPTION WHEN OTHERS THEN
    -- Ignore if it's a regular view instead of a materialized view
END $$;
CREATE OR REPLACE VIEW tat_trips_view AS SELECT * FROM tat_trips_data;


-- =============================================================
-- INCREMENTAL BUILDER FUNCTION
-- Call this function to process exactly 1 month of raw data at a time.
-- Automatically manages upserts (inserts new, updates existing)
-- =============================================================
-- ============================================================
-- PATCH: Fix loading_start inflation from ASAS operational bases
-- ============================================================
-- Problem:  ASAS Tabata, ASAS DSM Office, ASAS Kibaha are classified
--           as L1_ZONE (same priority as KURASINI ALL TOGETHER).
--           loading_start = MIN(in_time_dt) across ALL L1_ZONE visits,
--           so the truck's 18-day parking at Asas Tabata gets counted
--           as "loading" instead of "waiting for orders".
--
-- Fix:      New geo_level L1_ASAS_OPS ranked BELOW L1_ZONE.
--           When real loading zones/terminals exist in the session,
--           those timestamps win for loading_start/end/terminal.
--           ASAS bases are only used as fallback.
--
-- Impact:   tat_trips_data columns loading_start, loading_end,
--           loading_terminal, and derived metrics waiting_for_orders_hrs
--           and loading_phase_hrs will be corrected.
--
-- After applying: run  SELECT refresh_recent_tat();
--                 or   SELECT build_historical_tat('2023-01-01', NOW());
-- ============================================================
 
 
CREATE OR REPLACE FUNCTION process_tat_chunk(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_tracker_id INTEGER DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    _step_start timestamptz;
    _chunk_start timestamptz := clock_timestamp();
BEGIN
    RAISE NOTICE 'TAT chunk % → %', p_start, p_end;
 
    -- ══════════════════════════════════════════════════════════════
    -- PRE-CLEAN: Delete rows whose loading_exit falls in this window.
    -- ══════════════════════════════════════════════════════════════
    DELETE FROM tat_trips_data
    WHERE loading_exit >= p_start
      AND loading_exit <  p_end
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND tracker_id IN (
          SELECT DISTINCT tracker_id
          FROM public.geofence_visits
          WHERE in_time_dt >= p_start
            AND in_time_dt <  p_end
            AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            AND regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)',
                'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT',
                'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL', 'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                'VIVO ENERGY MOMBASA TERMINAL',
                'KURASINI ALL TOGETHER', 'TANGA GF', 'MTWARA GF',
                'BEIRA GF', 'MOMBASA GF', 'TANGA PARKING',
                'ASAS KIBAHA DSM -YARD', 'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS TABATA'
            )
      );
 
    _step_start := clock_timestamp();
    RAISE NOTICE '  [pre-clean] done in %s', extract(epoch from clock_timestamp() - _chunk_start)::numeric(8,1);
 
    -- ══════════════════════════════════════════════════════════════
    -- STEP 1: Classify geofence visits — PATCHED
    --         ASAS operational bases → L1_ASAS_OPS (new level)
    -- ══════════════════════════════════════════════════════════════
    CREATE TEMP TABLE IF NOT EXISTS _chunk_classified (
        id bigint, tracker_id integer, tracker_name text, geofence_name text,
        in_time_dt timestamptz, out_time_dt timestamptz, geo_level text
    ) ON COMMIT DROP;
    TRUNCATE _chunk_classified;
 
    INSERT INTO _chunk_classified
    SELECT
        id, tracker_id, tracker_name, geofence_name,
        in_time_dt, out_time_dt,
        CASE
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)',
                'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT',
                'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL',
                'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                'VIVO ENERGY MOMBASA TERMINAL',
                'WORLD OIL T2 DEPOT', 'AFROIL DEPOT', 'LAKE OIL TANZANIA DEPOT',
                'WORLD OIL T1 DEPOT', 'SAHARA DEPOT', 'HASS DEPOT',
                'MOUNT MERU (T) DEPOT', 'MOIL DEPOT', 'STAR OIL DEPOT',
                'CAMEL OIL (T) DEPOT', 'GAPCO TOTAL DEPOT', 'ORYX LUBRICANT DEPOT'
            ) THEN 'L1_TERMINAL'
 
            -- L1_ZONE_GATEWAY: Dar gateway geofences
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'KILUVYA GEOFENCE') THEN 'L1_ZONE_GATEWAY'
 
            -- ┌──────────────────────────────────────────────────────────┐
            -- │ PATCH: ASAS operational bases → L1_ASAS_OPS             │
            -- │ These are documentation/parking/admin hubs, NOT loading │
            -- │ terminals. Ranked below L1_ZONE so their timestamps     │
            -- │ don't inflate loading_start when real terminals exist.  │
            -- └──────────────────────────────────────────────────────────┘
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS KIBAHA DSM -YARD', 'ASAS TABATA'
            ) THEN 'L1_ASAS_OPS'
 
            -- L1_ZONE: Broad loading zones (ASAS bases REMOVED from here)
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'TANGA GF', 'MTWARA GF', 'BEIRA', 'BEIRA GF',
                'KURASINI ALL TOGETHER', 'MOMBASA GF', 'BEIRA GEOFENCE', 'TANGA PARKING'
            ) THEN 'L1_ZONE'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'TANGA GF', 'MTWARA GF', 'BEIRA GEOFENCE', 'BEIRA GF', 'MOMBASA GF', 'TANGA PARKING', 'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS KIBAHA DSM -YARD', 'ASAS TABATA') THEN 'L3_ORIGIN_REGION'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') = 'DRC OFFLOADING GEO' THEN 'L1_DRC_REGION'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'LUSAKA DEPOT', 'NDOLA OFFLOADING', 'MZUZU OFFLOADING', 'LILONGWE',
                'JINJA GF', 'KAMPALA GF', 'BUJUMBURA GF', 'KIGALI GF',
                'BLANTYRE', 'BLANTYRE OFFLOADING'
            ) THEN 'L1_OFFLOADING'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'ISAKA LPG DEPOT', 'DODOMA LPG DEPOT', 'ORYX DODOMA LPG DEPOT',
                'MWANZA LPG DEPOT', 'MOSHI LPG DEPOT', 'IRINGA LPG DEPOT',
                'MBEYA LPG DEPOT'
            ) THEN 'L1_LPG_DEPOT'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'ASAS HEAD OFFICE IPOGOLO YARD -IRINGA'
            ) THEN 'L1_LOCAL_DELIVERY'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('ASAS DSM OFFICE / DAR W/SHOP_LEGACY') THEN 'L1_ASAS_BASE'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'KIMARA FUELING POINT', 'MLANDIZI WASHING BAY', 'DELTA CAR WASH MSOLWA',
                'ASAS CHAPWA YARD', 'GRW ENGINEERING', 'SCANIA DAR ES SALAAM SERVICE YARD',
                'SCANIA TANZANIA', 'SERIN YARD'
            ) THEN 'L2_SERVICE'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'MISUGUSUGU CHECK POINT', 'MISUGUSUGU', 'MISGUSUGU'
            ) THEN 'L2_CHECKPOINT_TRA'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('TUNDUMA BORDER TZ SIDE', 'TANZANIA TUNDUMA BORDER') THEN 'L2_BORDER_TZ'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('NAKONDE BORDER ZMB SIDE', 'ZAMBIA NAKONDE BORDER') THEN 'L2_BORDER_NAKONDE'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') = 'TUNDUMA BORDER 1' THEN 'L2_BORDER_TUNDUMA_ALL'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'SAKANIA BORDER') THEN 'L2_BORDER_ZMB'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('KASUMBALESA BORDER DRC SIDE', 'KASUMBALESA BORDER (DRC)', 'KASUMBALESA', 'SAKANIA DRC') THEN 'L2_BORDER_DRC'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') = 'MOKAMBO BORDER' THEN 'L2_BORDER_MOKAMBO'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('CHEMBE BORDER', 'CHEMBE BORDER POST') THEN 'L2_BORDER_CHEMBE'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') = 'KASUMULU BORDER' THEN 'L2_BORDER_KASUMULU'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('CHIRUNDU BORDER', 'CHIRUNDU BORDER ZIM SIDE', 'CHIRUNDU BORDER ZAMBIA SIDE', 'CHIMEFUSA BORDER', 'KABANGA BORDER', 'RUSUMO BORDER', 'MALABA BORDER', 'HOROHORO BORDER', 'MUTUKULA BORDER', 'MANYOUVU BORDER', 'MUTARE BORDER') THEN 'L2_BORDER_OTHER'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('KANYAKA CUSTOMS', 'WHISK DRC') THEN 'L2_CUSTOMS_DRC'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'MOROGORO', 'IPOGORO', 'MBEYA', 'MBEYA (UYOLE - MBALIZI)'
            ) THEN 'L2_TZ_LOCAL_DUAL'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'IFUNDA', 'MAKAMBAKO', 'NYORORO', 'TUKUYU',
                'UYOLE MIZANI', 'UYOLE',
                'IGAWA', 'RUAHA MBUYUNI', 'MIKUMI', 'RUVU', 'KIGOMA',
                'TUKUYU (USHILIKA)'
            ) THEN 'L2_TZ_CORRIDOR'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                'KAPIRI', 'SERENJE', 'CHIMUTANDA', 'MPIKA',
                'MATUMBO', 'MKUSHI', 'KANONA', 'KASAMA',
                'ISOKA', 'SANGA HILL', 'LUWINGU', 'MPIKA, ZAMBIA'
            ) THEN 'L2_ZAMBIA_CORRIDOR'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('NAIROBI GF') THEN 'L2_KENYA_CORRIDOR'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('HARARE GF') THEN 'L2_ZIM_CORRIDOR'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('EXPREE OIL DEPOT', 'SEP CONGO', 'UNITED PETROLEUM LUBUMBASHI', 'KANATA PETROLEUM DEPOT (CONSTALINA)', 'KOLWEZI OFFLOADING', 'LUALABA OIL (KOLWEZI)', 'UNITED PETROLEUM KOLWEZI', 'FRONTIER', 'LUMWANA MINES', 'MALEBO PETROLEUM LUBUMBASHI') THEN 'L3_CUSTOMER'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('KILUVYA TO MBEZI GEOFENCE', 'KILUVYA GEOFENCE') THEN 'L3_DAR_GATEWAY'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'TANGA GF', 'MTWARA GF', 'BEIRA GEOFENCE', 'BEIRA GF', 'MOMBASA GF', 'TANGA PARKING') THEN 'L3_ORIGIN_REGION'
 
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') = 'LUBUMBASHI' THEN 'L3_LUBUMBASHI'
            WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') = 'CHAPWA' THEN 'L3_CHAPWA'
 
            ELSE 'L2_CORRIDOR'
        END as geo_level
    FROM public.geofence_visits
    WHERE in_time_dt >= p_start - INTERVAL '60 days'
      AND in_time_dt < p_end + INTERVAL '90 days'
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND tracker_id IN (
          SELECT DISTINCT tracker_id FROM public.geofence_visits
          WHERE in_time_dt >= p_start AND in_time_dt < p_end
            AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
            AND geofence_name IN (
                'TIPER DEPOT', 'Puma Depo Kurasini', 'Oryx Loading Depo (Kigamboni)',
                'Oryx Dar Depo', 'Oilcom Dar Depo', 'OILCOM LIMITED TERMINAL DEPOT',
                'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                'GBP TANGA TERMINAL',
                'Camel Oil', 'Petrobeira', 'Petroda', 'Lake Oil',
                'Inpetro', 'Xstorage', 'Mount Meru',
                'Oryx Mtwara Depot', 'Oilcom Mtwara Depot',
                'VIVO Energy Mombasa Terminal',
                'Tanga GF', 'Mtwara GF', 'Beira', 'Beira GF',
                'KURASINI ALL TOGETHER', 'Mombasa GF', 'Tanga Parking',
                'Asas Kibaha Dsm -Yard', 'ASAS DSM Office / Dar W/Shop', 'Asas Tabata'
            )
      );
 
    CREATE INDEX IF NOT EXISTS _idx_cc_tracker ON _chunk_classified(tracker_id, in_time_dt);
    CREATE INDEX IF NOT EXISTS _idx_cc_level ON _chunk_classified(geo_level);
 
    RAISE NOTICE '  [step1 classify] done in %s', extract(epoch from clock_timestamp() - _step_start)::numeric(8,1);
    _step_start := clock_timestamp();
 
    -- STEP 2: Merge same-geofence visits within 2h gaps (UNCHANGED)
    CREATE TEMP TABLE IF NOT EXISTS _chunk_merged (
        tracker_id integer, tracker_name text, geofence_name text, geo_level text,
        in_time_dt timestamptz, out_time_dt timestamptz
    ) ON COMMIT DROP;
    TRUNCATE _chunk_merged;
 
    INSERT INTO _chunk_merged
    SELECT tracker_id, tracker_name, geofence_name, geo_level, MIN(in_time_dt), MAX(out_time_dt)
    FROM (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) as sid
        FROM (
            SELECT *, CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session
            FROM _chunk_classified
        ) flagged
    ) x
    GROUP BY tracker_id, tracker_name, geofence_name, geo_level, sid;
 
    CREATE INDEX IF NOT EXISTS _idx_cm_tracker ON _chunk_merged(tracker_id, in_time_dt);
    CREATE INDEX IF NOT EXISTS _idx_cm_level ON _chunk_merged(geo_level);
    CREATE INDEX IF NOT EXISTS _idx_cm_geoname ON _chunk_merged(geofence_name);
 
    RAISE NOTICE '  [step2 merge] done in %s', extract(epoch from clock_timestamp() - _step_start)::numeric(8,1);
    _step_start := clock_timestamp();
 
    -- ══════════════════════════════════════════════════════════════
    -- STEP 3: Identify loading sessions — PATCHED
    --         L1_ASAS_OPS added to session anchoring + priority ladder
    -- ══════════════════════════════════════════════════════════════
    CREATE TEMP TABLE IF NOT EXISTS _chunk_loading (
        tracker_id integer, tracker_name text, session_id bigint,
        loading_entry timestamptz, loading_exit timestamptz,
        loading_terminal text, next_loading_entry timestamptz,
        loading_term_start timestamptz, loading_term_end timestamptz,
        prev_loading_exit timestamptz, prev_loading_entry timestamptz
    ) ON COMMIT DROP;
    TRUNCATE _chunk_loading;
 
    INSERT INTO _chunk_loading
    WITH potential_anchors AS (
        SELECT m1.tracker_id, m1.tracker_name, m1.geofence_name, m1.geo_level, m1.in_time_dt, m1.out_time_dt,
            -- PATCH: L1_ASAS_OPS added as primary anchor (still triggers sessions)
            CASE WHEN m1.geo_level IN ('L1_TERMINAL', 'L1_ZONE', 'L1_ZONE_GATEWAY', 'L1_ASAS_BASE', 'L1_ASAS_OPS') THEN 1 ELSE 0 END as is_primary,
            CASE WHEN m1.geo_level = 'L3_ORIGIN_REGION'
                      AND next_event.geo_level IS NOT NULL
                      AND next_event.geo_level NOT IN ('L1_TERMINAL', 'L1_ZONE', 'L1_ZONE_GATEWAY', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE', 'L1_ASAS_OPS')
                      AND (
                          prev_trip_signal.geo_level IS NULL 
                          OR (EXTRACT(EPOCH FROM (m1.out_time_dt - m1.in_time_dt))/3600.0 > 6.0)
                      )
                 THEN 1 ELSE 0 END as is_fallback
        FROM _chunk_merged m1
        LEFT JOIN LATERAL (
            SELECT m2.geo_level FROM _chunk_merged m2
            WHERE m2.tracker_id = m1.tracker_id AND m2.in_time_dt > m1.in_time_dt
              AND (m2.geo_level IN ('L1_TERMINAL', 'L1_ZONE', 'L1_ZONE_GATEWAY', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE', 'L1_ASAS_OPS', 'L1_OFFLOADING', 'L1_DRC_REGION', 'L3_CUSTOMER', 'L1_LOCAL_DELIVERY', 'L1_LPG_DEPOT', 'L2_TZ_LOCAL_DUAL') OR m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level LIKE 'L2_TZ_CORRIDOR%' OR m2.geo_level LIKE 'L2_ZAMBIA_CORRIDOR%' OR m2.geo_level LIKE 'L2_KENYA_CORRIDOR%' OR m2.geo_level LIKE 'L2_ZIM_CORRIDOR%')
            ORDER BY m2.in_time_dt ASC LIMIT 1
        ) next_event ON true
        LEFT JOIN LATERAL (
            SELECT m3.geo_level FROM _chunk_merged m3
            WHERE m3.tracker_id = m1.tracker_id AND m3.in_time_dt < m1.in_time_dt
              AND (m3.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_CUSTOMER', 'L1_LOCAL_DELIVERY', 'L1_LPG_DEPOT', 'L2_TZ_LOCAL_DUAL') OR m3.geo_level LIKE 'L2_BORDER%' OR m3.geo_level LIKE 'L2_%CORRIDOR')
            ORDER BY m3.in_time_dt DESC LIMIT 1
        ) prev_trip_signal ON true
        WHERE m1.geo_level IN ('L1_TERMINAL', 'L1_ZONE', 'L1_ZONE_GATEWAY', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE', 'L1_ASAS_OPS')
    ),
    loading_visits AS (
        SELECT tracker_id, tracker_name, geofence_name, geo_level, in_time_dt, out_time_dt
        FROM potential_anchors WHERE is_primary = 1 OR is_fallback = 1
    ),
    session_flags AS (
        SELECT
            lv.tracker_id, lv.tracker_name, lv.geofence_name, lv.geo_level, lv.in_time_dt, lv.out_time_dt,
            CASE
                WHEN LAG(lv.out_time_dt) OVER (PARTITION BY lv.tracker_id ORDER BY lv.in_time_dt) IS NULL THEN 1
                WHEN EXISTS (
                    SELECT 1 FROM _chunk_merged m
                    WHERE m.tracker_id = lv.tracker_id
                      AND m.in_time_dt > (SELECT MAX(lv2.in_time_dt) FROM loading_visits lv2 WHERE lv2.tracker_id = lv.tracker_id AND lv2.in_time_dt < lv.in_time_dt)
                      AND m.in_time_dt < lv.in_time_dt
                      AND (
                          (lv.geo_level = 'L3_ORIGIN_REGION' AND 
                             m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_CUSTOMER', 'L1_LOCAL_DELIVERY', 'L1_LPG_DEPOT', 'L1_ASAS_BASE')
                          )
                          OR (lv.geo_level != 'L3_ORIGIN_REGION' AND (
                             m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_CUSTOMER', 'L1_LOCAL_DELIVERY', 'L1_LPG_DEPOT')
                             OR m.geo_level LIKE 'L2_BORDER%'
                          ))
                      )
                ) THEN 1
                ELSE 0
            END as is_new_session
        FROM loading_visits lv
    ),
    sessions AS (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as session_id
        FROM session_flags
    ),
    session_stats AS (
        SELECT
            tracker_id, tracker_name, session_id,
            MIN(in_time_dt) as loading_entry,
            MAX(out_time_dt) as loading_exit,
 
            -- ┌──────────────────────────────────────────────────────────────┐
            -- │ PATCHED loading_terminal: L1_ASAS_OPS at priority 1.5       │
            -- │ (below L1_ZONE=3 so real loading zones win the name)        │
            -- └──────────────────────────────────────────────────────────────┘
            COALESCE(
                (SELECT string_agg(DISTINCT sub.geofence_name, ' / ' ORDER BY sub.geofence_name)
                 FROM sessions sub 
                 WHERE sub.tracker_id = sessions.tracker_id AND sub.session_id = sessions.session_id
                   AND sub.geo_level = (
                       SELECT s2.geo_level 
                       FROM sessions s2 
                       WHERE s2.tracker_id = sessions.tracker_id AND s2.session_id = sessions.session_id 
                         AND s2.geo_level IN ('L1_TERMINAL', 'L1_ASAS_BASE', 'L1_ZONE', 'L1_ASAS_OPS', 'L1_ZONE_GATEWAY')
                       ORDER BY CASE 
                            WHEN s2.geo_level = 'L1_TERMINAL'     THEN 5
                            WHEN s2.geo_level = 'L1_ASAS_BASE'    THEN 4
                            WHEN s2.geo_level = 'L1_ZONE'         THEN 3
                            WHEN s2.geo_level = 'L1_ASAS_OPS'     THEN 2   -- ← NEW: below real zones
                            WHEN s2.geo_level = 'L1_ZONE_GATEWAY' THEN 1
                            ELSE 0 END DESC
                       LIMIT 1
                   )),
                (SELECT string_agg(DISTINCT sub.geofence_name, ' / ' ORDER BY sub.geofence_name)
                 FROM sessions sub 
                 WHERE sub.tracker_id = sessions.tracker_id AND sub.session_id = sessions.session_id
                   AND sub.geo_level = 'L3_ORIGIN_REGION')
            ) as loading_terminal,
            COUNT(DISTINCT geofence_name) FILTER (WHERE geo_level = 'L1_TERMINAL') as terminal_count,
 
            -- ┌──────────────────────────────────────────────────────────────┐
            -- │ PATCHED loading_start: same priority ladder                  │
            -- │ Result: when KURASINI ALL TOGETHER (L1_ZONE, prio 3) and    │
            -- │ Asas Tabata (L1_ASAS_OPS, prio 2) coexist in a session,    │
            -- │ L1_ZONE wins → loading_start = Kurasini's entry time.       │
            -- │ Asas Tabata time → waiting_for_orders_hrs (via dar_arrival). │
            -- └──────────────────────────────────────────────────────────────┘
            COALESCE(
                (SELECT MIN(sub.in_time_dt)
                 FROM sessions sub 
                 WHERE sub.tracker_id = sessions.tracker_id AND sub.session_id = sessions.session_id
                   AND sub.geo_level = (
                       SELECT s2.geo_level 
                       FROM sessions s2 
                       WHERE s2.tracker_id = sessions.tracker_id AND s2.session_id = sessions.session_id 
                         AND s2.geo_level IN ('L1_TERMINAL', 'L1_ASAS_BASE', 'L1_ZONE', 'L1_ASAS_OPS', 'L1_ZONE_GATEWAY')
                       ORDER BY CASE 
                            WHEN s2.geo_level = 'L1_TERMINAL'     THEN 5
                            WHEN s2.geo_level = 'L1_ASAS_BASE'    THEN 4
                            WHEN s2.geo_level = 'L1_ZONE'         THEN 3
                            WHEN s2.geo_level = 'L1_ASAS_OPS'     THEN 2
                            WHEN s2.geo_level = 'L1_ZONE_GATEWAY' THEN 1
                            ELSE 0 END DESC
                       LIMIT 1
                   )),
                 MIN(in_time_dt)
            ) as first_loading_area_entry,
 
            -- PATCHED last_loading_area_exit: same priority ladder
            COALESCE(
                (SELECT MAX(sub.out_time_dt)
                 FROM sessions sub 
                 WHERE sub.tracker_id = sessions.tracker_id AND sub.session_id = sessions.session_id
                   AND sub.geo_level = (
                       SELECT s2.geo_level 
                       FROM sessions s2 
                       WHERE s2.tracker_id = sessions.tracker_id AND s2.session_id = sessions.session_id 
                         AND s2.geo_level IN ('L1_TERMINAL', 'L1_ASAS_BASE', 'L1_ZONE', 'L1_ASAS_OPS', 'L1_ZONE_GATEWAY')
                       ORDER BY CASE 
                            WHEN s2.geo_level = 'L1_TERMINAL'     THEN 5
                            WHEN s2.geo_level = 'L1_ASAS_BASE'    THEN 4
                            WHEN s2.geo_level = 'L1_ZONE'         THEN 3
                            WHEN s2.geo_level = 'L1_ASAS_OPS'     THEN 2
                            WHEN s2.geo_level = 'L1_ZONE_GATEWAY' THEN 1
                            ELSE 0 END DESC
                       LIMIT 1
                   )),
                 MAX(out_time_dt)
            ) as last_loading_area_exit
        FROM sessions
        GROUP BY tracker_id, tracker_name, session_id
    )
 
    SELECT
        st.tracker_id, st.tracker_name, st.session_id,
        st.loading_entry,
        LEAST(st.loading_exit, COALESCE(LEAD(st.loading_entry) OVER (PARTITION BY st.tracker_id ORDER BY st.loading_entry), 'infinity'::timestamptz)) as loading_exit,
        st.loading_terminal,
        LEAD(st.loading_entry) OVER (PARTITION BY st.tracker_id ORDER BY st.loading_entry),
        st.first_loading_area_entry as loading_start,
        LEAST(
            st.last_loading_area_exit,
            COALESCE(LEAD(st.loading_entry) OVER (PARTITION BY st.tracker_id ORDER BY st.loading_entry), 'infinity'::timestamptz)
        ),
        LAG(st.loading_exit) OVER (PARTITION BY st.tracker_id ORDER BY st.loading_entry) as prev_loading_exit,
        LAG(st.loading_entry) OVER (PARTITION BY st.tracker_id ORDER BY st.loading_entry) as prev_loading_entry
    FROM session_stats st;
 
    CREATE INDEX IF NOT EXISTS _idx_cl_tracker ON _chunk_loading(tracker_id, loading_entry);
 
    RAISE NOTICE '  [step3 loading] done in %s', extract(epoch from clock_timestamp() - _step_start)::numeric(8,1);
    _step_start := clock_timestamp();
 
    -- ══════════════════════════════════════════════════════════════
    -- STEP 4: Build trip bounds — PATCHED
    --         dar_arrival now also checks L1_ASAS_OPS
    -- ══════════════════════════════════════════════════════════════
INSERT INTO tat_trips_data (
    tracker_id, tracker_name, session_id, loading_entry, loading_exit, loading_terminal,
    next_loading_entry, dar_arrival, dar_exit, next_dar_entry, dest_entry, dest_exit, dest_name,
    has_corridor_event,
    border_tunduma_entry, border_tunduma_exit,
    border_kasumbalesa_entry, border_kasumbalesa_exit,
    border_sakania_entry, border_sakania_exit,
    border_other_entry, border_other_exit,
    border_mokambo_entry, border_mokambo_exit,
    border_chembe_entry, border_chembe_exit,
    border_kasumulu_entry, border_kasumulu_exit,
    customs_entry, customs_exit,
    return_border_kasumbalesa_entry, return_border_kasumbalesa_exit,
    return_border_sakania_entry, return_border_sakania_exit,
    return_border_other_entry, return_border_other_exit,
    return_border_tunduma_entry, return_border_tunduma_exit,
    return_border_kasumulu_entry, return_border_kasumulu_exit,
    return_border_mokambo_entry, return_border_mokambo_exit,
    return_border_chembe_entry, return_border_chembe_exit,
    drc_region_entry, drc_region_exit,
    customer_name, customer_entry, customer_exit,
    loading_start, loading_end
)
SELECT
    ls.tracker_id, ls.tracker_name, ls.session_id,
    ls.loading_entry, ls.loading_exit, ls.loading_terminal,
    ls.next_loading_entry,
 
    -- dar_arrival — PATCHED: also checks L1_ASAS_OPS
    COALESCE(
        (SELECT MIN(m.in_time_dt) FROM _chunk_merged m
         WHERE m.tracker_id = ls.tracker_id
           AND m.geo_level IN ('L1_ASAS_BASE', 'L1_ASAS_OPS', 'L3_ORIGIN_REGION')
           AND m.in_time_dt < ls.loading_entry
           AND m.in_time_dt >= COALESCE(ls.prev_loading_exit, '-infinity'::timestamptz)
           AND m.in_time_dt > COALESCE(
               (SELECT MAX(m2.out_time_dt) FROM _chunk_merged m2
                WHERE m2.tracker_id = ls.tracker_id
                  AND (m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER','L1_LOCAL_DELIVERY','L1_LPG_DEPOT')
                    OR (m2.geo_level = 'L2_TZ_LOCAL_DUAL' AND EXTRACT(EPOCH FROM (m2.out_time_dt - m2.in_time_dt))/3600.0 > 3.0))
                  AND m2.out_time_dt < ls.loading_entry),
               '-infinity'::timestamptz)),
        (SELECT MIN(m.in_time_dt) FROM _chunk_merged m
         WHERE m.tracker_id = ls.tracker_id
           AND m.geo_level IN ('L3_ORIGIN_REGION', 'L1_ASAS_OPS')
           AND m.in_time_dt < ls.loading_entry
           AND m.in_time_dt >= COALESCE(ls.prev_loading_exit, '-infinity'::timestamptz)
           AND NOT EXISTS (
               SELECT 1 FROM _chunk_merged m2
               WHERE m2.tracker_id = ls.tracker_id
                 AND (m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER','L1_LOCAL_DELIVERY','L1_LPG_DEPOT')
                   OR (m2.geo_level = 'L2_TZ_LOCAL_DUAL' AND EXTRACT(EPOCH FROM (m2.out_time_dt - m2.in_time_dt))/3600.0 > 3.0))
                 AND m2.in_time_dt > m.in_time_dt
                 AND m2.in_time_dt < ls.loading_entry)),
        ls.loading_entry
    ),
 
    -- dar_exit (UNCHANGED)
    (SELECT MAX(m.out_time_dt) FROM _chunk_merged m
     WHERE m.tracker_id = ls.tracker_id
       AND m.geo_level = 'L3_ORIGIN_REGION'
       AND m.out_time_dt >= ls.loading_entry
       AND m.out_time_dt < COALESCE(
           (SELECT MIN(m2.in_time_dt) FROM _chunk_merged m2
            WHERE m2.tracker_id = ls.tracker_id
              AND (m2.geo_level LIKE 'L2_BORDER%'
                OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR','L2_TZ_CORRIDOR','L2_TZ_LOCAL_DUAL',
                                    'L2_KENYA_CORRIDOR','L2_ZIM_CORRIDOR','L1_OFFLOADING',
                                    'L1_DRC_REGION','L3_CUSTOMER','L1_LPG_DEPOT','L1_LOCAL_DELIVERY'))
              AND m2.in_time_dt > ls.loading_exit
              AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)),
           NOW())),
 
    ls.next_dar_entry,
 
    onward.dest_entry,
    onward.dest_exit,
    onward.dest_name,
    onward.has_corridor_event,
    onward.border_tunduma_entry,
    onward.border_tunduma_exit,
    onward.border_kasumbalesa_entry,
    onward.border_kasumbalesa_exit,
    onward.border_sakania_entry,
    onward.border_sakania_exit,
    onward.border_other_entry,
    onward.border_other_exit,
    onward.border_mokambo_entry,
    onward.border_mokambo_exit,
    onward.border_chembe_entry,
    onward.border_chembe_exit,
    onward.border_kasumulu_entry,
    onward.border_kasumulu_exit,
    onward.customs_entry,
    onward.customs_exit,
    ret.border_kasumbalesa_entry,
    ret.border_kasumbalesa_exit,
    ret.border_sakania_entry,
    ret.border_sakania_exit,
    ret.border_other_entry,
    ret.border_other_exit,
    ret.border_tunduma_entry,
    ret.border_tunduma_exit,
    ret.border_kasumulu_entry,
    ret.border_kasumulu_exit,
    ret.border_mokambo_entry,
    ret.border_mokambo_exit,
    ret.border_chembe_entry,
    ret.border_chembe_exit,
    onward.drc_entry,
    onward.drc_exit,
    onward.customer_name,
    onward.customer_entry,
    onward.customer_exit,
    ls.loading_term_start,
    ls.loading_term_end
 
FROM (
    SELECT
        cl.*,
        -- next_dar_entry — PATCHED: also checks L1_ASAS_OPS
        COALESCE(
            (SELECT MIN(m.in_time_dt) FROM _chunk_merged m
             WHERE m.tracker_id = cl.tracker_id
               AND m.geo_level IN ('L1_ASAS_BASE', 'L1_ASAS_OPS', 'L3_ORIGIN_REGION')
               AND m.in_time_dt > COALESCE(
                   (SELECT MAX(m2.out_time_dt) FROM _chunk_merged m2
                    WHERE m2.tracker_id = cl.tracker_id
                      AND (m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER','L1_LOCAL_DELIVERY','L1_LPG_DEPOT')
                        OR (m2.geo_level = 'L2_TZ_LOCAL_DUAL' AND EXTRACT(EPOCH FROM (m2.out_time_dt - m2.in_time_dt))/3600.0 > 3.0))
                      AND m2.in_time_dt > cl.loading_exit
                      AND m2.in_time_dt < COALESCE(cl.next_loading_entry, 'infinity'::timestamptz)),
                   cl.loading_exit + INTERVAL '48 hours')
               AND m.in_time_dt <= COALESCE(cl.next_loading_entry, 'infinity'::timestamptz)),
            (SELECT MIN(m.in_time_dt) FROM _chunk_merged m
             WHERE m.tracker_id = cl.tracker_id
               AND m.geo_level = 'L3_DAR_GATEWAY'
               AND m.in_time_dt > COALESCE(
                   (SELECT MAX(m2.out_time_dt) FROM _chunk_merged m2
                    WHERE m2.tracker_id = cl.tracker_id
                      AND (m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER','L1_LOCAL_DELIVERY','L1_LPG_DEPOT')
                        OR (m2.geo_level = 'L2_TZ_LOCAL_DUAL' AND EXTRACT(EPOCH FROM (m2.out_time_dt - m2.in_time_dt))/3600.0 > 3.0))
                      AND m2.in_time_dt > cl.loading_exit
                      AND m2.in_time_dt < COALESCE(cl.next_loading_entry, 'infinity'::timestamptz)),
                   cl.loading_exit + INTERVAL '48 hours')
               AND m.in_time_dt <= COALESCE(cl.next_loading_entry, 'infinity'::timestamptz))
        ) AS next_dar_entry
    FROM _chunk_loading cl
) ls
 
-- ─── ONWARD LEG (UNCHANGED) ────────────────────────────────────
LEFT JOIN LATERAL (
    SELECT
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level IN ('L1_OFFLOADING','L3_CUSTOMER')
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0)          AS dest_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level IN ('L1_OFFLOADING','L3_CUSTOMER')
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0)          AS dest_exit,
        MIN(m.geofence_name) FILTER (WHERE m.geo_level IN ('L1_OFFLOADING','L3_CUSTOMER')
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0)          AS dest_name,
 
        BOOL_OR(m.geo_level IN (
            'L2_BORDER_ZMB','L2_BORDER_DRC','L2_BORDER_TZ','L2_BORDER_NAKONDE',
            'L2_BORDER_TUNDUMA_ALL','L2_BORDER_OTHER','L2_BORDER_MOKAMBO',
            'L2_BORDER_CHEMBE','L2_BORDER_KASUMULU','L2_ZAMBIA_CORRIDOR',
            'L2_TZ_CORRIDOR','L2_TZ_LOCAL_DUAL','L2_KENYA_CORRIDOR',
            'L2_ZIM_CORRIDOR','L2_CHECKPOINT_TRA'))                                        AS has_corridor_event,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name IN (
            'ASAS Chapwa Yard','ASAS Chapwa  Yard','CHAPWA',
            'Tanzania Tunduma Border','TUNDUMA BORDER TZ SIDE',
            'Tunduma Border 1','NAKONDE BORDER ZMB SIDE','Zambia Nakonde Border')
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_tunduma_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name IN (
            'Tanzania Tunduma Border','TUNDUMA BORDER TZ SIDE',
            'Tunduma Border 1','NAKONDE BORDER ZMB SIDE','Zambia Nakonde Border')
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_tunduma_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name IN (
            'KASUMBALESA ZMB SIDE','KASUMBALESA BORDER  DRC SIDE',
            'Kasumbalesa Border (DRC)','KASUMBALESA')
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_kasumbalesa_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name IN (
            'KASUMBALESA ZMB SIDE','KASUMBALESA BORDER  DRC SIDE',
            'Kasumbalesa Border (DRC)','KASUMBALESA')
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_kasumbalesa_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name IN (
            'SAKANIA ZMB SIDE','Sakania border','SAKANIA DRC','SAKANIA BORDER')
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_sakania_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name IN (
            'SAKANIA ZMB SIDE','Sakania border','SAKANIA DRC','SAKANIA BORDER')
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_sakania_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level = 'L2_BORDER_OTHER'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_other_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level = 'L2_BORDER_OTHER'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_other_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name = 'Mokambo border'
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_mokambo_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name = 'Mokambo border'
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_mokambo_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level = 'L2_BORDER_CHEMBE'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_chembe_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level = 'L2_BORDER_CHEMBE'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_chembe_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name = 'KASUMULU BORDER'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_kasumulu_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name = 'KASUMULU BORDER'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS border_kasumulu_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level = 'L2_CUSTOMS_DRC'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS customs_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level = 'L2_CUSTOMS_DRC'
            AND m.in_time_dt < onward_dest_ceil.dest_ceil)                                 AS customs_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level = 'L1_DRC_REGION'
            AND m.in_time_dt < COALESCE(ls.next_dar_entry, COALESCE(ls.next_loading_entry,'infinity'::timestamptz))) AS drc_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level = 'L1_DRC_REGION'
            AND m.in_time_dt < COALESCE(ls.next_dar_entry, COALESCE(ls.next_loading_entry,'infinity'::timestamptz))) AS drc_exit,
 
        MIN(m.geofence_name) FILTER (WHERE m.geo_level = 'L3_CUSTOMER'
            AND m.in_time_dt < COALESCE(ls.next_dar_entry, COALESCE(ls.next_loading_entry,'infinity'::timestamptz))) AS customer_name,
        MIN(m.in_time_dt)    FILTER (WHERE m.geo_level = 'L3_CUSTOMER'
            AND m.in_time_dt < COALESCE(ls.next_dar_entry, COALESCE(ls.next_loading_entry,'infinity'::timestamptz))) AS customer_entry,
        MAX(m.out_time_dt)   FILTER (WHERE m.geo_level = 'L3_CUSTOMER'
            AND m.in_time_dt < COALESCE(ls.next_dar_entry, COALESCE(ls.next_loading_entry,'infinity'::timestamptz))) AS customer_exit
 
    FROM _chunk_merged m
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            MIN(m2.in_time_dt) FILTER (WHERE m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER')
                AND m2.tracker_id = ls.tracker_id
                AND m2.in_time_dt > ls.loading_exit
                AND m2.in_time_dt < COALESCE(ls.next_loading_entry,'infinity'::timestamptz)),
            COALESCE(ls.next_loading_entry,'infinity'::timestamptz)
        ) AS dest_ceil
        FROM _chunk_merged m2
        WHERE m2.tracker_id = ls.tracker_id
          AND m2.in_time_dt > ls.loading_exit
          AND m2.in_time_dt < COALESCE(ls.next_loading_entry,'infinity'::timestamptz)
          AND m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER')
        LIMIT 1
    ) onward_dest_ceil
 
    WHERE m.tracker_id = ls.tracker_id
      AND m.in_time_dt > ls.loading_exit
      AND m.in_time_dt < COALESCE(ls.next_loading_entry,'infinity'::timestamptz)
) onward ON true
 
-- ─── RETURN LEG (UNCHANGED) ────────────────────────────────────
LEFT JOIN LATERAL (
    SELECT
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name IN (
            'KASUMBALESA ZMB SIDE','KASUMBALESA BORDER  DRC SIDE',
            'Kasumbalesa Border (DRC)','KASUMBALESA'))                                     AS border_kasumbalesa_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name IN (
            'KASUMBALESA ZMB SIDE','KASUMBALESA BORDER  DRC SIDE',
            'Kasumbalesa Border (DRC)','KASUMBALESA'))                                     AS border_kasumbalesa_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name IN (
            'Tanzania Tunduma Border','TUNDUMA BORDER TZ SIDE',
            'Tunduma Border 1','NAKONDE BORDER ZMB SIDE','Zambia Nakonde Border'))         AS border_tunduma_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name IN (
            'ASAS Chapwa Yard','ASAS Chapwa  Yard','CHAPWA',
            'Tanzania Tunduma Border','TUNDUMA BORDER TZ SIDE',
            'Tunduma Border 1','NAKONDE BORDER ZMB SIDE','Zambia Nakonde Border'))         AS border_tunduma_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name IN (
            'SAKANIA ZMB SIDE','Sakania border','SAKANIA DRC','SAKANIA BORDER'))           AS border_sakania_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name IN (
            'SAKANIA ZMB SIDE','Sakania border','SAKANIA DRC','SAKANIA BORDER'))           AS border_sakania_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level = 'L2_BORDER_OTHER')                AS border_other_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level = 'L2_BORDER_OTHER')                AS border_other_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name = 'KASUMULU BORDER')            AS border_kasumulu_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name = 'KASUMULU BORDER')            AS border_kasumulu_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geofence_name = 'Mokambo border'
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0)         AS border_mokambo_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geofence_name = 'Mokambo border'
            AND EXTRACT(EPOCH FROM (m.out_time_dt - m.in_time_dt))/3600.0 > 1.0)         AS border_mokambo_exit,
 
        MIN(m.in_time_dt)  FILTER (WHERE m.geo_level = 'L2_BORDER_CHEMBE')               AS border_chembe_entry,
        MAX(m.out_time_dt) FILTER (WHERE m.geo_level = 'L2_BORDER_CHEMBE')               AS border_chembe_exit
 
    FROM _chunk_merged m
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            MAX(m2.out_time_dt) FILTER (WHERE
                m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER')
                AND m2.tracker_id = ls.tracker_id
                AND m2.in_time_dt > ls.loading_exit
                AND m2.in_time_dt < COALESCE(ls.next_loading_entry,'infinity'::timestamptz)),
            ls.loading_exit
        ) AS return_floor
        FROM _chunk_merged m2
        WHERE m2.tracker_id = ls.tracker_id
          AND m2.in_time_dt > ls.loading_exit
          AND m2.in_time_dt < COALESCE(ls.next_loading_entry,'infinity'::timestamptz)
          AND m2.geo_level IN ('L1_OFFLOADING','L1_DRC_REGION','L3_CUSTOMER')
    ) return_bounds
 
    WHERE m.tracker_id = ls.tracker_id
      AND m.in_time_dt > return_bounds.return_floor
      AND m.in_time_dt < COALESCE(ls.next_loading_entry,'infinity'::timestamptz)
) ret ON true
 
WHERE ls.loading_term_start IS NOT NULL
 
ON CONFLICT (tracker_id, loading_end) DO UPDATE SET
    loading_entry                    = LEAST(tat_trips_data.loading_entry, EXCLUDED.loading_entry),
    tracker_name                     = EXCLUDED.tracker_name,
    session_id                       = EXCLUDED.session_id,
    loading_exit                     = EXCLUDED.loading_exit,
    loading_terminal                 = EXCLUDED.loading_terminal,
    next_loading_entry               = EXCLUDED.next_loading_entry,
    dar_arrival                      = EXCLUDED.dar_arrival,
    dar_exit                         = EXCLUDED.dar_exit,
    next_dar_entry                   = EXCLUDED.next_dar_entry,
    dest_entry                       = EXCLUDED.dest_entry,
    dest_exit                        = EXCLUDED.dest_exit,
    dest_name                        = EXCLUDED.dest_name,
    has_corridor_event               = EXCLUDED.has_corridor_event,
    border_tunduma_entry             = EXCLUDED.border_tunduma_entry,
    border_tunduma_exit              = EXCLUDED.border_tunduma_exit,
    border_kasumbalesa_entry         = EXCLUDED.border_kasumbalesa_entry,
    border_kasumbalesa_exit          = EXCLUDED.border_kasumbalesa_exit,
    border_sakania_entry             = EXCLUDED.border_sakania_entry,
    border_sakania_exit              = EXCLUDED.border_sakania_exit,
    border_other_entry               = EXCLUDED.border_other_entry,
    border_other_exit                = EXCLUDED.border_other_exit,
    border_mokambo_entry             = EXCLUDED.border_mokambo_entry,
    border_mokambo_exit              = EXCLUDED.border_mokambo_exit,
    border_chembe_entry              = EXCLUDED.border_chembe_entry,
    border_chembe_exit               = EXCLUDED.border_chembe_exit,
    border_kasumulu_entry            = EXCLUDED.border_kasumulu_entry,
    border_kasumulu_exit             = EXCLUDED.border_kasumulu_exit,
    customs_entry                    = EXCLUDED.customs_entry,
    customs_exit                     = EXCLUDED.customs_exit,
    return_border_kasumbalesa_entry  = EXCLUDED.return_border_kasumbalesa_entry,
    return_border_kasumbalesa_exit   = EXCLUDED.return_border_kasumbalesa_exit,
    return_border_tunduma_entry      = EXCLUDED.return_border_tunduma_entry,
    return_border_tunduma_exit       = EXCLUDED.return_border_tunduma_exit,
    return_border_sakania_entry      = EXCLUDED.return_border_sakania_entry,
    return_border_sakania_exit       = EXCLUDED.return_border_sakania_exit,
    return_border_other_entry        = EXCLUDED.return_border_other_entry,
    return_border_other_exit         = EXCLUDED.return_border_other_exit,
    return_border_kasumulu_entry     = EXCLUDED.return_border_kasumulu_entry,
    return_border_kasumulu_exit      = EXCLUDED.return_border_kasumulu_exit,
    return_border_mokambo_entry      = EXCLUDED.return_border_mokambo_entry,
    return_border_mokambo_exit       = EXCLUDED.return_border_mokambo_exit,
    return_border_chembe_entry       = EXCLUDED.return_border_chembe_entry,
    return_border_chembe_exit        = EXCLUDED.return_border_chembe_exit,
    drc_region_entry                 = EXCLUDED.drc_region_entry,
    drc_region_exit                  = EXCLUDED.drc_region_exit,
    customer_name                    = EXCLUDED.customer_name,
    customer_entry                   = EXCLUDED.customer_entry,
    customer_exit                    = EXCLUDED.customer_exit,
    loading_start                    = EXCLUDED.loading_start,
    loading_end                      = EXCLUDED.loading_end;
 
    RAISE NOTICE '  [step4 trip_build] done in %s', extract(epoch from clock_timestamp() - _step_start)::numeric(8,1);
    RAISE NOTICE '  TOTAL chunk time: %s seconds', extract(epoch from clock_timestamp() - _chunk_start)::numeric(8,1);
 
    -- Cleanup
    DROP TABLE IF EXISTS _chunk_classified;
    DROP TABLE IF EXISTS _chunk_merged;
    DROP TABLE IF EXISTS _chunk_loading;
END;
$$;
-- FAST WRAPPER FOR DASHBOARD DATA (Reading from Materialized View)

-- =============================================================
DROP FUNCTION IF EXISTS get_tat_trip_details(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_tat_trip_details(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS get_tat_trip_details(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS get_tat_trip_details(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_tat_trip_details(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_trip_type TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_destination TEXT DEFAULT NULL,
    p_tracker_id INTEGER DEFAULT NULL,
    p_sort TEXT DEFAULT 'tat_desc',
    p_origin TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
    v_total_completed INTEGER;
    v_total_returning INTEGER;
    v_total_unfinished INTEGER;
    v_total_missed_dest INTEGER;
BEGIN
    -- Counts
    SELECT COUNT(*) INTO v_total_completed FROM tat_trips_view 
    WHERE (dest_name IS NOT NULL) 
      AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) 
      AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);
    
    SELECT COUNT(*) INTO v_total_returning FROM tat_trips_view 
    WHERE dest_exit IS NOT NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);
      
    SELECT COUNT(*) INTO v_total_unfinished FROM tat_trips_view 
    WHERE dest_exit IS NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    SELECT COUNT(*) INTO v_total_missed_dest FROM tat_trips_view 
    WHERE (dest_exit IS NULL AND dest_name IS NULL) AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- Results
    SELECT json_build_object(
        'total_completed', v_total_completed,
        'total_returning', v_total_returning,
        'total_unfinished', v_total_unfinished,
        'total_missed_dest', v_total_missed_dest,
        'limit', p_limit,
        'offset', p_offset,
        'data', COALESCE(json_agg(row_to_json(res) ORDER BY departure_time DESC), '[]'::json)
    ) INTO v_result
    FROM (
        SELECT 
            t.tracker_id,
            t.tracker_name,
            COALESCE(t.dar_arrival, t.loading_start) as departure_time,
            t.dar_arrival,
            t.loading_entry as kurasini_entry,
            t.loading_exit as kurasini_exit,
            t.loading_start,
            t.loading_end,
            t.dar_exit,
            t.dest_entry,
            t.dest_name,
            t.dest_exit,
            t.loading_terminal,
            t.next_dar_entry,

            t.border_tunduma_entry, t.border_tunduma_exit,
            t.border_kasumbalesa_entry, t.border_kasumbalesa_exit,
            t.border_sakania_entry, t.border_sakania_exit,
            t.border_other_entry, t.border_other_exit,
            t.border_mokambo_entry, t.border_mokambo_exit,
            t.border_chembe_entry, t.border_chembe_exit,
            t.border_kasumulu_entry, t.border_kasumulu_exit,

            t.return_border_tunduma_entry, t.return_border_tunduma_exit,
            t.return_border_kasumbalesa_entry, t.return_border_kasumbalesa_exit,
            t.return_border_sakania_entry, t.return_border_sakania_exit,
            t.return_border_other_entry, t.return_border_other_exit,
            t.return_border_mokambo_entry, t.return_border_mokambo_exit,
            t.return_border_chembe_entry, t.return_border_chembe_exit,
            t.return_border_kasumulu_entry, t.return_border_kasumulu_exit,

            t.customs_entry, t.customs_exit,
            t.drc_region_entry, t.drc_region_exit,
            t.customer_name, t.customer_entry, t.customer_exit,

            CASE WHEN t.dar_arrival IS NOT NULL THEN EXTRACT(EPOCH FROM (t.loading_start - t.dar_arrival))/3600.0 ELSE 0 END as waiting_for_orders_hrs,
            EXTRACT(EPOCH FROM (t.loading_end - t.loading_start))/3600.0 as loading_phase_hrs,
            CASE WHEN t.dar_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dar_exit - t.loading_end))/3600.0 ELSE 0 END as post_loading_delay_hrs,
            CASE WHEN t.dest_entry IS NOT NULL AND (t.dar_exit IS NOT NULL OR t.loading_end IS NOT NULL) THEN EXTRACT(EPOCH FROM (t.dest_entry - COALESCE(t.dar_exit, t.loading_end)))/3600.0 ELSE NULL END as transit_hrs,

            CASE WHEN t.border_tunduma_entry IS NOT NULL AND t.border_tunduma_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_tunduma_exit - t.border_tunduma_entry))/3600.0 ELSE NULL END as border_tunduma_hrs,
            CASE WHEN t.border_kasumbalesa_entry IS NOT NULL AND t.border_kasumbalesa_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_kasumbalesa_exit - t.border_kasumbalesa_entry))/3600.0 ELSE NULL END as border_kasumbalesa_hrs,
            CASE WHEN t.border_sakania_entry IS NOT NULL AND t.border_sakania_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_sakania_exit - t.border_sakania_entry))/3600.0 ELSE NULL END as border_sakania_hrs,
            CASE WHEN t.border_other_entry IS NOT NULL AND t.border_other_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_other_exit - t.border_other_entry))/3600.0 ELSE NULL END as border_other_hrs,
            CASE WHEN t.border_mokambo_entry IS NOT NULL AND t.border_mokambo_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_mokambo_exit - t.border_mokambo_entry))/3600.0 ELSE NULL END as border_mokambo_hrs,
            CASE WHEN t.border_chembe_entry IS NOT NULL AND t.border_chembe_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_chembe_exit - t.border_chembe_entry))/3600.0 ELSE NULL END as border_chembe_hrs,
            CASE WHEN t.border_kasumulu_entry IS NOT NULL AND t.border_kasumulu_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_kasumulu_exit - t.border_kasumulu_entry))/3600.0 ELSE NULL END as border_kasumulu_hrs,

            CASE WHEN t.return_border_tunduma_entry IS NOT NULL AND t.return_border_tunduma_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_tunduma_exit - t.return_border_tunduma_entry))/3600.0 ELSE NULL END as return_border_tunduma_hrs,
            CASE WHEN t.return_border_kasumbalesa_entry IS NOT NULL AND t.return_border_kasumbalesa_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_kasumbalesa_exit - t.return_border_kasumbalesa_entry))/3600.0 ELSE NULL END as return_border_kasumbalesa_hrs,
            CASE WHEN t.return_border_sakania_entry IS NOT NULL AND t.return_border_sakania_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_sakania_exit - t.return_border_sakania_entry))/3600.0 ELSE NULL END as return_border_sakania_hrs,
            CASE WHEN t.return_border_other_entry IS NOT NULL AND t.return_border_other_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_other_exit - t.return_border_other_entry))/3600.0 ELSE NULL END as return_border_other_hrs,
            CASE WHEN t.return_border_mokambo_entry IS NOT NULL AND t.return_border_mokambo_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_mokambo_exit - t.return_border_mokambo_entry))/3600.0 ELSE NULL END as return_border_mokambo_hrs,
            CASE WHEN t.return_border_chembe_entry IS NOT NULL AND t.return_border_chembe_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_chembe_exit - t.return_border_chembe_entry))/3600.0 ELSE NULL END as return_border_chembe_hrs,
            CASE WHEN t.return_border_kasumulu_entry IS NOT NULL AND t.return_border_kasumulu_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_kasumulu_exit - t.return_border_kasumulu_entry))/3600.0 ELSE NULL END as return_border_kasumulu_hrs,

            CASE WHEN t.customs_entry IS NOT NULL AND t.customs_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.customs_exit - t.customs_entry))/3600.0 ELSE NULL END as customs_hrs,
            CASE WHEN t.drc_region_entry IS NOT NULL AND t.drc_region_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.drc_region_exit - t.drc_region_entry))/3600.0 ELSE NULL END as drc_region_hrs,
            CASE WHEN t.dest_entry IS NOT NULL AND t.dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0 ELSE NULL END as dest_dwell_hrs,
            CASE WHEN t.customer_entry IS NOT NULL AND t.customer_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.customer_exit - t.customer_entry))/3600.0 ELSE NULL END as customer_dwell_hrs,
            CASE WHEN t.dest_exit IS NOT NULL AND t.next_dar_entry IS NOT NULL THEN EXTRACT(EPOCH FROM (t.next_dar_entry - t.dest_exit))/3600.0 ELSE NULL END as return_hrs,

            CASE WHEN (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL) THEN EXTRACT(EPOCH FROM (COALESCE(t.next_dar_entry, t.next_loading_entry) - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
                WHEN t.dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_exit - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
                WHEN t.dest_entry IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_entry - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
                ELSE EXTRACT(EPOCH FROM (NOW() - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
            END as total_tat_hrs,

            CASE
                WHEN t.dest_name IS NOT NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL) THEN 'completed'
                WHEN (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL OR t.dar_arrival >= t.loading_end) THEN 'completed_missed_dest'
                WHEN t.dest_exit IS NOT NULL THEN 'returning'
                WHEN t.dest_entry IS NOT NULL THEN 'at_destination'
                WHEN t.dar_exit IS NOT NULL THEN 'in_transit'
                WHEN t.loading_end IS NOT NULL AND t.loading_end > t.loading_entry THEN 'pre_transit'
                ELSE 'loading'
            END as trip_status,
            (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL OR t.dar_arrival >= t.loading_end) as is_completed,
            (t.dest_exit IS NOT NULL AND t.next_dar_entry IS NULL AND t.next_loading_entry IS NULL) as is_returning,
            CASE WHEN t.dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN t.has_corridor_event THEN 'long_haul' ELSE 'local_ops' END as trip_type,

            (
                SELECT COALESCE(json_agg(
                    json_build_object(
                        'geofence_name', g.geofence_name,
                        'in_time', g.in_time_dt,
                        'out_time', g.out_time_dt,
                        'event_type', CASE 
                            WHEN g.geofence_name IN (
                                'Loading Operations (Kurasini)', 'Loading Operations (Beira)',
                                'Loading Operations (Mtwara)', 'Loading Operations (Mombasa)',
                                'TIPER DEPOT', 'Puma Depo Kurasini', 'Oryx Loading Depo (Kigamboni)',
                                'Oryx Dar Depo', 'Oilcom Dar Depo', 'OILCOM LIMITED TERMINAL DEPOT',
                                'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                                'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                                'GBP TANGA TERMINAL', 'Oryx FUEL DEPOT',
                                'Camel Oil', 'Petrobeira', 'Petroda', 'Lake Oil',
                                'Inpetro', 'Xstorage', 'Mount Meru',
                                'Oryx Mtwara Depot', 'Oilcom Mtwara Depot',
                                'VIVO ENERGY MOMBASA TERMINAL'
                            ) OR g.geofence_name ILIKE '%KURASINI%' THEN 'loading'
                            WHEN g.geofence_name IN (
                                'Tanga GF', 'Mtwara GF', 'Beira', 'Beira GF',
                                'KURASINI ALL TOGETHER', 'Mombasa GF'
                            ) AND t.loading_terminal IS NOT NULL AND POSITION(UPPER(g.geofence_name) IN UPPER(t.loading_terminal)) > 0 THEN 'loading'
                            WHEN t.dest_name IS NOT NULL AND (
                                POSITION(UPPER(g.geofence_name) IN UPPER(t.dest_name)) > 0
                                OR (g.geofence_name = 'Asas Head Office (Ipogoro)' AND UPPER(t.dest_name) LIKE '%IPOGO%')
                            ) THEN 'unloading'
                            WHEN g.geofence_name IN (
                                'Tunduma Border', 'Nakonde Border',
                                'Kasumbalesa Border', 'Sakania Boundary',
                                'ASAS Chapwa Yard',
                                'TUNDUMA BORDER TZ SIDE', 'Tanzania Tunduma Border',
                                'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border',
                                'Tunduma Border 1',
                                'KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border',
                                'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)',
                                'KASUMBALESA', 'SAKANIA DRC',
                                'Mokambo border', 'Chembe Border', 'Chembe Border Post',
                                'KASUMULU BORDER',
                                'CHIRUNDU BORDER', 'CHIRUNDU BORDER ZIM SIDE', 'CHIRUNDU BORDER ZAMBIA SIDE',
                                'KABANGA BORDER', 'RUSUMO BORDER', 'MALABA BORDER',
                                'Horohoro border', 'MUTUKULA BORDER',
                                'Chimefusa Border', 'Manyouvu Border', 'Mutare Border'
                            ) THEN 'border'
                            ELSE 'transit'
                        END
                    ) ORDER BY g.in_time_dt ASC
                ), '[]'::json)
                FROM (
                    SELECT final_name as geofence_name, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt
                    FROM (
                        SELECT *, SUM(is_new_gap) OVER (ORDER BY in_time_dt) as sid
                        FROM (
                            SELECT *, 
                                   CASE WHEN final_name = LAG(final_name) OVER (ORDER BY in_time_dt) 
                                     AND (in_time_dt - LAG(out_time_dt) OVER (ORDER BY in_time_dt)) <= 
                                         CASE WHEN final_name LIKE 'Loading Operations%' THEN INTERVAL '36 hours' ELSE INTERVAL '12 hours' END
                                   THEN 0 ELSE 1 END AS is_new_gap
                            FROM (
                                SELECT 
                                    filtered.orig_name,
                                    CASE 
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)', 'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT', 'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT', 'GBP TANGA TERMINAL', 'KURASINI ALL TOGETHER') THEN 'Loading Operations (Kurasini)'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL', 'INPETRO', 'XSTORAGE', 'MOUNT MERU') THEN 'Loading Operations (Beira)'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT') THEN 'Loading Operations (Mtwara)'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('VIVO ENERGY MOMBASA TERMINAL') THEN 'Loading Operations (Mombasa)'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('IPOGORO', 'ASAS HEAD OFFICE IPOGOLO YARD -IRINGA') THEN 'Asas Head Office (Ipogoro)'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('TUNDUMA BORDER TZ SIDE', 'TANZANIA TUNDUMA BORDER', 'TUNDUMA BORDER 1') THEN 'Tunduma Border'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('NAKONDE BORDER ZMB SIDE', 'ZAMBIA NAKONDE BORDER') THEN 'Nakonde Border'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('SAKANIA ZMB SIDE', 'SAKANIA BORDER', 'SAKANIA DRC', 'MOKAMBO BORDER') THEN 'Sakania Boundary'
                                        WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') IN ('KASUMBALESA ZMB SIDE', 'KASUMBALESA BORDER DRC SIDE', 'KASUMBALESA BORDER (DRC)', 'KASUMBALESA') THEN 'Kasumbalesa Border'
                                        ELSE filtered.orig_name
                                    END as final_name,
                                    filtered.in_time_dt,
                                    filtered.out_time_dt
                                FROM (
                                    SELECT 
                                        inner_v.orig_name,
                                        inner_v.in_time_dt,
                                        inner_v.out_time_dt,
                                        inner_v.geo_type
                                    FROM (
                                        SELECT 
                                            gv.geofence_name as orig_name,
                                            gv.in_time_dt,
                                            gv.out_time_dt,
                                            CASE 
                                                WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN (
                                                    'TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)',
                                                    'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT',
                                                    'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                                                    'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                                                    'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                                                    'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL',
                                                    'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                                                    'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                                                    'VIVO ENERGY MOMBASA TERMINAL',
                                                    'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS KIBAHA DSM -YARD', 'ASAS TABATA',
                                                    'ASAS HEAD OFFICE IPOGOLO  YARD -IRINGA',
                                                    'EXPREE OIL DEPOT', 'SEP CONGO', 'UNITED PETROLEUM LUBUMBASHI', 'KANATA PETROLEUM DEPOT (CONSTALINA)', 'KOLWEZI OFFLOADING', 'LUALABA OIL (KOLWEZI)', 'UNITED PETROLEUM KOLWEZI', 'FRONTIER', 'LUMWANA MINES',
                                                    'LUSAKA DEPOT', 'NDOLA OFFLOADING', 'MZUZU OFFLOADING', 'LILONGWE', 'JINJA GF', 'KAMPALA GF', 'BUJUMBURA GF', 'KIGALI GF', 'BLANTYRE', 'BLANTYRE OFFLOADING',
                                                    'ISAKA LPG DEPOT', 'DODOMA LPG DEPOT', 'ORYX DODOMA LPG DEPOT', 'MWANZA LPG DEPOT', 'MOSHI LPG DEPOT', 'IRINGA LPG DEPOT', 'MBEYA LPG DEPOT'
                                                ) THEN 'specific'
                                                WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'KILUVYA TO MBEZI  GEOFENCE', 'TANGA GF', 'MTWARA GF', 'BEIRA GEOFENCE', 'BEIRA GF', 'MOMBASA GF', 'KURASINI ALL TOGETHER', 'DRC OFFLOADING GEO', 'LUBUMBASHI', 'CHAPWA') THEN 'broad'
                                                ELSE 'other'
                                            END as geo_type
                                        FROM public.geofence_visits gv
                                        WHERE gv.tracker_id = t.tracker_id
                                          AND gv.in_time_dt >= COALESCE(t.dar_arrival, t.loading_start)
                                          AND gv.in_time_dt <= COALESCE(t.next_dar_entry, t.next_loading_entry, NOW())
                                    ) inner_v
                                    WHERE geo_type != 'broad'
                                       OR NOT EXISTS (
                                           SELECT 1 
                                           FROM (
                                               SELECT geofence_name, in_time_dt, out_time_dt,
                                                   CASE 
                                                       WHEN regexp_replace(UPPER(TRIM(geofence_name)), '\s+', ' ', 'g') IN (
                                                           'TIPER DEPOT', 'PUMA DEPO KURASINI', 'ORYX LOADING DEPO (KIGAMBONI)',
                                                           'ORYX DAR DEPO', 'OILCOM DAR DEPO', 'OILCOM LIMITED TERMINAL DEPOT',
                                                           'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT',
                                                           'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT',
                                                           'GBP TANGA TERMINAL', 'ORYX FUEL DEPOT',
                                                           'CAMEL OIL', 'PETROBEIRA', 'PETRODA', 'LAKE OIL',
                                                           'INPETRO', 'XSTORAGE', 'MOUNT MERU',
                                                           'ORYX MTWARA DEPOT', 'OILCOM MTWARA DEPOT',
                                                           'VIVO ENERGY MOMBASA TERMINAL',
                                                           'ASAS DSM OFFICE / DAR W/SHOP', 'ASAS KIBAHA DSM -YARD', 'ASAS TABATA',
                                                           'ASAS HEAD OFFICE IPOGOLO  YARD -IRINGA',
                                                           'EXPREE OIL DEPOT', 'SEP CONGO', 'UNITED PETROLEUM LUBUMBASHI', 'KANATA PETROLEUM DEPOT (CONSTALINA)', 'KOLWEZI OFFLOADING', 'LUALABA OIL (KOLWEZI)', 'UNITED PETROLEUM KOLWEZI', 'FRONTIER', 'LUMWANA MINES',
                                                           'LUSAKA DEPOT', 'NDOLA OFFLOADING', 'MZUZU OFFLOADING', 'LILONGWE', 'JINJA GF', 'KAMPALA GF', 'BUJUMBURA GF', 'KIGALI GF', 'BLANTYRE', 'BLANTYRE OFFLOADING',
                                                           'ISAKA LPG DEPOT', 'DODOMA LPG DEPOT', 'ORYX DODOMA LPG DEPOT', 'MWANZA LPG DEPOT', 'MOSHI LPG DEPOT', 'IRINGA LPG DEPOT', 'MBEYA LPG DEPOT'
                                                       ) THEN 'specific'
                                                       ELSE 'other'
                                                   END as spec_type
                                               FROM public.geofence_visits gv2
                                               WHERE gv2.tracker_id = t.tracker_id
                                                 AND gv2.in_time_dt <= inner_v.out_time_dt
                                                 AND gv2.out_time_dt >= inner_v.in_time_dt
                                                 AND gv2.geofence_name != inner_v.orig_name
                                           ) spec
                                           WHERE spec.spec_type = 'specific'
                                       )
                                ) filtered
                            ) grouping_base
                        ) numbered
                    ) combined
                    WHERE NOT (final_name = 'Sakania Boundary' AND orig_name = 'Mokambo border' AND (out_time_dt - in_time_dt) < INTERVAL '1 hour')
                    GROUP BY final_name, sid
                ) g
            ) as visit_chain

        FROM tat_trips_view t
        WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
          AND (p_destination IS NULL OR t.dest_name = p_destination)
          AND (p_origin IS NULL OR t.loading_terminal = p_origin)
          AND (p_trip_type IS NULL OR CASE WHEN t.dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN t.has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type)
          AND (p_tracker_id IS NULL OR t.tracker_id = p_tracker_id)
          AND (p_status IS NULL
               OR (p_status = 'completed' AND t.dest_name IS NOT NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL))
               OR (p_status = 'returning' AND t.dest_exit IS NOT NULL AND t.next_dar_entry IS NULL AND t.next_loading_entry IS NULL)
               OR (p_status = 'unfinished' AND t.dest_exit IS NULL AND t.next_dar_entry IS NULL AND t.next_loading_entry IS NULL)
               OR (p_status = 'completed_or_returning' AND (t.dest_exit IS NOT NULL OR t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL))
               OR (p_status = 'completed_missed_dest' AND t.dest_name IS NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL))
              )
        ORDER BY
            CASE WHEN p_sort = 'tat_desc' THEN -COALESCE(EXTRACT(EPOCH FROM (
                COALESCE(t.next_dar_entry, t.next_loading_entry, t.dest_exit, t.dest_entry, NOW()) - COALESCE(t.dar_arrival, t.loading_start)
            )), 0) END,
            CASE WHEN p_sort = 'tat_asc' THEN COALESCE(EXTRACT(EPOCH FROM (
                COALESCE(t.next_dar_entry, t.next_loading_entry, t.dest_exit, t.dest_entry, NOW()) - COALESCE(t.dar_arrival, t.loading_start)
            )), 0) END,
            CASE WHEN p_sort = 'newest' THEN -EXTRACT(EPOCH FROM t.loading_entry) END,
            CASE WHEN p_sort = 'oldest' THEN EXTRACT(EPOCH FROM t.loading_entry) END,
            t.loading_entry DESC
        LIMIT p_limit OFFSET p_offset
    ) res;

    RETURN v_result;
END;
$$;

-- =============================================================
-- Fleet KPI Stats for TAT Dashboard (Reading from Materialized View)
-- =============================================================
DROP FUNCTION IF EXISTS get_tat_fleet_stats(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS get_tat_fleet_stats(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION get_tat_fleet_stats(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
    v_trips_departed BIGINT;
    v_trips_completed BIGINT;
    v_avg_waiting NUMERIC;
    v_avg_transit_to_load NUMERIC;
    v_avg_loading NUMERIC;
    v_avg_border NUMERIC;
    v_avg_offloading NUMERIC;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE t.dest_exit IS NOT NULL)
    INTO v_trips_departed, v_trips_completed
    FROM tat_trips_view t
    WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    SELECT COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (t.loading_start - t.dar_arrival))/3600.0
    )::numeric, 1), 0) INTO v_avg_waiting
    FROM tat_trips_view t
    WHERE t.dar_arrival IS NOT NULL
      AND t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    -- 2. Transit to loading terminal is part of Wait in MV simplification. Skipping separate logic.
    v_avg_transit_to_load := 0;

    SELECT COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (t.loading_end - t.loading_start))/3600.0
    )::numeric, 1), 0) INTO v_avg_loading
    FROM tat_trips_view t
    WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    -- 4. Border Tunduma/Kasumbalesa
    SELECT COALESCE(ROUND(
        (
            COALESCE(AVG(EXTRACT(EPOCH FROM (t.border_tunduma_exit - t.border_tunduma_entry))), 0) +
            COALESCE(AVG(EXTRACT(EPOCH FROM (t.border_kasumbalesa_exit - t.border_kasumbalesa_entry))), 0)
        ) / 3600.0
    ::numeric, 1), 0) INTO v_avg_border
    FROM tat_trips_view t
    WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination)
      AND (t.border_tunduma_entry IS NOT NULL OR t.border_kasumbalesa_entry IS NOT NULL);

    -- 5. Offloading Time (Destination Dwell)
    SELECT COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0
    )::numeric, 1), 0) INTO v_avg_offloading
    FROM tat_trips_view t
    WHERE t.dest_entry IS NOT NULL AND t.dest_exit IS NOT NULL
      AND t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
      AND (p_destination IS NULL OR t.dest_name = p_destination);

    v_result := json_build_object(
        'avg_mobilization_hours', v_avg_waiting,       -- using waiting for orders as mobilization metric
        'avg_border_wait_hours', v_avg_border,         
        'avg_unloading_hours', v_avg_offloading,       -- newly tracked
        'trip_completion_rate', CASE WHEN v_trips_departed > 0 THEN ROUND((v_trips_completed::NUMERIC / v_trips_departed) * 100, 1) ELSE 0 END,
        'trips_departed', v_trips_departed,
        'trips_completed', v_trips_completed,
        'total_missed_dest', (SELECT COUNT(*) FROM tat_trips_view t WHERE t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date AND (p_destination IS NULL OR t.dest_name = p_destination) AND t.dest_entry IS NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL))
    );

    RETURN v_result;
END;
$$;

-- =============================================================
-- Summary by Destination for TAT Dashboard (Reading from MV)
-- =============================================================
DROP FUNCTION IF EXISTS get_tat_summary_by_destination(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS get_tat_summary_by_destination(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION get_tat_summary_by_destination(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_agg(row_to_json(res) ORDER BY trip_count DESC) INTO v_result
    FROM (
        SELECT 
            t.dest_name as location,
            COUNT(DISTINCT t.tracker_id) as unique_trackers,
            COUNT(*) as trip_count,
            -- Total TAT = from trip start (dar_arrival or loading_start) to return (next_dar_entry) or dest_exit
            COALESCE(ROUND((AVG(
                EXTRACT(EPOCH FROM (
                    COALESCE(t.next_dar_entry, t.dest_exit) - COALESCE(t.dar_arrival, t.loading_start)
                )) / 86400.0  -- convert seconds to days
            ))::numeric, 1), 0) as avg_tat_days,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.loading_start - t.dar_arrival))/3600.0)::numeric, 1), 0) as avg_waiting_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.loading_end - t.loading_start))/3600.0)::numeric, 1), 0) as avg_loading_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.dest_entry - t.loading_end))/3600.0)::numeric, 1), 0) as avg_transit_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (
                COALESCE(t.border_tunduma_exit, t.border_kasumbalesa_exit) - 
                COALESCE(t.border_tunduma_entry, t.border_kasumbalesa_entry)
            ))/3600.0)::numeric, 1), 0) as avg_border_hrs,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0)::numeric, 1), 0) as avg_offloading_hrs
        FROM tat_trips_view t
        WHERE t.dest_name IS NOT NULL
          AND t.dest_exit IS NOT NULL
          AND t.loading_exit >= p_start_date AND t.loading_entry <= p_end_date
        GROUP BY t.dest_name
    ) res;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- =============================================================
-- BATCH PROCESSING UTILITIES
-- =============================================================

-- 1. Function to process the last 'N' days (useful for your 15-min cron job)
CREATE OR REPLACE FUNCTION refresh_recent_tat()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- Refresh the last 120 days to catch any delayed GPS pings or overlapping ongoing trips
    -- This ensures "ghost" trips from past months are closed when a new loading session occurs.
    PERFORM process_tat_chunk(NOW() - INTERVAL '120 days', NOW());
END;
$$;

-- 2. Function to build historical data month-by-month (prevents timeouts)
-- Usage: SELECT build_historical_tat('2023-01-01', '2026-03-01');
CREATE OR REPLACE FUNCTION build_historical_tat(build_start TIMESTAMPTZ, build_end TIMESTAMPTZ)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    chunk_start TIMESTAMPTZ := build_start;
    chunk_end TIMESTAMPTZ;
BEGIN
    WHILE chunk_start < build_end LOOP
        chunk_end := LEAST(chunk_start + INTERVAL '1 month', build_end);
        RAISE NOTICE 'Processing TAT chunk: % to %', chunk_start, chunk_end;
        PERFORM process_tat_chunk(chunk_start, chunk_end);
        chunk_start := chunk_end;
    END LOOP;
END;
$$;