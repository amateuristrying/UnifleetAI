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
BEGIN
    -- Counts
    SELECT COUNT(*) INTO v_total_completed FROM tat_trips_view 
    WHERE dest_exit IS NOT NULL AND (next_dar_entry IS NOT NULL OR next_loading_entry IS NOT NULL) AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);
    
    SELECT COUNT(*) INTO v_total_returning FROM tat_trips_view 
    WHERE dest_exit IS NOT NULL AND next_dar_entry IS NULL AND next_loading_entry IS NULL AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);
      
    SELECT COUNT(*) INTO v_total_unfinished FROM tat_trips_view 
    WHERE dest_exit IS NULL AND loading_exit >= p_start_date AND loading_entry <= p_end_date
      AND (p_destination IS NULL OR dest_name = p_destination) AND (p_origin IS NULL OR loading_terminal = p_origin) AND (p_trip_type IS NULL OR CASE WHEN dest_name LIKE '%LPG%' THEN 'lpg_delivery' WHEN has_corridor_event THEN 'long_haul' ELSE 'local_ops' END = p_trip_type) AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id);

    -- Results
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
            t.border_chembe_entry, t.border_chembe_exit,
            t.border_kasumulu_entry, t.border_kasumulu_exit,

            t.return_border_tunduma_entry, t.return_border_tunduma_exit,
            t.return_border_kasumbalesa_entry, t.return_border_kasumbalesa_exit,
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
            CASE WHEN t.border_mokambo_entry IS NOT NULL AND t.border_mokambo_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_mokambo_exit - t.border_mokambo_entry))/3600.0 ELSE NULL END as border_mokambo_hrs,
            CASE WHEN t.border_chembe_entry IS NOT NULL AND t.border_chembe_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_chembe_exit - t.border_chembe_entry))/3600.0 ELSE NULL END as border_chembe_hrs,
            CASE WHEN t.border_kasumulu_entry IS NOT NULL AND t.border_kasumulu_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.border_kasumulu_exit - t.border_kasumulu_entry))/3600.0 ELSE NULL END as border_kasumulu_hrs,

            CASE WHEN t.return_border_tunduma_entry IS NOT NULL AND t.return_border_tunduma_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_tunduma_exit - t.return_border_tunduma_entry))/3600.0 ELSE NULL END as return_border_tunduma_hrs,
            CASE WHEN t.return_border_kasumbalesa_entry IS NOT NULL AND t.return_border_kasumbalesa_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_kasumbalesa_exit - t.return_border_kasumbalesa_entry))/3600.0 ELSE NULL END as return_border_kasumbalesa_hrs,
            CASE WHEN t.return_border_mokambo_entry IS NOT NULL AND t.return_border_mokambo_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_mokambo_exit - t.return_border_mokambo_entry))/3600.0 ELSE NULL END as return_border_mokambo_hrs,
            CASE WHEN t.return_border_chembe_entry IS NOT NULL AND t.return_border_chembe_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_chembe_exit - t.return_border_chembe_entry))/3600.0 ELSE NULL END as return_border_chembe_hrs,
            CASE WHEN t.return_border_kasumulu_entry IS NOT NULL AND t.return_border_kasumulu_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.return_border_kasumulu_exit - t.return_border_kasumulu_entry))/3600.0 ELSE NULL END as return_border_kasumulu_hrs,

            CASE WHEN t.customs_entry IS NOT NULL AND t.customs_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.customs_exit - t.customs_entry))/3600.0 ELSE NULL END as customs_hrs,
            CASE WHEN t.drc_region_entry IS NOT NULL AND t.drc_region_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.drc_region_exit - t.drc_region_entry))/3600.0 ELSE NULL END as drc_region_hrs,
            CASE WHEN t.dest_entry IS NOT NULL AND t.dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_exit - t.dest_entry))/3600.0 ELSE NULL END as dest_dwell_hrs,
            CASE WHEN t.customer_entry IS NOT NULL AND t.customer_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.customer_exit - t.customer_entry))/3600.0 ELSE NULL END as customer_dwell_hrs,
            CASE WHEN t.dest_exit IS NOT NULL AND t.next_dar_entry IS NOT NULL THEN EXTRACT(EPOCH FROM (t.next_dar_entry - t.dest_exit))/3600.0 ELSE NULL END as return_hrs,

            CASE WHEN t.next_dar_entry IS NOT NULL AND t.dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.next_dar_entry - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
                WHEN t.dest_exit IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_exit - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
                WHEN t.dest_entry IS NOT NULL THEN EXTRACT(EPOCH FROM (t.dest_entry - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
                ELSE EXTRACT(EPOCH FROM (NOW() - COALESCE(t.dar_arrival, t.loading_start)))/3600.0
            END as total_tat_hrs,

            CASE
                WHEN t.dest_exit IS NOT NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL) THEN 'completed'
                WHEN t.dest_exit IS NOT NULL THEN 'returning'
                WHEN t.dest_entry IS NOT NULL THEN 'at_destination'
                WHEN t.dar_exit IS NOT NULL THEN 'in_transit'
                WHEN t.loading_end IS NOT NULL AND t.loading_end > t.loading_entry THEN 'pre_transit'
                ELSE 'loading'
            END as trip_status,
            (t.dest_exit IS NOT NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL)) as is_completed,
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
                                'Tanga GF', 'Mtwara GF', 'Beira', 'Beira GF',
                                'KURASINI ALL TOGETHER', 'Mombasa GF', 'GBP TANGA TERMINAL', 'Oryx FUEL DEPOT',
                                'Camel Oil', 'Petrobeira', 'Petroda', 'Lake Oil',
                                'Inpetro', 'Xstorage', 'Mount Meru',
                                'Oryx Mtwara Depot', 'Oilcom Mtwara Depot',
                                'VIVO Energy Mombasa Terminal'
                            ) THEN 'loading'
                            WHEN g.geofence_name IN (
                                'Asas Head Office (Ipogoro)',
                                'LUSAKA DEPOT', 'Ndola Offloading', 'Mzuzu Offloading', 'Lilongwe',
                                'EXPREE OIL DEPOT', 'SEP CONGO', 'Sep Congo',
                                'United Petroleum Lubumbashi',
                                'KANATA PETROLEUM DEPOT (CONSTALINA)',
                                'Kolwezi Offloading', 'LUALABA OIL (KOLWEZI)',
                                'United Petroleum Kolwezi', 'Frontier',
                                'Blantyre', 'Blantyre Offloading', 'Lumwana Mines'
                            ) OR g.geofence_name ILIKE '%LPG%' THEN 'unloading'
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
                                                    'ASAS HEAD OFFICE IPOGOLO  YARD -IRINGA'
                                                ) THEN 'specific'
                                                WHEN regexp_replace(UPPER(TRIM(gv.geofence_name)), '\s+', ' ', 'g') IN ('DAR GEOFENCE', 'KILUVYA TO MBEZI GEOFENCE', 'KILUVYA TO MBEZI  GEOFENCE', 'TANGA GF', 'MTWARA GF', 'BEIRA GEOFENCE', 'BEIRA GF', 'MOMBASA GF', 'KURASINI ALL TOGETHER') THEN 'broad'
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
                                                           'ASAS HEAD OFFICE IPOGOLO  YARD -IRINGA'
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
               OR (p_status = 'completed' AND t.dest_exit IS NOT NULL AND (t.next_dar_entry IS NOT NULL OR t.next_loading_entry IS NOT NULL))
               OR (p_status = 'returning' AND t.dest_exit IS NOT NULL AND t.next_dar_entry IS NULL AND t.next_loading_entry IS NULL)
               OR (p_status = 'unfinished' AND t.dest_exit IS NULL)
               OR (p_status = 'completed_or_returning' AND t.dest_exit IS NOT NULL)
              )
        ORDER BY
            CASE WHEN p_sort = 'tat_desc' THEN -COALESCE(EXTRACT(EPOCH FROM (
                COALESCE(t.next_dar_entry, t.next_loading_entry, NOW()) - COALESCE(t.dar_arrival, t.loading_start)
            )), 0) END,
            CASE WHEN p_sort = 'tat_asc' THEN COALESCE(EXTRACT(EPOCH FROM (
                COALESCE(t.next_dar_entry, t.next_loading_entry, NOW()) - COALESCE(t.dar_arrival, t.loading_start)
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
        'trips_completed', v_trips_completed
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
