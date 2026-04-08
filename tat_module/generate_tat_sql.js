const fs = require('fs');

const sql = `
-- =============================================================
-- ASAS Trip Lifecycle & TAT State Machine v3 - MATERIALIZED VIEW
-- =============================================================

-- 1. MATERIALIZED VIEW FOR ALL TRIPS
DROP MATERIALIZED VIEW IF EXISTS tat_trips_view CASCADE;

CREATE MATERIALIZED VIEW tat_trips_view AS
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
),
flagged_merged AS (
    SELECT *,
        CASE WHEN LAG(out_time_dt) OVER (
            PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt
        ) >= in_time_dt - INTERVAL '2 hours' THEN 0 ELSE 1 END as is_new_session
    FROM tmp_classified
),
sessioned_merged AS (
    SELECT *,
        SUM(is_new_session) OVER (
            PARTITION BY tracker_id, geofence_name ORDER BY in_time_dt
        ) as session_id
    FROM flagged_merged
),
tmp_merged AS (
    SELECT
        tracker_id, tracker_name, geofence_name, geo_level,
        MIN(in_time_dt) as in_time_dt,
        MAX(out_time_dt) as out_time_dt
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
        (SELECT MAX(m.in_time_dt) FROM tmp_merged m
         WHERE m.tracker_id = ls.tracker_id
         AND m.geo_level = 'L3_ORIGIN_REGION'
         AND m.in_time_dt <= ls.loading_entry
         AND NOT EXISTS (
            SELECT 1 FROM tmp_merged m2
            WHERE m2.tracker_id = ls.tracker_id
            AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER')
            AND m2.in_time_dt > m.in_time_dt
            AND m2.in_time_dt < ls.loading_entry
         )
        ) as dar_arrival,
        (SELECT MAX(m.out_time_dt) FROM tmp_merged m
         WHERE m.tracker_id = ls.tracker_id
         AND m.geo_level = 'L3_ORIGIN_REGION'
         AND m.out_time_dt >= ls.loading_entry
         AND m.out_time_dt < COALESCE(
             (SELECT MIN(m2.in_time_dt) FROM tmp_merged m2
              WHERE m2.tracker_id = ls.tracker_id
              AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR', 'L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER'))
              AND m2.in_time_dt > ls.loading_exit
              AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)),
             NOW()
         )
        ) as dar_exit,
        COALESCE(
            (SELECT m.in_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1),
            (SELECT m.in_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1),
            (SELECT m.in_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOCAL_DELIVERY' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) ORDER BY m.out_time_dt DESC LIMIT 1)
        ) as dest_entry,
        COALESCE(
            (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1),
            (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1),
            (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOCAL_DELIVERY' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) ORDER BY m.out_time_dt DESC LIMIT 1)
        ) as dest_name,
        COALESCE(
            (SELECT m.out_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1),
            (SELECT m.out_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.out_time_dt DESC LIMIT 1),
            (SELECT m.out_time_dt FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOCAL_DELIVERY' AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND (m2.geo_level LIKE 'L2_BORDER%' OR m2.geo_level IN ('L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR')) AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) ORDER BY m.out_time_dt DESC LIMIT 1)
        ) as dest_exit,
        COALESCE(
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_ASAS_BASE' AND m.in_time_dt > (SELECT COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours')) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)),
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt > (SELECT COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours')) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)),
            (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_DAR_GATEWAY' AND m.in_time_dt > (SELECT COALESCE((SELECT MAX(m2.out_time_dt) FROM tmp_merged m2 WHERE m2.tracker_id = ls.tracker_id AND m2.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L3_DRC_CUSTOMER', 'L1_LOCAL_DELIVERY') AND m2.in_time_dt > ls.loading_exit AND m2.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)), ls.loading_exit + INTERVAL '48 hours')) AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz))
        ) as next_dar_entry
    FROM tmp_loading_sessions ls
)
SELECT
    tb.*,
    LEAST(tb.loading_entry, COALESCE((SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt >= tb.loading_entry - INTERVAL '2 hours' AND m.in_time_dt <= tb.loading_exit + INTERVAL '2 hours'), tb.loading_entry)) as loading_start,
    GREATEST(tb.loading_exit, COALESCE((SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_LOADING' AND m.in_time_dt >= tb.loading_entry - INTERVAL '2 hours' AND m.in_time_dt <= tb.loading_exit + INTERVAL '2 hours'), tb.loading_exit)) as loading_end,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_tunduma_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_tunduma_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumbalesa_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumbalesa_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_mokambo_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_mokambo_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumulu_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as border_kasumulu_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L2_CUSTOMS_DRC' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as customs_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L2_CUSTOMS_DRC' AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, NOW())) as customs_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumbalesa_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumbalesa_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_tunduma_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_tunduma_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumulu_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'KASUMULU BORDER' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_kasumulu_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_mokambo_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name = 'Mokambo border' AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, NOW())) as return_border_mokambo_exit,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > tb.loading_exit) as drc_region_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L1_DRC_REGION' AND m.in_time_dt > tb.loading_exit) as drc_region_exit,
    (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L3_DRC_CUSTOMER' AND m.in_time_dt > tb.loading_exit ORDER BY m.in_time_dt ASC LIMIT 1) as customer_name,
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L3_DRC_CUSTOMER' AND m.in_time_dt > tb.loading_exit) as customer_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level = 'L3_DRC_CUSTOMER' AND m.in_time_dt > tb.loading_exit) as customer_exit,
    EXISTS(SELECT 1 FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level IN ('L2_BORDER_ZMB', 'L2_BORDER_DRC', 'L2_BORDER_TZ', 'L2_BORDER_NAKONDE', 'L2_BORDER_TUNDUMA_ALL', 'L2_BORDER_OTHER', 'L2_BORDER_MOKAMBO', 'L2_BORDER_KASUMULU', 'L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR') AND m.in_time_dt > tb.loading_exit) as has_corridor_event
FROM tmp_trip_bounds tb;

-- Unique index for concurrent refreshes
CREATE UNIQUE INDEX IF NOT EXISTS tat_trips_view_idx ON tat_trips_view(tracker_id, loading_start);
CREATE INDEX IF NOT EXISTS tat_trips_view_loading_entry_idx ON tat_trips_view(loading_entry);
CREATE INDEX IF NOT EXISTS tat_trips_view_dest_name_idx ON tat_trips_view(dest_name);


-- 2. REFRESH HELPER FUNCTION
CREATE OR REPLACE FUNCTION refresh_tat_view()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY tat_trips_view;
END;
$$;


-- 3. UPDATED function: get_tat_trip_details
DROP FUNCTION IF EXISTS get_tat_trip_details(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_tat_trip_details(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION get_tat_trip_details(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_trip_type TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_destination TEXT DEFAULT NULL,
    p_tracker_id INTEGER DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
    v_result JSON;
    v_total_completed INTEGER;
    v_total_returning INTEGER;
    v_total_unfinished INTEGER;
BEGIN
    -- Counts
    SELECT COUNT(*) INTO v_total_completed
    FROM tat_trips_view WHERE dest_exit IS NOT NULL AND next_dar_entry IS NOT NULL
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND (p_destination IS NULL OR dest_name = p_destination)
      AND (p_trip_type IS NULL OR CASE WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type)
      AND loading_exit >= p_start_date AND loading_entry <= p_end_date;

    SELECT COUNT(*) INTO v_total_returning
    FROM tat_trips_view WHERE dest_exit IS NOT NULL AND next_dar_entry IS NULL
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND (p_destination IS NULL OR dest_name = p_destination)
      AND (p_trip_type IS NULL OR CASE WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type)
      AND loading_exit >= p_start_date AND loading_entry <= p_end_date;

    SELECT COUNT(*) INTO v_total_unfinished
    FROM tat_trips_view WHERE dest_exit IS NULL
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND (p_destination IS NULL OR dest_name = p_destination)
      AND (p_trip_type IS NULL OR CASE WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type)
      AND loading_exit >= p_start_date AND loading_entry <= p_end_date;

    CREATE TEMP TABLE tmp_page ON COMMIT DROP AS
    SELECT * FROM tat_trips_view
    WHERE (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND (p_destination IS NULL OR dest_name = p_destination)
      AND (p_trip_type IS NULL OR CASE WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type)
      AND (p_status IS NULL
           OR (p_status = 'completed' AND dest_exit IS NOT NULL AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL))
           OR (p_status = 'returning' AND dest_exit IS NOT NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL)
           OR (p_status = 'unfinished' AND dest_exit IS NULL)
           OR (p_status = 'completed_or_returning' AND dest_exit IS NOT NULL)
          )
      AND loading_exit >= p_start_date AND loading_entry <= p_end_date
    ORDER BY loading_entry DESC
    LIMIT p_limit OFFSET p_offset;

    -- Return JSON
    SELECT json_build_object(
        'total_completed', v_total_completed,
        'total_returning', v_total_returning,
        'total_unfinished', v_total_unfinished,
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
            t.border_mokambo_entry, t.border_mokambo_exit,
            t.border_kasumulu_entry, t.border_kasumulu_exit,
            t.return_border_tunduma_entry, t.return_border_tunduma_exit,
            t.return_border_kasumbalesa_entry, t.return_border_kasumbalesa_exit,
            t.return_border_mokambo_entry, t.return_border_mokambo_exit,
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
            CASE WHEN t.border_mokambo_entry IS NOT NULL AND t.border_mokambo_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_mokambo_exit - t.border_mokambo_entry))/3600.0 ELSE NULL END as border_mokambo_hrs,
            CASE WHEN t.border_kasumulu_entry IS NOT NULL AND t.border_kasumulu_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_kasumulu_exit - t.border_kasumulu_entry))/3600.0 ELSE NULL END as border_kasumulu_hrs,
            
            CASE WHEN t.return_border_tunduma_entry IS NOT NULL AND t.return_border_tunduma_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_tunduma_exit - t.return_border_tunduma_entry))/3600.0 ELSE NULL END as return_border_tunduma_hrs,
            CASE WHEN t.return_border_kasumbalesa_entry IS NOT NULL AND t.return_border_kasumbalesa_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_kasumbalesa_exit - t.return_border_kasumbalesa_entry))/3600.0 ELSE NULL END as return_border_kasumbalesa_hrs,
            CASE WHEN t.return_border_mokambo_entry IS NOT NULL AND t.return_border_mokambo_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_mokambo_exit - t.return_border_mokambo_entry))/3600.0 ELSE NULL END as return_border_mokambo_hrs,
            CASE WHEN t.return_border_kasumulu_entry IS NOT NULL AND t.return_border_kasumulu_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_kasumulu_exit - t.return_border_kasumulu_entry))/3600.0 ELSE NULL END as return_border_kasumulu_hrs,
            
            CASE WHEN t.customs_entry IS NOT NULL AND t.customs_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.customs_exit - t.customs_entry))/3600.0 ELSE NULL END as customs_hrs,
            CASE WHEN t.dest_entry IS NOT NULL AND t.dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0 ELSE NULL END as dest_dwell_hrs,
            CASE WHEN t.customer_entry IS NOT NULL AND t.customer_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.customer_exit - t.customer_entry))/3600.0 ELSE NULL END as customer_dwell_hrs,
            
            -- Keep empty array for chains backward compat, we don't calculate full chain here anymore due to view limitations
            -- we can just pass an empty JSON array for geofences
            '[]'::json as visit_chain

        FROM tmp_page t
    ) res;

    RETURN v_result;
END;
$$;


-- 4. UPDATED function: get_tat_fleet_stats
DROP FUNCTION IF EXISTS get_tat_fleet_stats(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS get_tat_fleet_stats(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION get_tat_fleet_stats(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql AS $$
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
    SELECT COUNT(*) INTO v_trips_departed
    FROM tat_trips_view
    WHERE loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination);

    SELECT COUNT(*) INTO v_trips_completed
    FROM tat_trips_view
    WHERE loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND dest_exit IS NOT NULL
      AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL)
      AND (p_destination IS NULL OR dest_name = p_destination);

    SELECT 
        ROUND(AVG(EXTRACT(EPOCH FROM (loading_start - dar_arrival))/3600.0)::numeric, 1),
        ROUND(AVG(EXTRACT(EPOCH FROM (dar_exit - loading_end))/3600.0)::numeric, 1),
        ROUND(AVG(EXTRACT(EPOCH FROM (loading_end - loading_start))/3600.0)::numeric, 1),
        ROUND(AVG(EXTRACT(EPOCH FROM (dest_exit - dest_entry))/3600.0)::numeric, 1)
    INTO v_avg_waiting, v_avg_transit_to_load, v_avg_loading, v_avg_offloading
    FROM tat_trips_view
    WHERE loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination);

    -- border duration averaging
    SELECT ROUND(AVG(val)::numeric, 1) INTO v_avg_border
    FROM (
        SELECT EXTRACT(EPOCH FROM (COALESCE(border_tunduma_exit, border_kasumbalesa_exit, border_mokambo_exit, border_kasumulu_exit) - 
                                   COALESCE(border_tunduma_entry, border_kasumbalesa_entry, border_mokambo_entry, border_kasumulu_entry)))/3600.0 as val
        FROM tat_trips_view
        WHERE loading_exit >= p_start_date AND loading_entry <= p_end_date
          AND (p_destination IS NULL OR dest_name = p_destination)
          AND (border_tunduma_entry IS NOT NULL OR border_kasumbalesa_entry IS NOT NULL OR border_mokambo_entry IS NOT NULL OR border_kasumulu_entry IS NOT NULL)
    ) sq;

    SELECT json_build_object(
        'avg_waiting_hrs', COALESCE(v_avg_waiting, 0),
        'avg_transit_to_load_hrs', COALESCE(v_avg_transit_to_load, 0),
        'avg_loading_hrs', COALESCE(v_avg_loading, 0),
        'avg_border_hrs', COALESCE(v_avg_border, 0),
        'avg_offloading_hrs', COALESCE(v_avg_offloading, 0),
        'trip_completion_rate', CASE WHEN v_trips_departed > 0 THEN ROUND((v_trips_completed::numeric / v_trips_departed) * 100, 1) ELSE 0 END,
        'trips_departed', COALESCE(v_trips_departed, 0),
        'trips_completed', COALESCE(v_trips_completed, 0)
    ) INTO v_result;

    RETURN v_result;
END;
$$;


-- 5. UPDATED function: get_tat_summary_by_destination
DROP FUNCTION IF EXISTS get_tat_summary_by_destination(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE OR REPLACE FUNCTION get_tat_summary_by_destination(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT COALESCE(json_agg(row_to_json(dest_stats)), '[]'::json) INTO v_result
    FROM (
        SELECT 
            COALESCE(dest_name, 'Unknown Corridor') as destination,
            COUNT(*) as total_trips,
            ROUND(AVG(EXTRACT(EPOCH FROM (dest_entry - loading_end))/3600.0)::numeric, 1) as avg_transit_hrs,
            ROUND(AVG(EXTRACT(EPOCH FROM (dest_exit - dest_entry))/3600.0)::numeric, 1) as avg_offloading_hrs,
            COUNT(*) FILTER (WHERE dest_exit IS NOT NULL AND next_dar_entry IS NOT NULL) as completed_trips,
            CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE dest_exit IS NOT NULL AND next_dar_entry IS NOT NULL)::numeric / COUNT(*) * 100, 1) ELSE 0 END as completion_rate
        FROM tat_trips_view
        WHERE loading_exit >= p_start_date AND loading_entry <= p_end_date
          AND (p_destination IS NULL OR dest_name = p_destination)
          AND dest_name IS NOT NULL
        GROUP BY dest_name
        ORDER BY total_trips DESC
    ) dest_stats;
    
    RETURN v_result;
END;
$$;

`;
fs.writeFileSync('supabase/migrations/tat_optimization.sql', sql);
