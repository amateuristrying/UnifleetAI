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
                SELECT COALESCE(JSON_AGG(sub_row ORDER BY sub_row.in_time_dt ASC), '[]'::json)
                FROM (
                    SELECT 
                        final_name as geofence_name, 
                        MIN(in_time_dt) as in_time_dt, 
                        MAX(out_time_dt) as out_time_dt,
                        CASE 
                            WHEN final_name LIKE 'Loading Operations%' THEN 'loading'
                            WHEN final_name IN ('TANGA GF', 'MTWARA GF', 'BEIRA GF', 'MOMBASA GF', 'KURASINI ALL TOGETHER') THEN 'loading'
                            WHEN final_name IN ('Asas Head Office (Ipogoro)', 'LUSAKA DEPOT', 'NDOLA OFFLOADING', 'MZUZU OFFLOADING', 'LILONGWE', 'BLANTYRE', 'BLANTYRE OFFLOADING') THEN 'unloading'
                            WHEN final_name ILIKE '%LPG%' THEN 'unloading'
                            WHEN final_name IN ('Tunduma Border', 'Nakonde Border', 'Kasumbalesa Border', 'Sakania Boundary', 'ASAS Chapwa Yard') THEN 'border'
                            WHEN final_name LIKE '%BORDER%' THEN 'border'
                            ELSE 'transit'
                        END as event_type
                    FROM (
                        SELECT 
                            grouping_base.final_name, 
                            grouping_base.in_time_dt, 
                            grouping_base.out_time_dt,
                            SUM(is_new_gap) OVER (ORDER BY grouping_base.in_time_dt) as sid
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
                                filtered.out_time_dt,
                                CASE WHEN (
                                    filtered.orig_name = LAG(filtered.orig_name) OVER (ORDER BY filtered.in_time_dt) 
                                    AND (filtered.in_time_dt - LAG(filtered.out_time_dt) OVER (ORDER BY filtered.in_time_dt)) <= 
                                        CASE WHEN regexp_replace(UPPER(TRIM(filtered.orig_name)), '\s+', ' ', 'g') LIKE 'LOADING OPERATIONS%' THEN INTERVAL '36 hours' ELSE INTERVAL '12 hours' END
                                ) THEN 0 ELSE 1 END as is_new_gap
                            FROM (
                                SELECT 
                                    gv.geofence_name as orig_name,
                                    gv.in_time_dt,
                                    gv.out_time_dt
                                FROM public.geofence_visits gv
                                WHERE gv.tracker_id = t.tracker_id
                                  AND gv.in_time_dt >= COALESCE(t.dar_arrival, t.loading_start)
                                  AND gv.in_time_dt <= COALESCE(t.next_dar_entry, t.next_loading_entry, NOW())
                            ) filtered
                        ) grouping_base
                    ) numbered
                    GROUP BY final_name, sid
                ) sub_row
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
