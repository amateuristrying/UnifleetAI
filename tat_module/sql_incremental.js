const fs = require('fs');
let sql = `
-- =============================================================
-- ASAS TAT Trip Lifecycle - INCREMENTAL TABLE ARCHITECTURE
-- Built to handle multi-year history without API timeouts
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
    border_mokambo_entry TIMESTAMPTZ,
    border_mokambo_exit TIMESTAMPTZ,
    border_kasumulu_entry TIMESTAMPTZ,
    border_kasumulu_exit TIMESTAMPTZ,
    customs_entry TIMESTAMPTZ,
    customs_exit TIMESTAMPTZ,
    return_border_kasumbalesa_entry TIMESTAMPTZ,
    return_border_kasumbalesa_exit TIMESTAMPTZ,
    return_border_tunduma_entry TIMESTAMPTZ,
    return_border_tunduma_exit TIMESTAMPTZ,
    return_border_kasumulu_entry TIMESTAMPTZ,
    return_border_kasumulu_exit TIMESTAMPTZ,
    return_border_mokambo_entry TIMESTAMPTZ,
    return_border_mokambo_exit TIMESTAMPTZ,
    drc_region_entry TIMESTAMPTZ,
    drc_region_exit TIMESTAMPTZ,
    customer_name TEXT,
    customer_entry TIMESTAMPTZ,
    customer_exit TIMESTAMPTZ,
    loading_start TIMESTAMPTZ,
    loading_end TIMESTAMPTZ,
    UNIQUE(tracker_id, loading_entry)
);

CREATE INDEX IF NOT EXISTS idx_tat_trips_data_dest ON tat_trips_data(dest_name);
CREATE INDEX IF NOT EXISTS idx_tat_trips_data_start ON tat_trips_data(loading_start);
CREATE INDEX IF NOT EXISTS idx_tat_trips_data_exit ON tat_trips_data(loading_exit);

-- Replace the materialize view definition with the incremental processing function
DROP MATERIALIZED VIEW IF EXISTS tat_trips_view CASCADE;
CREATE OR REPLACE VIEW tat_trips_view AS SELECT * FROM tat_trips_data;


-- =============================================================
-- INCREMENTAL BUILDER FUNCTION
-- Call this function to process exactly 1 month of raw data at a time.
-- Automatically manages upserts (inserts new, updates existing)
-- =============================================================
CREATE OR REPLACE FUNCTION process_tat_chunk(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    WITH tmp_classified AS (
        SELECT
            id, tracker_id, tracker_name, geofence_name,
            in_time_dt, out_time_dt,
            CASE
                WHEN geofence_name IN ('TIPER DEPOT', 'Puma Depo Kurasini', 'Oryx Loading Depo (Kigamboni)', 'Oryx Dar Depo', 'Oilcom Dar Depo', 'OILCOM LIMITED TERMINAL DEPOT', 'MERU TERMINAL DEPOT', 'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'GBP DRS DEPOT', 'ORYX FUEL DEPOT', 'WORLD OIL DEPOT', 'Tanga GF', 'Mtwara GF', 'Beira', 'KURASINI ALL TOGETHER') THEN 'L1_LOADING'
                WHEN geofence_name = 'DRC Offloading GEO' THEN 'L1_DRC_REGION'
                WHEN geofence_name IN ('LUSAKA DEPOT', 'Ndola Offloading', 'Mzuzu Offloading', 'Lilongwe') THEN 'L1_OFFLOADING'
                WHEN geofence_name IN ('ISAKA LPG Depot', 'Dodoma LPG Depot', 'ORYX DODOMA LPG DEPOT', 'Mwanza LPG Depot', 'Moshi LPG Depot', 'Iringa LPG Depot', 'Asas Head Office Ipogolo  Yard -Iringa') THEN 'L1_LOCAL_DELIVERY'
                WHEN geofence_name IN ('ASAS DSM Office / Dar W/Shop', 'Asas Kibaha Dsm -Yard', 'Asas Tabata') THEN 'L1_ASAS_BASE'
                WHEN geofence_name IN ('Kimara Fueling Point', 'MLANDIZI WASHING BAY', 'DELTA CAR WASH MSOLWA', 'ASAS Chapwa  Yard', 'Misugusugu Check Point', 'MISUGUSUGU') THEN 'L2_SERVICE'
                WHEN geofence_name IN ('TUNDUMA BORDER TZ SIDE', 'Tanzania Tunduma Border') THEN 'L2_BORDER_TZ'
                WHEN geofence_name IN ('NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') THEN 'L2_BORDER_NAKONDE'
                WHEN geofence_name = 'Tunduma Border 1' THEN 'L2_BORDER_TUNDUMA_ALL'
                WHEN geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border') THEN 'L2_BORDER_ZMB'
                WHEN geofence_name IN ('KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') THEN 'L2_BORDER_DRC'
                WHEN geofence_name = 'Mokambo border' THEN 'L2_BORDER_MOKAMBO'
                WHEN geofence_name = 'KASUMULU BORDER' THEN 'L2_BORDER_KASUMULU'
                WHEN geofence_name IN ('CHIRUNDU BORDER', 'CHIRUNDU BORDER ZIM SIDE', 'CHIRUNDU BORDER ZAMBIA SIDE', 'KABANGA BORDER', 'RUSUMO BORDER', 'MALABA BORDER', 'Horohoro border', 'MUTUKULA BORDER') THEN 'L2_BORDER_OTHER'
                WHEN geofence_name IN ('Kanyaka Customs', 'KANYAKA CUSTOMS', 'Kanyaka customs', 'Whisk DRC') THEN 'L2_CUSTOMS_DRC'
                WHEN geofence_name IN ('MOROGORO', 'IFUNDA', 'Makambako', 'Nyororo', 'NYORORO', 'Tukuyu', 'UYOLE  MIZANI', 'UYOLE MIZANI', 'Uyole', 'Mbeya (Uyole - Mbalizi)', 'Mbeya', 'IGAWA', 'IPOGORO', 'RUAHA MBUYUNI', 'MIKUMI', 'RUVU') THEN 'L2_TZ_CORRIDOR'
                WHEN geofence_name IN ('Kapiri', 'KAPIRI', 'Serenje', 'SERENJE', 'Chimutanda', 'Mpika', 'Matumbo', 'Mkushi', 'MKUSHI', 'Kanona', 'KANONA', 'Kasama', 'KASAMA', 'Isoka', 'ISOKA', 'Sanga Hill', 'SANGA HILL', 'Luwingu', 'LUWINGU') THEN 'L2_ZAMBIA_CORRIDOR'
                WHEN geofence_name IN ('EXPREE OIL DEPOT', 'SEP CONGO', 'Sep Congo', 'United Petroleum Lubumbashi', 'KANATA PETROLEUM DEPOT (CONSTALINA)', 'Kolwezi Offloading', 'LUALABA OIL (KOLWEZI)', 'United Petroleum Kolwezi', 'Frontier') THEN 'L3_DRC_CUSTOMER'
                WHEN geofence_name = 'Kiluvya to Mbezi  Geofence' THEN 'L3_DAR_GATEWAY'
                WHEN geofence_name IN ('Dar Geofence', 'Kiluvya to Mbezi  Geofence', 'Tanga GF', 'Mtwara GF', 'Beira Geofence') THEN 'L3_ORIGIN_REGION'
                WHEN geofence_name = 'LUBUMBAHI' THEN 'L3_LUBUMBASHI'
                WHEN geofence_name = 'CHAPWA' THEN 'L3_CHAPWA'
                ELSE 'L2_CORRIDOR'
            END as geo_level
        FROM public.geofence_visits
        -- Only load visits for the explicitly requested time slice block
        WHERE in_time_dt >= p_start AND in_time_dt < p_end
    ),
    flagged_merged AS (
        SELECT tracker_id, tracker_name, geofence_name, geo_level, in_time_dt, out_time_dt,
            CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session
        FROM tmp_classified
    ),
    sessioned_merged AS (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt) as session_id
        FROM flagged_merged
    ),
    tmp_merged AS (
        SELECT tracker_id, tracker_name, geofence_name, geo_level, MIN(in_time_dt) as in_time_dt, MAX(out_time_dt) as out_time_dt
        FROM sessioned_merged
        GROUP BY tracker_id, tracker_name, geofence_name, geo_level, session_id
    ),
    potential_anchors AS (
        SELECT m1.tracker_id, m1.tracker_name, m1.geofence_name, m1.geo_level, m1.in_time_dt, m1.out_time_dt,
            CASE WHEN m1.geo_level = 'L1_LOADING' THEN 1 ELSE 0 END as is_primary,
            CASE WHEN m1.geo_level IN ('L3_ORIGIN_REGION', 'L1_ASAS_BASE') 
                      AND next_event.geo_level IS NOT NULL
                      AND next_event.geo_level NOT IN ('L1_LOADING', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE')
                 THEN 1 ELSE 0 END as is_fallback
        FROM tmp_merged m1
        LEFT JOIN LATERAL (
            SELECT m2.geo_level
            FROM tmp_merged m2
            WHERE m2.tracker_id = m1.tracker_id
              AND m2.in_time_dt > m1.in_time_dt
              AND (
                  m2.geo_level IN ('L1_LOADING', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE', 'L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY')
                  OR m2.geo_level LIKE 'L2_TZ_CORRIDOR%'
                  OR m2.geo_level LIKE 'L2_ZAMBIA_CORRIDOR%'
                  OR m2.geo_level LIKE 'L2_BORDER%'
              )
            ORDER BY m2.in_time_dt ASC
            LIMIT 1
        ) next_event ON true
        WHERE m1.geo_level IN ('L1_LOADING', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE')
    ),
    loading_visits AS (
        SELECT tracker_id, tracker_name, geofence_name, in_time_dt, out_time_dt,
            CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id ORDER BY in_time_dt)
                 >= in_time_dt - INTERVAL '24 hours' THEN 0 ELSE 1 END as is_new_session
        FROM potential_anchors
        WHERE is_primary = 1 OR is_fallback = 1
    ),
    sessions AS (
        SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as session_id
        FROM loading_visits
    ),
    tmp_loading_sessions AS (
        SELECT
            tracker_id, tracker_name, session_id,
            MIN(in_time_dt) as loading_entry,
            MAX(out_time_dt) as loading_exit,
            (SELECT geofence_name FROM sessions s2 
             WHERE s2.tracker_id = sessions.tracker_id AND s2.session_id = sessions.session_id 
             ORDER BY s2.out_time_dt DESC LIMIT 1) as loading_terminal,
            LEAD(MIN(in_time_dt)) OVER (PARTITION BY tracker_id ORDER BY MIN(in_time_dt)) as next_loading_entry
        FROM sessions
        GROUP BY tracker_id, tracker_name, session_id
    ),
    tmp_trip_bounds AS (
        SELECT
            ls.*,
            (SELECT MAX(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_ORIGIN_REGION' AND m.in_time_dt <= ls.loading_entry AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER') AND m2.in_time_dt > m.in_time_dt AND m2.in_time_dt < ls.loading_entry)) as dar_arrival,
            (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_ORIGIN_REGION' AND m.out_time_dt >= ls.loading_entry AND m.out_time_dt < COALESCE((SELECT MIN(m2.in_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR', 'L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), NOW())) as dar_exit,
            COALESCE((SELECT m.in_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1), (SELECT m.in_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1), (SELECT m.in_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOCAL_DELIVERY' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) ORDER BY m.out_time_dt DESC LIMIT 1)) as dest_entry,
            COALESCE((SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1), (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1), (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOCAL_DELIVERY' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) ORDER BY m.out_time_dt DESC LIMIT 1)) as dest_name,
            COALESCE((SELECT m.out_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1), (SELECT m.out_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1), (SELECT m.out_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOCAL_DELIVERY' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) ORDER BY m.out_time_dt DESC LIMIT 1)) as dest_exit,
            COALESCE((SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_ASAS_BASE' AND m.in_time_dt > (SELECT COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours')) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt > (SELECT COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours')) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_DAR_GATEWAY' AND m.in_time_dt > (SELECT COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours')) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz))) as next_dar_entry
        FROM tmp_loading_sessions ls
    ),
    final_output AS (
        SELECT
            tb.*,
            EXISTS(SELECT 1 FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level IN ('L2_BORDER_ZMB', 'L2_BORDER_DRC', 'L2_BORDER_TZ', 'L2_BORDER_NAKONDE', 'L2_BORDER_TUNDUMA_ALL', 'L2_BORDER_OTHER', 'L2_BORDER_MOKAMBO', 'L2_BORDER_KASUMULU', 'L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as has_corridor_event,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_tunduma_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_tunduma_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumbalesa_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumbalesa_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_mokambo_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_mokambo_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumulu_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumulu_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L2_CUSTOMS_DRC' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as customs_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L2_CUSTOMS_DRC' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as customs_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumbalesa_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumbalesa_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_tunduma_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_tunduma_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumulu_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumulu_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_mokambo_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_mokambo_exit,
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > tb.loading_exit) as drc_region_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > tb.loading_exit) as drc_region_exit,
            (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L3_DRC_CUSTOMER' AND m.in_time_dt > tb.loading_exit ORDER BY m.in_time_dt ASC LIMIT 1) as customer_name, (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L3_DRC_CUSTOMER' AND m.in_time_dt > tb.loading_exit) as customer_entry, (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L3_DRC_CUSTOMER' AND m.in_time_dt > tb.loading_exit) as customer_exit,
            LEAST(tb.loading_entry, COALESCE((SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt >= tb.loading_entry - INTERVAL '2 hours' AND m.in_time_dt <= tb.loading_exit + INTERVAL '2 hours'), tb.loading_entry)) as loading_start,
            GREATEST(tb.loading_exit, COALESCE((SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt >= tb.loading_entry - INTERVAL '2 hours' AND m.in_time_dt <= tb.loading_exit + INTERVAL '2 hours'), tb.loading_exit)) as loading_end
        FROM tmp_trip_bounds tb
    )
    INSERT INTO tat_trips_data (
        tracker_id, tracker_name, session_id, loading_entry, loading_exit, loading_terminal,
        next_loading_entry, dar_arrival, dar_exit, next_dar_entry, dest_entry, dest_exit, dest_name,
        has_corridor_event, border_tunduma_entry, border_tunduma_exit, border_kasumbalesa_entry, border_kasumbalesa_exit,
        border_mokambo_entry, border_mokambo_exit, border_kasumulu_entry, border_kasumulu_exit,
        customs_entry, customs_exit, return_border_kasumbalesa_entry, return_border_kasumbalesa_exit,
        return_border_tunduma_entry, return_border_tunduma_exit, return_border_kasumulu_entry, return_border_kasumulu_exit,
        return_border_mokambo_entry, return_border_mokambo_exit, drc_region_entry, drc_region_exit,
        customer_name, customer_entry, customer_exit, loading_start, loading_end
    )
    SELECT * FROM final_output
    ON CONFLICT (tracker_id, loading_entry) DO UPDATE SET
        loading_exit = EXCLUDED.loading_exit,
        loading_terminal = EXCLUDED.loading_terminal,
        next_loading_entry = EXCLUDED.next_loading_entry,
        dar_arrival = EXCLUDED.dar_arrival,
        dar_exit = EXCLUDED.dar_exit,
        next_dar_entry = EXCLUDED.next_dar_entry,
        dest_entry = EXCLUDED.dest_entry,
        dest_exit = EXCLUDED.dest_exit,
        dest_name = EXCLUDED.dest_name,
        has_corridor_event = EXCLUDED.has_corridor_event,
        border_tunduma_entry = EXCLUDED.border_tunduma_entry,
        border_tunduma_exit = EXCLUDED.border_tunduma_exit,
        border_kasumbalesa_entry = EXCLUDED.border_kasumbalesa_entry,
        border_kasumbalesa_exit = EXCLUDED.border_kasumbalesa_exit,
        loading_start = EXCLUDED.loading_start,
        loading_end = EXCLUDED.loading_end;
END;
$$;
`;

const content = fs.readFileSync('supabase/migrations/tat_optimization_mv_only.sql', 'utf8');
const rpcStartIdx = content.indexOf('-- FAST WRAPPER FOR DASHBOARD DATA');
if (rpcStartIdx > 0) {
    fs.writeFileSync('supabase/migrations/tat_optimization_incremental.sql', sql + content.substring(rpcStartIdx));
}
