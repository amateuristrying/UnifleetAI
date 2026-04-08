-- =============================================================
-- TAT V2 REFACTOR: Phase 6 FIX — Compatibility Read Layer
-- Replaces: tat_v2_refactor_phase_6.sql
-- Dependency: tat_v2_refactor_tables_patch.sql, phase_4_fix.sql
--
-- Changes vs previous phase_6_fix:
--   [BORDER] tat_trips_view_v2 — border columns now pivot from
--            tat_trip_border_facts_v2 (not NULL stubs or first-border fallback)
--   [BORDER] get_tat_trip_details_v2 — reconstructs all 8 named border fields
--            × entry/exit/hrs × outbound/return from child table (48 compat cols)
--   [NEW]    QA views appended: parity, border anomaly, unmapped aliases
-- =============================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW: tat_trips_view_v2  (border columns now live-pivoted from child table)
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS tat_trips_view_v2 CASCADE;
CREATE VIEW tat_trips_view_v2 AS
WITH border_pivot AS (
    SELECT
        trip_key,
        MIN(entry_time) FILTER (WHERE border_code='tunduma'     AND leg_direction='outbound') AS border_tunduma_entry,
        MAX(exit_time)  FILTER (WHERE border_code='tunduma'     AND leg_direction='outbound') AS border_tunduma_exit,
        MIN(entry_time) FILTER (WHERE border_code='nakonde'     AND leg_direction='outbound') AS border_nakonde_entry,
        MAX(exit_time)  FILTER (WHERE border_code='nakonde'     AND leg_direction='outbound') AS border_nakonde_exit,
        MIN(entry_time) FILTER (WHERE border_code='kasumbalesa' AND leg_direction='outbound') AS border_kasumbalesa_entry,
        MAX(exit_time)  FILTER (WHERE border_code='kasumbalesa' AND leg_direction='outbound') AS border_kasumbalesa_exit,
        MIN(entry_time) FILTER (WHERE border_code='sakania'     AND leg_direction='outbound') AS border_sakania_entry,
        MAX(exit_time)  FILTER (WHERE border_code='sakania'     AND leg_direction='outbound') AS border_sakania_exit,
        MIN(entry_time) FILTER (WHERE border_code='mokambo'     AND leg_direction='outbound') AS border_mokambo_entry,
        MAX(exit_time)  FILTER (WHERE border_code='mokambo'     AND leg_direction='outbound') AS border_mokambo_exit,
        MIN(entry_time) FILTER (WHERE border_code='chembe'      AND leg_direction='outbound') AS border_chembe_entry,
        MAX(exit_time)  FILTER (WHERE border_code='chembe'      AND leg_direction='outbound') AS border_chembe_exit,
        MIN(entry_time) FILTER (WHERE border_code='kasumulu'    AND leg_direction='outbound') AS border_kasumulu_entry,
        MAX(exit_time)  FILTER (WHERE border_code='kasumulu'    AND leg_direction='outbound') AS border_kasumulu_exit,
        MIN(entry_time) FILTER (WHERE border_code='other'       AND leg_direction='outbound') AS border_other_entry,
        MAX(exit_time)  FILTER (WHERE border_code='other'       AND leg_direction='outbound') AS border_other_exit,
        MIN(entry_time) FILTER (WHERE border_code='tunduma'     AND leg_direction='return')   AS return_border_tunduma_entry,
        MAX(exit_time)  FILTER (WHERE border_code='tunduma'     AND leg_direction='return')   AS return_border_tunduma_exit,
        MIN(entry_time) FILTER (WHERE border_code='nakonde'     AND leg_direction='return')   AS return_border_nakonde_entry,
        MAX(exit_time)  FILTER (WHERE border_code='nakonde'     AND leg_direction='return')   AS return_border_nakonde_exit,
        MIN(entry_time) FILTER (WHERE border_code='kasumbalesa' AND leg_direction='return')   AS return_border_kasumbalesa_entry,
        MAX(exit_time)  FILTER (WHERE border_code='kasumbalesa' AND leg_direction='return')   AS return_border_kasumbalesa_exit,
        MIN(entry_time) FILTER (WHERE border_code='sakania'     AND leg_direction='return')   AS return_border_sakania_entry,
        MAX(exit_time)  FILTER (WHERE border_code='sakania'     AND leg_direction='return')   AS return_border_sakania_exit,
        MIN(entry_time) FILTER (WHERE border_code='mokambo'     AND leg_direction='return')   AS return_border_mokambo_entry,
        MAX(exit_time)  FILTER (WHERE border_code='mokambo'     AND leg_direction='return')   AS return_border_mokambo_exit,
        MIN(entry_time) FILTER (WHERE border_code='chembe'      AND leg_direction='return')   AS return_border_chembe_entry,
        MAX(exit_time)  FILTER (WHERE border_code='chembe'      AND leg_direction='return')   AS return_border_chembe_exit,
        MIN(entry_time) FILTER (WHERE border_code='kasumulu'    AND leg_direction='return')   AS return_border_kasumulu_entry,
        MAX(exit_time)  FILTER (WHERE border_code='kasumulu'    AND leg_direction='return')   AS return_border_kasumulu_exit,
        MIN(entry_time) FILTER (WHERE border_code='other'       AND leg_direction='return')   AS return_border_other_entry,
        MAX(exit_time)  FILTER (WHERE border_code='other'       AND leg_direction='return')   AS return_border_other_exit
    FROM tat_trip_border_facts_v2
    GROUP BY trip_key
),
next_origin_arrival AS (
    SELECT
        trip_key,
        LEAD(dar_arrival) OVER (
            PARTITION BY tracker_id
            ORDER BY loading_start, trip_key
        ) AS next_dar_entry
    FROM tat_trip_facts_v2
)
SELECT
    f.trip_key, f.tracker_id, f.tracker_name,
    f.dar_arrival,
    f.dar_arrival AS origin_arrival,
    f.loading_start, f.loading_end, f.loading_terminal,
    f.loading_start AS loading_entry, f.loading_end AS loading_exit,
    f.next_loading_entry,
    f.origin_exit   AS dar_exit,
    f.origin_exit   AS origin_exit,
    noa.next_dar_entry AS next_dar_entry,
    f.dest_entry, f.dest_exit, f.destination_name AS dest_name,
    f.customer_name, f.customer_entry, f.customer_exit,
    f.customs_entry, f.customs_exit,
    f.drc_region_entry, f.drc_region_exit,
    f.has_corridor_event, f.has_border_event, f.has_customs_event,
    f.waiting_for_orders_hrs, f.loading_phase_hrs, f.post_loading_delay_hrs,
    f.waiting_for_orders_hrs AS origin_waiting_hrs,
    f.transit_hrs, f.border_total_hrs, f.customs_hrs,
    f.destination_dwell_hrs, f.customer_dwell_hrs, f.return_hrs, f.total_tat_hrs,
    f.status, f.trip_type, f.lifecycle_confidence, f.closure_reason,
    f.missed_destination, f.exception_flags,
    -- Per-border named columns (live from child table)
    bp.border_tunduma_entry,     bp.border_tunduma_exit,
    bp.border_nakonde_entry,     bp.border_nakonde_exit,
    bp.border_kasumbalesa_entry, bp.border_kasumbalesa_exit,
    bp.border_sakania_entry,     bp.border_sakania_exit,
    bp.border_mokambo_entry,     bp.border_mokambo_exit,
    bp.border_chembe_entry,      bp.border_chembe_exit,
    bp.border_kasumulu_entry,    bp.border_kasumulu_exit,
    bp.border_other_entry,       bp.border_other_exit,
    bp.return_border_tunduma_entry,     bp.return_border_tunduma_exit,
    bp.return_border_nakonde_entry,     bp.return_border_nakonde_exit,
    bp.return_border_kasumbalesa_entry, bp.return_border_kasumbalesa_exit,
    bp.return_border_sakania_entry,     bp.return_border_sakania_exit,
    bp.return_border_mokambo_entry,     bp.return_border_mokambo_exit,
    bp.return_border_chembe_entry,      bp.return_border_chembe_exit,
    bp.return_border_kasumulu_entry,    bp.return_border_kasumulu_exit,
    bp.return_border_other_entry,       bp.return_border_other_exit
FROM tat_trip_facts_v2 f
LEFT JOIN border_pivot bp ON bp.trip_key = f.trip_key
LEFT JOIN next_origin_arrival noa ON noa.trip_key = f.trip_key;

--   border_tunduma_entry/exit/hrs
--   border_nakonde_entry/exit/hrs
--   border_kasumbalesa_entry/exit/hrs
--   border_sakania_entry/exit/hrs
--   border_mokambo_entry/exit/hrs
--   border_chembe_entry/exit/hrs
--   border_kasumulu_entry/exit/hrs
--   border_other_entry/exit/hrs
--   return_border_* equivalents for all of the above
-- =============================================================

CREATE OR REPLACE FUNCTION get_tat_trip_details_v2(
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ,
    p_limit       INTEGER  DEFAULT 100,
    p_offset      INTEGER  DEFAULT 0,
    p_trip_type   TEXT     DEFAULT NULL,
    p_status      TEXT     DEFAULT NULL,
    p_search      TEXT     DEFAULT NULL,
    p_sort        TEXT     DEFAULT 'loading_start_desc',
    p_origin      TEXT     DEFAULT NULL,
    p_destination TEXT     DEFAULT NULL,
    p_tracker_id  INTEGER  DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH filtered_trips AS (
        SELECT t.*
        FROM tat_trip_facts_v2 t
        WHERE t.loading_start >= p_start_date
          AND t.loading_start <= p_end_date
          AND (p_trip_type    IS NULL OR t.trip_type        = p_trip_type)
          AND (p_status       IS NULL OR t.status           = p_status)
          AND (p_origin       IS NULL OR t.loading_terminal ILIKE '%' || p_origin      || '%')
          AND (p_destination  IS NULL OR t.destination_name ILIKE '%' || p_destination || '%')
          AND (p_tracker_id   IS NULL OR t.tracker_id       = p_tracker_id)
          AND (
              p_search IS NULL
              OR t.tracker_name     ILIKE '%' || p_search || '%'
              OR t.destination_name ILIKE '%' || p_search || '%'
              OR t.loading_terminal ILIKE '%' || p_search || '%'
              OR t.customer_name    ILIKE '%' || p_search || '%'
          )
    ),
    counts AS (
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed')              AS total_completed,
            COUNT(*) FILTER (WHERE status = 'returning')              AS total_returning,
            COUNT(*) FILTER (WHERE status = 'at_destination')         AS total_at_destination,
            COUNT(*) FILTER (WHERE status = 'in_transit')             AS total_in_transit,
            COUNT(*) FILTER (WHERE status IN (
                'loading','pre_transit','in_transit','at_destination'
            ))                                                         AS total_unfinished,
            COUNT(*) FILTER (WHERE missed_destination = TRUE)         AS total_missed_dest,
            COUNT(*)                                                   AS total_all
        FROM filtered_trips
    ),
    -- Per-trip border pivot from the child table.
    -- One row per trip, with all named border columns.
    border_pivot AS (
        SELECT
            trip_key,
            -- ── Outbound: tunduma ──────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'outbound') AS border_tunduma_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'outbound') AS border_tunduma_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'outbound'), 2) AS border_tunduma_hrs,
            -- ── Outbound: nakonde ──────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'outbound') AS border_nakonde_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'outbound') AS border_nakonde_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'outbound'), 2) AS border_nakonde_hrs,
            -- ── Outbound: kasumbalesa ──────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'outbound') AS border_kasumbalesa_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'outbound') AS border_kasumbalesa_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'outbound'), 2) AS border_kasumbalesa_hrs,
            -- ── Outbound: sakania ──────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'outbound') AS border_sakania_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'outbound') AS border_sakania_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'outbound'), 2) AS border_sakania_hrs,
            -- ── Outbound: mokambo ──────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'outbound') AS border_mokambo_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'outbound') AS border_mokambo_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'outbound'), 2) AS border_mokambo_hrs,
            -- ── Outbound: chembe ──────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'outbound') AS border_chembe_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'outbound') AS border_chembe_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'outbound'), 2) AS border_chembe_hrs,
            -- ── Outbound: kasumulu ─────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'outbound') AS border_kasumulu_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'outbound') AS border_kasumulu_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'outbound'), 2) AS border_kasumulu_hrs,
            -- ── Outbound: other ────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'other'       AND leg_direction = 'outbound') AS border_other_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'other'       AND leg_direction = 'outbound') AS border_other_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'other'       AND leg_direction = 'outbound'), 2) AS border_other_hrs,

            -- ── Return: tunduma ────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'return') AS return_border_tunduma_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'return') AS return_border_tunduma_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'tunduma'     AND leg_direction = 'return'), 2) AS return_border_tunduma_hrs,
            -- ── Return: nakonde ────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'return') AS return_border_nakonde_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'return') AS return_border_nakonde_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'nakonde'     AND leg_direction = 'return'), 2) AS return_border_nakonde_hrs,
            -- ── Return: kasumbalesa ────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'return') AS return_border_kasumbalesa_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'return') AS return_border_kasumbalesa_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumbalesa' AND leg_direction = 'return'), 2) AS return_border_kasumbalesa_hrs,
            -- ── Return: sakania ────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'return') AS return_border_sakania_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'return') AS return_border_sakania_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'sakania'     AND leg_direction = 'return'), 2) AS return_border_sakania_hrs,
            -- ── Return: mokambo ────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'return') AS return_border_mokambo_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'return') AS return_border_mokambo_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'mokambo'     AND leg_direction = 'return'), 2) AS return_border_mokambo_hrs,
            -- ── Return: chembe ─────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'return') AS return_border_chembe_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'return') AS return_border_chembe_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'chembe'      AND leg_direction = 'return'), 2) AS return_border_chembe_hrs,
            -- ── Return: kasumulu ───────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'return') AS return_border_kasumulu_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'return') AS return_border_kasumulu_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'kasumulu'    AND leg_direction = 'return'), 2) AS return_border_kasumulu_hrs,
            -- ── Return: other ──────────────────────────────────────────────
            MIN(entry_time) FILTER (WHERE border_code = 'other'       AND leg_direction = 'return') AS return_border_other_entry,
            MAX(exit_time)  FILTER (WHERE border_code = 'other'       AND leg_direction = 'return') AS return_border_other_exit,
            ROUND(SUM(dwell_hrs) FILTER (WHERE border_code = 'other'       AND leg_direction = 'return'), 2) AS return_border_other_hrs
        FROM tat_trip_border_facts_v2
        WHERE trip_key IN (SELECT trip_key FROM filtered_trips)
        GROUP BY trip_key
    ),
    -- Raw border crossings for the detail child array
    border_crossings_agg AS (
        SELECT
            trip_key,
            json_agg(
                json_build_object(
                    'border_code',    border_code,
                    'border_name',    border_name,
                    'border_family',  border_family,
                    'leg_direction',  leg_direction,
                    'entry_time',     entry_time,
                    'exit_time',      exit_time,
                    'dwell_hrs',      dwell_hrs,
                    'confidence',     event_confidence,
                    'inference_rule', inference_rule
                ) ORDER BY COALESCE(entry_time, exit_time)
            ) AS border_crossings
        FROM tat_trip_border_facts_v2
        WHERE trip_key IN (SELECT trip_key FROM filtered_trips)
        GROUP BY trip_key
    ),
    -- Trip event timeline
    timeline_agg AS (
        SELECT
            trip_key,
            json_agg(
                json_build_object(
                    'event_code',     event_code,
                    'event_time',     event_time,
                    'canonical_name', canonical_name,
                    'role_code',      role_code,
                    'trip_stage',     trip_stage,
                    'leg_direction',  leg_direction,
                    'border_code',    border_code,
                    'border_family',  border_family,
                    'confidence',     event_confidence,
                    'inference_rule', inference_rule
                ) ORDER BY event_time
            ) AS timeline
        FROM trip_state_events
        WHERE trip_key IN (SELECT trip_key FROM filtered_trips)
        GROUP BY trip_key
    ),
    paged AS (
        SELECT
            t.trip_key,
            t.tracker_id,
            t.tracker_name,
            t.trip_sequence,
            t.loading_terminal,
            t.origin_region,
            t.destination_name,
            t.customer_name,

            -- v2 canonical status naming
            t.status         AS trip_status,
            t.closure_reason AS trip_closure_reason,
            -- legacy compat aliases
            t.status,
            t.closure_reason,

            t.trip_type,
            t.lifecycle_confidence,

            -- ── Parity-critical milestones ────────────────────────────────
            -- dar_arrival = origin_arrival (parity 1B)
            t.dar_arrival,
            t.dar_arrival    AS origin_arrival,      -- v2 canonical name
            -- dar_exit = origin_exit (parity 1C)
            t.origin_exit    AS dar_exit,
            t.origin_exit,                            -- v2 canonical name
            t.loading_start,
            t.loading_end,
            t.dest_entry,
            t.dest_exit,
            t.customer_entry,
            t.customer_exit,
            t.customs_entry,
            t.customs_exit,
            t.completion_time,
            t.trip_closed_at,
            t.next_loading_entry,

            -- ── Duration metrics ──────────────────────────────────────────
            t.waiting_for_orders_hrs,
            t.loading_phase_hrs,
            t.post_loading_delay_hrs,
            t.transit_hrs,
            t.border_total_hrs,
            t.outbound_border_total_hrs,
            t.return_border_total_hrs,
            t.outbound_border_count,
            t.return_border_count,
            t.customs_hrs,
            t.destination_dwell_hrs,
            t.customer_dwell_hrs,
            t.return_hrs,
            t.total_tat_hrs,

            -- ── Feature flags ─────────────────────────────────────────────
            t.has_border_event,
            t.has_customs_event,
            t.missed_destination,
            t.has_destination_region_only,
            t.low_confidence_flag,
            t.exception_flags,

            -- ── Legacy per-border named fields (compat) ───────────────────
            -- Outbound
            bp.border_tunduma_entry,     bp.border_tunduma_exit,     bp.border_tunduma_hrs,
            bp.border_nakonde_entry,     bp.border_nakonde_exit,     bp.border_nakonde_hrs,
            bp.border_kasumbalesa_entry, bp.border_kasumbalesa_exit, bp.border_kasumbalesa_hrs,
            bp.border_sakania_entry,     bp.border_sakania_exit,     bp.border_sakania_hrs,
            bp.border_mokambo_entry,     bp.border_mokambo_exit,     bp.border_mokambo_hrs,
            bp.border_chembe_entry,      bp.border_chembe_exit,      bp.border_chembe_hrs,
            bp.border_kasumulu_entry,    bp.border_kasumulu_exit,    bp.border_kasumulu_hrs,
            bp.border_other_entry,       bp.border_other_exit,       bp.border_other_hrs,
            -- Return
            bp.return_border_tunduma_entry,     bp.return_border_tunduma_exit,     bp.return_border_tunduma_hrs,
            bp.return_border_nakonde_entry,     bp.return_border_nakonde_exit,     bp.return_border_nakonde_hrs,
            bp.return_border_kasumbalesa_entry, bp.return_border_kasumbalesa_exit, bp.return_border_kasumbalesa_hrs,
            bp.return_border_sakania_entry,     bp.return_border_sakania_exit,     bp.return_border_sakania_hrs,
            bp.return_border_mokambo_entry,     bp.return_border_mokambo_exit,     bp.return_border_mokambo_hrs,
            bp.return_border_chembe_entry,      bp.return_border_chembe_exit,      bp.return_border_chembe_hrs,
            bp.return_border_kasumulu_entry,    bp.return_border_kasumulu_exit,    bp.return_border_kasumulu_hrs,
            bp.return_border_other_entry,       bp.return_border_other_exit,       bp.return_border_other_hrs,

            -- ── Detail arrays ─────────────────────────────────────────────
            COALESCE(bca.border_crossings, '[]'::json) AS border_crossings,
            COALESCE(ta.timeline,          '[]'::json) AS timeline

        FROM filtered_trips t
        LEFT JOIN border_pivot          bp  ON bp.trip_key  = t.trip_key
        LEFT JOIN border_crossings_agg  bca ON bca.trip_key = t.trip_key
        LEFT JOIN timeline_agg          ta  ON ta.trip_key  = t.trip_key

        ORDER BY
            CASE WHEN p_sort = 'loading_start_desc' THEN t.loading_start  END DESC,
            CASE WHEN p_sort = 'loading_start_asc'  THEN t.loading_start  END ASC,
            CASE WHEN p_sort = 'tat_desc'            THEN t.total_tat_hrs  END DESC,
            CASE WHEN p_sort = 'tat_asc'             THEN t.total_tat_hrs  END ASC,
            t.loading_start DESC

        LIMIT  p_limit
        OFFSET p_offset
    )
    SELECT json_build_object(
        'total_completed',       c.total_completed,
        'total_returning',       c.total_returning,
        'total_at_destination',  c.total_at_destination,
        'total_in_transit',      c.total_in_transit,
        'total_unfinished',      c.total_unfinished,
        'total_missed_dest',     c.total_missed_dest,
        'total_all',             c.total_all,
        'limit',                 p_limit,
        'offset',                p_offset,
        'data',                  COALESCE((SELECT json_agg(row_to_json(paged)) FROM paged), '[]'::json)
    ) INTO v_result
    FROM counts c;

    RETURN v_result;
END $$;




--   v_tat_border_no_entry          — border exits without entries (impossible chronology)
--   v_tat_border_negative_dwell    — negative dwell detected
--   v_tat_border_multi_crossing    — trips with multiple crossings of same border+leg
--   v_tat_unmapped_border_aliases  — geofences that look like borders but are unmapped
--   v_tat_event_chronology_qa      — impossible event orderings per trip (extended)
-- =============================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_tat_fleet_stats_v2
-- Same envelope as v1 get_tat_fleet_stats.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_tat_fleet_stats_v2(
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'avg_mobilization_hours',   ROUND(AVG(waiting_for_orders_hrs)::NUMERIC, 1),
        'avg_border_wait_hours',    ROUND(AVG(border_total_hrs)::NUMERIC, 1),
        'avg_unloading_hours',      ROUND(AVG(destination_dwell_hrs)::NUMERIC, 1),
        'trip_completion_rate',     ROUND(
            (100.0 * count(*) FILTER (WHERE dest_exit IS NOT NULL))
            / NULLIF(count(*), 0)::NUMERIC, 1
        ),
        'trips_departed',           count(*),
        'trips_completed',          count(*) FILTER (WHERE status IN ('completed','completed_missed_dest')),
        'total_missed_dest',        count(*) FILTER (WHERE missed_destination = true),
        'avg_loading_phase_hours',  ROUND(AVG(loading_phase_hrs)::NUMERIC, 1),
        'avg_transit_hours',        ROUND(AVG(transit_hrs)::NUMERIC, 1),
        'avg_total_tat_hours',      ROUND(AVG(total_tat_hrs)::NUMERIC, 1),
        'pct_long_haul',            ROUND(
            (100.0 * count(*) FILTER (WHERE trip_type = 'long_haul'))
            / NULLIF(count(*), 0)::NUMERIC, 1
        )
    ) INTO v_result
    FROM tat_trip_facts_v2
    WHERE loading_start >= p_start_date
      AND loading_start  <= p_end_date
      AND (p_destination IS NULL OR destination_name = p_destination);

    RETURN v_result;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_tat_summary_by_destination_v2
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_tat_summary_by_destination_v2(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO v_result
    FROM (
        SELECT
            COALESCE(destination_name, customer_name, '(unknown)') AS location,
            count(DISTINCT tracker_id)                  AS unique_trackers,
            count(*)                                    AS trip_count,
            ROUND(AVG(total_tat_hrs) / 24.0, 2)        AS avg_tat_days,
            ROUND(AVG(waiting_for_orders_hrs), 1)       AS avg_waiting_hrs,
            ROUND(AVG(loading_phase_hrs), 1)            AS avg_loading_hrs,
            ROUND(AVG(transit_hrs), 1)                  AS avg_transit_hrs,
            ROUND(AVG(border_total_hrs), 1)             AS avg_border_hrs,
            ROUND(AVG(destination_dwell_hrs), 1)        AS avg_offloading_hrs,
            ROUND(AVG(customer_dwell_hrs), 1)           AS avg_customer_hrs,
            ROUND(
                100.0 * count(*) FILTER (WHERE has_border_event)
                / NULLIF(count(*), 0)::NUMERIC, 1
            )                                           AS pct_with_border,
            ROUND(AVG(lifecycle_confidence)::NUMERIC, 2) AS avg_lifecycle_confidence,
            ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p50_tat_hrs,
            ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p75_tat_hrs,
            ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_tat_hrs)::NUMERIC, 1) AS p90_tat_hrs
        FROM tat_trip_facts_v2
        WHERE loading_start >= p_start_date
          AND loading_start  <= p_end_date
          AND (destination_name IS NOT NULL OR customer_name IS NOT NULL)
          AND dest_exit IS NOT NULL
        GROUP BY COALESCE(destination_name, customer_name, '(unknown)')
        ORDER BY trip_count DESC
    ) r;

    RETURN v_result;
END $$;


-- ── A. Parity validation: per-trip milestone comparison ──────────────────────
-- Requires v1 source table tat_trips_data.
-- Compares the parity-critical timestamp columns for trips that appear in both.

CREATE OR REPLACE VIEW v_tat_v1_v2_parity_milestones AS
SELECT
    v2.trip_key,
    v2.tracker_id,
    v2.tracker_name,
    v2.loading_start,

    -- ── loading_start delta ───────────────────────────────────────────────────
    v1.loading_start       AS v1_loading_start,
    v2.loading_start       AS v2_loading_start,
    ROUND(EXTRACT(EPOCH FROM (v2.loading_start - v1.loading_start))/3600.0, 2)
                           AS loading_start_delta_hrs,

    -- ── dar_arrival delta ─────────────────────────────────────────────────────
    v1.dar_arrival         AS v1_dar_arrival,
    v2.dar_arrival         AS v2_dar_arrival,
    ROUND(EXTRACT(EPOCH FROM (v2.dar_arrival - v1.dar_arrival))/3600.0, 2)
                           AS dar_arrival_delta_hrs,

    -- ── dar_exit delta ────────────────────────────────────────────────────────
    v1.dar_exit            AS v1_dar_exit,
    v2.origin_exit         AS v2_dar_exit,
    ROUND(EXTRACT(EPOCH FROM (v2.origin_exit - v1.dar_exit))/3600.0, 2)
                           AS dar_exit_delta_hrs,

    -- ── dest_entry delta ──────────────────────────────────────────────────────
    v1.dest_entry          AS v1_dest_entry,
    v2.dest_entry          AS v2_dest_entry,
    ROUND(EXTRACT(EPOCH FROM (v2.dest_entry - v1.dest_entry))/3600.0, 2)
                           AS dest_entry_delta_hrs,

    -- ── dest_exit delta ───────────────────────────────────────────────────────
    v1.dest_exit           AS v1_dest_exit,
    v2.dest_exit           AS v2_dest_exit,
    ROUND(EXTRACT(EPOCH FROM (v2.dest_exit - v1.dest_exit))/3600.0, 2)
                           AS dest_exit_delta_hrs,

    -- ── completion_time delta ─────────────────────────────────────────────────
    -- v1 uses next_dar_entry or next_loading_entry as completion proxy
    COALESCE(v1.next_dar_entry, v1.next_loading_entry)
                           AS v1_completion_proxy,
    v2.completion_time     AS v2_completion_time,
    ROUND(EXTRACT(EPOCH FROM (
        v2.completion_time - COALESCE(v1.next_dar_entry, v1.next_loading_entry)
    ))/3600.0, 2)          AS completion_delta_hrs,

    -- ── trip_status (v2 only, no v1 equivalent) ──────────────────────────────
    v2.status              AS v2_trip_status

FROM tat_trip_facts_v2 v2
JOIN tat_trips_data v1
     ON  v1.tracker_id    = v2.tracker_id
     -- Match on loading_start within 2h (handles minor anchor drift)
     AND ABS(EXTRACT(EPOCH FROM (v1.loading_start - v2.loading_start))) < 7200

WHERE v2.loading_start >= '2024-01-01';


-- ── B. Parity validation: per-trip duration comparison ───────────────────────

CREATE OR REPLACE VIEW v_tat_v1_v2_parity_durations AS
SELECT
    v2.trip_key,
    v2.tracker_id,
    v2.tracker_name,
    v2.loading_start,
    v2.destination_name,

    -- loading_phase_hrs (computed from v1 timestamps)
    ROUND(EXTRACT(EPOCH FROM (v1.loading_exit - v1.loading_entry))/3600.0, 2)
                               AS v1_loading_hrs,
    v2.loading_phase_hrs       AS v2_loading_hrs,
    ROUND(v2.loading_phase_hrs - EXTRACT(EPOCH FROM (v1.loading_exit - v1.loading_entry))/3600.0, 2)
                               AS loading_hrs_delta,

    -- transit_hrs (dar_exit → dest_entry proxy)
    ROUND(EXTRACT(EPOCH FROM (v1.dest_entry - v1.dar_exit))/3600.0, 2)
                               AS v1_transit_hrs,
    v2.transit_hrs             AS v2_transit_hrs,
    ROUND(v2.transit_hrs - EXTRACT(EPOCH FROM (v1.dest_entry - v1.dar_exit))/3600.0, 2)
                               AS transit_hrs_delta,

    -- total_tat_hrs (loading_start → completion proxy)
    ROUND(EXTRACT(EPOCH FROM (COALESCE(v1.next_dar_entry, v1.next_loading_entry) - v1.loading_start))/3600.0, 2)
                               AS v1_total_tat_hrs,
    v2.total_tat_hrs           AS v2_total_tat_hrs,
    ROUND(v2.total_tat_hrs - EXTRACT(EPOCH FROM (COALESCE(v1.next_dar_entry, v1.next_loading_entry) - v1.loading_start))/3600.0, 2)
                               AS total_tat_delta,

    -- Flag any field that drifted by more than 2 hours (loading + transit + total)
    (   ABS(v2.loading_phase_hrs - EXTRACT(EPOCH FROM (v1.loading_exit - v1.loading_entry))/3600.0) > 2
     OR ABS(v2.transit_hrs       - EXTRACT(EPOCH FROM (v1.dest_entry - v1.dar_exit))/3600.0) > 2
     OR ABS(v2.total_tat_hrs     - EXTRACT(EPOCH FROM (COALESCE(v1.next_dar_entry, v1.next_loading_entry) - v1.loading_start))/3600.0) > 2
    )                          AS has_significant_drift

FROM tat_trip_facts_v2 v2
JOIN tat_trips_data v1
     ON  v1.tracker_id  = v2.tracker_id
     AND ABS(EXTRACT(EPOCH FROM (v1.loading_start - v2.loading_start))) < 7200
WHERE v2.loading_start >= '2024-01-01';


-- ── C. Parity validation: aggregate counts and averages ──────────────────────
-- Replaces the simpler v_tat_v1_v2_parity view from phase_4_fix.sql.

CREATE OR REPLACE VIEW v_tat_v1_v2_parity_counts AS
SELECT
    version,
    destination,
    trip_count,
    avg_total_tat_hrs,
    avg_waiting_hrs,
    avg_loading_hrs,
    avg_transit_hrs,
    first_trip,
    latest_trip
FROM (
    SELECT
        'v1'               AS version,
        dest_name          AS destination,
        count(*)           AS trip_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(next_dar_entry, next_loading_entry) - loading_start))/3600.0), 1)
                                               AS avg_total_tat_hrs,
        NULL::NUMERIC                          AS avg_waiting_hrs,
        ROUND(AVG(EXTRACT(EPOCH FROM (loading_exit - loading_entry))/3600.0), 1)
                                               AS avg_loading_hrs,
        ROUND(AVG(EXTRACT(EPOCH FROM (dest_entry - dar_exit))/3600.0), 1)
                                               AS avg_transit_hrs,
        min(loading_start) AS first_trip,
        max(loading_start) AS latest_trip
    FROM tat_trips_data
    WHERE dest_name IS NOT NULL
    GROUP BY dest_name

    UNION ALL

    SELECT
        'v2'               AS version,
        destination_name   AS destination,
        count(*)           AS trip_count,
        ROUND(AVG(total_tat_hrs), 1)           AS avg_total_tat_hrs,
        ROUND(AVG(waiting_for_orders_hrs), 1)  AS avg_waiting_hrs,
        ROUND(AVG(loading_phase_hrs), 1)       AS avg_loading_hrs,
        ROUND(AVG(transit_hrs), 1)             AS avg_transit_hrs,
        min(loading_start) AS first_trip,
        max(loading_start) AS latest_trip
    FROM tat_trip_facts_v2
    WHERE destination_name IS NOT NULL
    GROUP BY destination_name
) combined
ORDER BY destination, version;


-- ── D. Parity: border timestamp comparison per named border ──────────────────

CREATE OR REPLACE VIEW v_tat_v1_v2_parity_borders AS
WITH border_names AS (
    VALUES
        ('tunduma'),('nakonde'),('kasumbalesa'),
        ('sakania'),('mokambo'),('chembe'),('kasumulu')
),
v2_borders AS (
    SELECT trip_key, border_code, leg_direction,
           MIN(entry_time)    AS v2_entry,
           MAX(exit_time)     AS v2_exit,
           SUM(dwell_hrs)     AS v2_dwell_hrs
    FROM tat_trip_border_facts_v2
    GROUP BY trip_key, border_code, leg_direction
),
v1_borders AS (
    -- v1 stores border data as named columns; pivot them to rows
    SELECT loading_start, tracker_id, 'tunduma'     AS border_code, 'outbound' AS leg,
           border_tunduma_entry  AS v1_entry, border_tunduma_exit  AS v1_exit,
           ROUND(EXTRACT(EPOCH FROM (border_tunduma_exit  - border_tunduma_entry))/3600.0,2)  AS v1_dwell_hrs
    FROM tat_trips_data WHERE border_tunduma_entry IS NOT NULL
    UNION ALL
    SELECT loading_start, tracker_id, 'kasumbalesa' AS border_code, 'outbound',
           border_kasumbalesa_entry, border_kasumbalesa_exit,
           ROUND(EXTRACT(EPOCH FROM (border_kasumbalesa_exit - border_kasumbalesa_entry))/3600.0,2)
    FROM tat_trips_data WHERE border_kasumbalesa_entry IS NOT NULL
    UNION ALL
    SELECT loading_start, tracker_id, 'sakania'     AS border_code, 'outbound',
           border_sakania_entry, border_sakania_exit,
           ROUND(EXTRACT(EPOCH FROM (border_sakania_exit - border_sakania_entry))/3600.0,2)
    FROM tat_trips_data WHERE border_sakania_entry IS NOT NULL
    UNION ALL
    SELECT loading_start, tracker_id, 'mokambo'     AS border_code, 'outbound',
           border_mokambo_entry, border_mokambo_exit,
           ROUND(EXTRACT(EPOCH FROM (border_mokambo_exit - border_mokambo_entry))/3600.0,2)
    FROM tat_trips_data WHERE border_mokambo_entry IS NOT NULL
    UNION ALL
    SELECT loading_start, tracker_id, 'chembe'      AS border_code, 'outbound',
           border_chembe_entry, border_chembe_exit,
           ROUND(EXTRACT(EPOCH FROM (border_chembe_exit - border_chembe_entry))/3600.0,2)
    FROM tat_trips_data WHERE border_chembe_entry IS NOT NULL
    UNION ALL
    SELECT loading_start, tracker_id, 'kasumulu'    AS border_code, 'outbound',
           border_kasumulu_entry, border_kasumulu_exit,
           ROUND(EXTRACT(EPOCH FROM (border_kasumulu_exit - border_kasumulu_entry))/3600.0,2)
    FROM tat_trips_data WHERE border_kasumulu_entry IS NOT NULL
)
SELECT
    v2b.trip_key,
    v2b.border_code,
    v2b.leg_direction,
    v1b.v1_entry,   v2b.v2_entry,
    ROUND(EXTRACT(EPOCH FROM (v2b.v2_entry - v1b.v1_entry))/3600.0, 2) AS entry_delta_hrs,
    v1b.v1_exit,    v2b.v2_exit,
    ROUND(EXTRACT(EPOCH FROM (v2b.v2_exit  - v1b.v1_exit))/3600.0, 2)  AS exit_delta_hrs,
    v1b.v1_dwell_hrs, v2b.v2_dwell_hrs,
    ROUND(v2b.v2_dwell_hrs - v1b.v1_dwell_hrs, 2)                       AS dwell_delta_hrs
FROM v2_borders v2b
JOIN tat_trip_facts_v2 f ON f.trip_key = v2b.trip_key
JOIN v1_borders v1b
     ON  v1b.tracker_id  = f.tracker_id
     AND v1b.border_code = v2b.border_code
     AND v1b.leg         = v2b.leg_direction
     AND ABS(EXTRACT(EPOCH FROM (v1b.loading_start - f.loading_start))) < 7200
ORDER BY v2b.trip_key, v2b.border_code, v2b.leg_direction;


-- ── E. Border anomaly checks ──────────────────────────────────────────────────

-- E1. Border entries without exits
CREATE OR REPLACE VIEW v_tat_border_no_exit AS
SELECT
    trip_key, tracker_id, tracker_name,
    border_code, border_family, leg_direction,
    entry_time,
    event_confidence,
    inference_rule
FROM tat_trip_border_facts_v2
WHERE exit_time IS NULL
ORDER BY entry_time DESC;


-- E2. Negative dwell (exit before entry — data corruption or GPS jitter)
CREATE OR REPLACE VIEW v_tat_border_negative_dwell AS
SELECT
    trip_key, tracker_id, tracker_name,
    border_code, leg_direction,
    entry_time, exit_time,
    ROUND(EXTRACT(EPOCH FROM (exit_time - entry_time))/3600.0, 2) AS dwell_hrs_raw
FROM tat_trip_border_facts_v2
WHERE exit_time IS NOT NULL
  AND exit_time < entry_time
ORDER BY entry_time DESC;


-- E3. Multiple crossings of same border+leg in one trip (unusual but valid)
CREATE OR REPLACE VIEW v_tat_border_multi_crossing AS
SELECT
    trip_key, tracker_id, tracker_name,
    border_code, leg_direction,
    COUNT(*)       AS crossing_count,
    MIN(entry_time) AS first_entry,
    MAX(exit_time)  AS last_exit,
    ROUND(SUM(dwell_hrs), 2) AS total_dwell_hrs
FROM tat_trip_border_facts_v2
GROUP BY trip_key, tracker_id, tracker_name, border_code, leg_direction
HAVING COUNT(*) > 1
ORDER BY crossing_count DESC, trip_key;


-- E4. Border chronology violations per trip
-- (outbound border after destination_entry, return border before destination_exit)
CREATE OR REPLACE VIEW v_tat_border_chronology_violations AS
WITH milestones AS (
    SELECT
        trip_key, tracker_id,
        MIN(event_time) FILTER (WHERE event_code = 'destination_entry') AS dest_entry,
        MAX(event_time) FILTER (WHERE event_code = 'destination_exit')  AS dest_exit
    FROM trip_state_events
    GROUP BY trip_key, tracker_id
)
SELECT
    bf.trip_key,
    bf.tracker_id,
    bf.border_code,
    bf.leg_direction,
    bf.entry_time,
    bf.exit_time,
    m.dest_entry,
    m.dest_exit,
    CASE
        WHEN bf.leg_direction = 'outbound'
             AND m.dest_entry IS NOT NULL
             AND bf.entry_time > m.dest_entry
            THEN 'outbound_border_after_dest_entry'
        WHEN bf.leg_direction = 'return'
             AND m.dest_exit IS NOT NULL
             AND bf.entry_time < m.dest_exit
            THEN 'return_border_before_dest_exit'
        ELSE 'ok'
    END AS violation_type
FROM tat_trip_border_facts_v2 bf
LEFT JOIN milestones m ON m.trip_key = bf.trip_key
WHERE
    (bf.leg_direction = 'outbound' AND m.dest_entry IS NOT NULL AND bf.entry_time > m.dest_entry)
    OR
    (bf.leg_direction = 'return'   AND m.dest_exit  IS NOT NULL AND bf.entry_time < m.dest_exit)
ORDER BY bf.entry_time DESC;


-- E5. Closure before destination (closed_by_return_origin with no dest evidence)
CREATE OR REPLACE VIEW v_tat_closure_before_dest AS
SELECT
    trip_key, tracker_id, tracker_name,
    status,
    closure_reason,
    loading_start,
    trip_closed_at,
    destination_name,
    customer_name,
    has_destination_region_only,
    total_tat_hrs
FROM tat_trip_facts_v2
WHERE closure_reason = 'closed_by_return_origin'
  AND destination_name IS NULL
  AND customer_name    IS NULL
ORDER BY loading_start DESC;


-- ── F. Unmapped border aliases ────────────────────────────────────────────────
-- Geofence names that appear border-like (contain known border keywords) but
-- are not mapped to any border_code in trip_state_events.
-- Useful for finding aliases that need to be added to geofence_aliases.

CREATE OR REPLACE VIEW v_tat_unmapped_border_aliases AS
WITH border_keywords AS (
    SELECT unnest(ARRAY[
        'tunduma','nakonde','kasumbalesa','sakania',
        'mokambo','chembe','kasumulu','border','crossing','port'
    ]) AS keyword
)
SELECT DISTINCT
    gv.geofence_name                              AS raw_name,
    normalize_geofence_name(gv.geofence_name)     AS normalized_name,
    COUNT(DISTINCT gv.tracker_id)                 AS tracker_count,
    MAX(gv.in_time_dt)                            AS last_seen,
    -- Is this name already in geofence_aliases?
    EXISTS (
        SELECT 1 FROM geofence_aliases ga
        WHERE ga.alias_name = gv.geofence_name
           OR ga.normalized_name = normalize_geofence_name(gv.geofence_name)
    )                                             AS is_mapped,
    -- Which keyword triggered the match?
    (
        SELECT STRING_AGG(bk.keyword, ', ')
        FROM border_keywords bk
        WHERE gv.geofence_name ILIKE '%' || bk.keyword || '%'
    )                                             AS matched_keywords
FROM public.geofence_visits gv
CROSS JOIN LATERAL (
    SELECT 1 FROM border_keywords bk
    WHERE gv.geofence_name ILIKE '%' || bk.keyword || '%'
    LIMIT 1
) _matched
WHERE NOT EXISTS (
    -- Not already mapped to a border role
    SELECT 1
    FROM geofence_aliases ga
    JOIN geofence_master gm   ON gm.geofence_id  = ga.geofence_id
    JOIN geofence_role_map rm ON rm.geofence_id  = gm.geofence_id
    WHERE (ga.alias_name = gv.geofence_name OR ga.normalized_name = normalize_geofence_name(gv.geofence_name))
      AND rm.role_code IN ('border_tz','border_zm','border_drc','border_other')
)
GROUP BY gv.geofence_name
ORDER BY tracker_count DESC, last_seen DESC;


-- ── G. Extended event chronology QA (replaces v_trip_event_chronology_qa) ────
-- Now includes border ordering checks.

DROP VIEW IF EXISTS v_trip_event_chronology_qa CASCADE;
CREATE VIEW v_trip_event_chronology_qa AS
WITH events AS (
    SELECT
        trip_key, tracker_id,
        MIN(event_time) FILTER (WHERE event_code = 'loading_start')       AS loading_start,
        MAX(event_time) FILTER (WHERE event_code = 'loading_end')         AS loading_end,
        MIN(event_time) FILTER (WHERE event_code = 'border_entry')        AS first_outbound_border,
        MIN(event_time) FILTER (WHERE event_code = 'destination_entry')   AS dest_entry,
        MAX(event_time) FILTER (WHERE event_code = 'destination_exit')    AS dest_exit,
        MIN(event_time) FILTER (WHERE event_code = 'return_border_entry') AS first_return_border,
        MAX(event_time) FILTER (WHERE event_code = 'trip_closed')         AS trip_closed
    FROM trip_state_events
    GROUP BY trip_key, tracker_id
)
SELECT
    trip_key, tracker_id,
    -- Existing chronology checks
    (loading_end < loading_start)                                 AS loading_end_before_start,
    (dest_entry  < loading_end)                                   AS dest_before_load_end,
    (dest_exit   < dest_entry)                                    AS dest_exit_before_entry,
    (trip_closed < loading_start)                                 AS closed_before_load,
    -- Border chronology checks
    (first_outbound_border IS NOT NULL
     AND first_outbound_border < loading_end)                     AS outbound_border_before_load_end,
    (dest_entry IS NOT NULL AND first_return_border IS NOT NULL
     AND first_return_border < dest_entry)                        AS return_border_before_dest_entry,
    -- Source timestamps for investigation
    loading_start, loading_end,
    first_outbound_border, dest_entry, dest_exit,
    first_return_border, trip_closed
FROM events
WHERE
    loading_end < loading_start
    OR dest_entry  < loading_end
    OR dest_exit   < dest_entry
    OR trip_closed < loading_start
    OR (first_outbound_border IS NOT NULL AND first_outbound_border < loading_end)
    OR (dest_entry IS NOT NULL AND first_return_border IS NOT NULL AND first_return_border < dest_entry);


-- ── H. Border facts completeness summary ─────────────────────────────────────
-- Quick health check: how many trips have border events but no border facts?

CREATE OR REPLACE VIEW v_tat_border_facts_coverage AS
SELECT
    'trips_with_border_events' AS metric,
    count(DISTINCT trip_key)   AS value
FROM tat_trip_facts_v2
WHERE has_border_event = TRUE

UNION ALL

SELECT
    'trips_with_border_facts',
    count(DISTINCT trip_key)
FROM tat_trip_border_facts_v2

UNION ALL

SELECT
    'border_events_without_facts',
    count(DISTINCT f.trip_key)
FROM tat_trip_facts_v2 f
WHERE f.has_border_event = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM tat_trip_border_facts_v2 bf WHERE bf.trip_key = f.trip_key
  )

UNION ALL

SELECT
    'border_facts_total_rows',
    count(*)
FROM tat_trip_border_facts_v2;
