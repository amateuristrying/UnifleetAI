const fs = require('fs');

const sql = `
-- =============================================================
-- ASAS Trip Lifecycle & TAT State Machine v3 - MATERIALIZED VIEW
-- OPTIMIZED FOR LARGE DATASETS
-- =============================================================

DROP MATERIALIZED VIEW IF EXISTS tat_trips_view CASCADE;

CREATE MATERIALIZED VIEW tat_trips_view AS
WITH tmp_classified AS (
    SELECT
        tracker_id, tracker_name, geofence_name,
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
    -- Only load last 6 months to prevent timeouts on the initial build
    WHERE in_time_dt >= NOW() - INTERVAL '6 months'
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
ordered_visits AS (
    SELECT *,
           LEAD(geo_level) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as next_level,
           LEAD(in_time_dt) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as next_time
    FROM tmp_merged
),
potential_anchors AS (
    SELECT tracker_id, tracker_name, geofence_name, geo_level, in_time_dt, out_time_dt,
        CASE WHEN geo_level = 'L1_LOADING' THEN 1 ELSE 0 END as is_primary,
        CASE WHEN geo_level IN ('L3_ORIGIN_REGION', 'L1_ASAS_BASE') 
                  AND next_level IS NOT NULL
                  AND next_level NOT IN ('L1_LOADING', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE')
             THEN 1 ELSE 0 END as is_fallback
    FROM ordered_visits
    WHERE geo_level IN ('L1_LOADING', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE')
),
loading_visits AS (
    SELECT *,
        CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) >= in_time_dt - INTERVAL '24 hours' THEN 0 ELSE 1 END as is_new_session
    FROM potential_anchors
    WHERE is_primary = 1 OR is_fallback = 1
),
sessions AS (
    SELECT *, SUM(is_new_session) OVER (PARTITION BY tracker_id ORDER BY in_time_dt) as session_id
    FROM loading_visits
),
tmp_loading_sessions AS (
    SELECT tracker_id, tracker_name, session_id,
        MIN(in_time_dt) as loading_entry, MAX(out_time_dt) as loading_exit,
        MAX(geofence_name) as loading_terminal,
        LEAD(MIN(in_time_dt)) OVER (PARTITION BY tracker_id ORDER BY MIN(in_time_dt)) as next_loading_entry
    FROM sessions
    GROUP BY tracker_id, tracker_name, session_id
),
trip_bounds AS (
    SELECT
        ls.*,
        ls.loading_entry as loading_start,
        ls.loading_exit as loading_end,
        -- Dar Arrival (last L3_ORIGIN_REGION before loading)
        (SELECT MAX(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_ORIGIN_REGION' AND m.in_time_dt <= ls.loading_entry) as dar_arrival,
        -- Dar Exit (last L3_ORIGIN_REGION after loading)
        (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level = 'L3_ORIGIN_REGION' AND m.out_time_dt >= ls.loading_entry AND m.out_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as dar_exit,
        -- Next Origin Entry (for returning status)
        (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_LOADING', 'L3_ORIGIN_REGION', 'L1_ASAS_BASE') AND m.in_time_dt > ls.loading_exit + INTERVAL '48 hours' AND m.in_time_dt <= COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as next_dar_entry,
        -- Destination
        (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L1_LOCAL_DELIVERY', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as dest_entry,
        (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L1_LOCAL_DELIVERY', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz)) as dest_exit,
        (SELECT m.geofence_name FROM tmp_merged m WHERE m.tracker_id = ls.tracker_id AND m.geo_level IN ('L1_OFFLOADING', 'L1_DRC_REGION', 'L1_LOCAL_DELIVERY', 'L3_DRC_CUSTOMER') AND m.in_time_dt > ls.loading_exit AND m.in_time_dt < COALESCE(ls.next_loading_entry, 'infinity'::timestamptz) ORDER BY m.in_time_dt ASC LIMIT 1) as dest_name
    FROM tmp_loading_sessions ls
)
SELECT
    tb.*,
    -- Simple corridor check
    EXISTS(SELECT 1 FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geo_level IN ('L2_BORDER_ZMB', 'L2_BORDER_DRC', 'L2_BORDER_TZ', 'L2_BORDER_NAKONDE', 'L2_BORDER_TUNDUMA_ALL', 'L2_BORDER_OTHER', 'L2_BORDER_MOKAMBO', 'L2_BORDER_KASUMULU', 'L2_ZAMBIA_CORRIDOR', 'L2_TZ_CORRIDOR') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as has_corridor_event,
    
    -- Fast Border Lookups
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as border_tunduma_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as border_tunduma_exit,
    
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as border_kasumbalesa_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.loading_exit AND m.in_time_dt < COALESCE(tb.dest_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as border_kasumbalesa_exit,
    
    NULL::timestamptz as border_mokambo_entry, NULL::timestamptz as border_mokambo_exit,
    NULL::timestamptz as border_kasumulu_entry, NULL::timestamptz as border_kasumulu_exit,
    NULL::timestamptz as customs_entry, NULL::timestamptz as customs_exit,
    
    -- Fast Return Border Lookups
    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as return_border_tunduma_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('Tanzania Tunduma Border', 'TUNDUMA BORDER TZ SIDE', 'Tunduma Border 1', 'NAKONDE BORDER ZMB SIDE', 'Zambia Nakonde Border') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as return_border_tunduma_exit,

    (SELECT MIN(m.in_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as return_border_kasumbalesa_entry,
    (SELECT MAX(m.out_time_dt) FROM tmp_merged m WHERE m.tracker_id = tb.tracker_id AND m.geofence_name IN ('KASUMBALESA ZMB SIDE', 'SAKANIA ZMB SIDE', 'Sakania border', 'KASUMBALESA BORDER  DRC SIDE', 'Kasumbalesa Border (DRC)', 'KASUMBALESA', 'SAKANIA DRC') AND m.in_time_dt > tb.dest_exit AND m.in_time_dt < COALESCE(tb.next_dar_entry, tb.next_loading_entry, 'infinity'::timestamptz)) as return_border_kasumbalesa_exit,
    
    NULL::timestamptz as return_border_mokambo_entry, NULL::timestamptz as return_border_mokambo_exit,
    NULL::timestamptz as return_border_kasumulu_entry, NULL::timestamptz as return_border_kasumulu_exit,
    
    NULL::timestamptz as drc_region_entry, NULL::timestamptz as drc_region_exit,
    NULL::text as customer_name, NULL::timestamptz as customer_entry, NULL::timestamptz as customer_exit
FROM trip_bounds tb;

CREATE UNIQUE INDEX IF NOT EXISTS tat_trips_view_idx ON tat_trips_view(tracker_id, loading_entry);
CREATE INDEX IF NOT EXISTS tat_trips_view_dest_name_idx ON tat_trips_view(dest_name);


CREATE OR REPLACE FUNCTION refresh_tat_view()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW tat_trips_view;
END;
$$;
`;

const content = fs.readFileSync('supabase/migrations/tat_optimization.sql', 'utf8');
const restIndex = content.indexOf('-- 3. UPDATED function: get_tat_trip_details');
if (restIndex > 0) {
    const newContent = sql + content.substring(restIndex);
    fs.writeFileSync('supabase/migrations/tat_optimization.sql', newContent);
    console.log("File greatly optimized for performance!");
}
