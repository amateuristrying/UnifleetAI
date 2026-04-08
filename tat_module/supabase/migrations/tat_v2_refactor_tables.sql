-- =============================================================
-- TAT V2 REFACTOR: Missing Core Table DDL
-- Dependency: tat_v2_refactor_core.sql (geofence_master, geofence_role_map, etc.)
-- Run BEFORE: phase_2, phase_3, phase_4, phase_5, phase_6
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- TABLE: trip_state_events
-- Purpose: Explicit milestone ledger. One row per inferred lifecycle
--   event per trip. This is the canonical source of truth for what
--   happened and why it was inferred.
-- Replaces: implicit milestone derivation inside process_tat_chunk
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_state_events (
    event_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_key         TEXT        NOT NULL,           -- stable identifier: trackerid:epoch_of_anchor
    tracker_id       INTEGER     NOT NULL,
    event_code       TEXT        NOT NULL,           -- vocabulary below
    event_time       TIMESTAMPTZ NOT NULL,
    event_confidence NUMERIC(3,2) DEFAULT 1.00,      -- 0.00–1.00
    inference_rule   TEXT,                           -- human-readable rule name
    event_meta       JSONB,                          -- geofence name, role, reason, etc.
    created_at       TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Event code vocabulary (mirrors v1 implicit states + new additions):
-- LOADING PHASE:
--   trip_anchor_start     — first signal that identifies a trip (ops yard / origin zone arrival)
--   loading_start         — terminal or zone entry (trip anchor; used to key the trip)
--   loading_end           — terminal or zone exit
-- ORIGIN DEPARTURE:
--   origin_exit           — exit from broad origin region (Dar geofence, Kiluvya)
-- TRANSIT:
--   corridor_entry        — entry into a named corridor checkpoint (Misugusugu etc.)
--   border_entry          — outbound border crossing entry
--   border_exit           — outbound border crossing exit
--   customs_entry         — customs site entry (Kanyaka, Whisk DRC)
--   customs_exit          — customs site exit
-- DESTINATION:
--   destination_region_entry — entry into broad destination region (DRC Offloading Geo)
--   destination_region_exit
--   destination_entry     — entry into specific offloading/delivery site
--   destination_exit      — exit from offloading/delivery site
--   customer_entry        — entry into named customer site (L3_CUSTOMER)
--   customer_exit
-- RETURN:
--   return_leg_start      — first event clearly on the return (after dest_exit)
--   return_border_entry   — border entry on return leg
--   return_border_exit    — border exit on return leg
--   return_origin_entry   — re-entry into origin zone/gateway (closes trip)
-- CLOSURE:
--   trip_closed           — explicit closure event; event_meta->>'reason' carries closure_reason

-- No unique index on (trip_key, event_code, event_time):
-- A trip can have multiple rows with the same event_code at different times
-- (e.g., border_entry at Tunduma then again at Kasumbalesa).
-- Idempotency is guaranteed by the DELETE at the start of build_trip_state_events_v2.
-- The PK (event_id UUID) is the only unique row constraint.
CREATE INDEX IF NOT EXISTS idx_tse_trip_key        ON trip_state_events (trip_key);
CREATE INDEX IF NOT EXISTS idx_tse_tracker_time    ON trip_state_events (tracker_id, event_time);
CREATE INDEX IF NOT EXISTS idx_tse_event_code      ON trip_state_events (event_code);
CREATE INDEX IF NOT EXISTS idx_tse_created         ON trip_state_events (created_at);


-- ─────────────────────────────────────────────────────────────
-- TABLE: tat_trip_facts_v2
-- Purpose: One row per trip. Derived from trip_state_events.
--   Wide fact table that mirrors tat_trips_data schema + new fields.
-- Replaces: tat_trips_data
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tat_trip_facts_v2 (
    -- ── Trip identity ──────────────────────────────────────────
    trip_key             TEXT        PRIMARY KEY,       -- trackerid:epoch_of_loading_start
    tracker_id           INTEGER     NOT NULL,
    tracker_name         TEXT,

    -- ── Origin ─────────────────────────────────────────────────
    loading_terminal     TEXT,                          -- canonical terminal name (priority: L1_TERMINAL > L1_ZONE > L1_ASAS_OPS)
    origin_region        TEXT,                          -- broad origin region (DAR GEOFENCE / TANGA / BEIRA etc.)

    -- ── Destination / Customer ─────────────────────────────────
    destination_name     TEXT,                          -- offloading site or region name
    customer_name        TEXT,                          -- L3_CUSTOMER site name

    -- ── Classification ─────────────────────────────────────────
    trip_type            TEXT,                          -- 'long_haul' | 'local_ops' | 'lpg_delivery'
    status               TEXT,                          -- see status vocabulary below
    closure_reason       TEXT,                          -- see closure_reason vocabulary below
    lifecycle_confidence NUMERIC(3,2),                  -- weighted avg of milestone confidences

    -- ── Core timestamps (mirrors tat_trips_data) ───────────────
    dar_arrival          TIMESTAMPTZ,   -- when truck first appeared in origin zone / ops yard
    loading_start        TIMESTAMPTZ,   -- entry to loading terminal / zone (trip anchor)
    loading_end          TIMESTAMPTZ,   -- exit from loading terminal / zone
    origin_exit          TIMESTAMPTZ,   -- exit from broad origin geofence (= dar_exit in v1)
    next_loading_entry   TIMESTAMPTZ,   -- start of the NEXT trip (used for closure + total TAT)

    -- ── Destination timestamps ──────────────────────────────────
    dest_entry           TIMESTAMPTZ,
    dest_exit            TIMESTAMPTZ,

    -- ── Customer timestamps ─────────────────────────────────────
    customer_entry       TIMESTAMPTZ,
    customer_exit        TIMESTAMPTZ,

    -- ── Customs ────────────────────────────────────────────────
    customs_entry        TIMESTAMPTZ,
    customs_exit         TIMESTAMPTZ,

    -- ── Border (outbound — first entry / last exit across all borders) ──
    border_entry         TIMESTAMPTZ,
    border_exit          TIMESTAMPTZ,

    -- ── Border (return) ────────────────────────────────────────
    return_border_entry  TIMESTAMPTZ,
    return_border_exit   TIMESTAMPTZ,

    -- ── DRC region ─────────────────────────────────────────────
    drc_region_entry     TIMESTAMPTZ,
    drc_region_exit      TIMESTAMPTZ,

    -- ── Trip closure ──────────────────���────────────────────────
    trip_closed_at       TIMESTAMPTZ,

    -- ── Duration metrics (hours) ───────────────────────────────
    -- All match v1 RPC output column names for parity.
    waiting_for_orders_hrs   NUMERIC(10,2),  -- dar_arrival → loading_start
    loading_phase_hrs        NUMERIC(10,2),  -- loading_start → loading_end
    post_loading_delay_hrs   NUMERIC(10,2),  -- loading_end → origin_exit
    transit_hrs              NUMERIC(10,2),  -- origin_exit (or loading_end) → dest_entry
    border_total_hrs         NUMERIC(10,2),  -- total time inside all outbound borders
    customs_hrs              NUMERIC(10,2),
    destination_dwell_hrs    NUMERIC(10,2),  -- dest_entry → dest_exit
    customer_dwell_hrs       NUMERIC(10,2),
    return_hrs               NUMERIC(10,2),  -- dest_exit → trip_closed (return leg)
    total_tat_hrs            NUMERIC(10,2),  -- dar_arrival/loading_start → closure/now

    -- ── Feature flags ──────────────────────────────────────────
    has_corridor_event   BOOLEAN DEFAULT FALSE,   -- any border / corridor checkpoint seen
    has_border_event     BOOLEAN DEFAULT FALSE,
    has_customs_event    BOOLEAN DEFAULT FALSE,
    missed_destination   BOOLEAN DEFAULT FALSE,   -- trip closed but no dest evidence

    -- ── Exception flags (array of exception_code strings) ──────
    exception_flags      JSONB,

    -- ── Audit ──────────────────────────────────────────────────
    created_at           TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at           TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Status vocabulary (maps 1:1 to v1 trip_status values):
--   'loading'               — currently inside terminal/zone, no departure yet
--   'pre_transit'           — loading complete, not yet departed origin region
--   'in_transit'            — departed origin, not yet at destination
--   'at_destination'        — dest_entry seen, dest_exit not yet
--   'returning'             — dest_exit seen, not yet back at origin
--   'completed'             — returned to origin or next loading started, with destination evidence
--   'completed_missed_dest' — returned to origin or next loading started, NO destination evidence
--   'closed_low_confidence' — lifecycle_confidence < 0.50, treat as unreliable
--   'orphaned'              — only loading event seen, nothing after

-- Closure reason vocabulary:
--   'closed_by_return_origin'   — origin_zone or origin_gateway re-entry after destination
--   'closed_by_next_loading'    — next loading_start detected (window ceiling)
--   'closed_by_timeout'         — no activity for > 30 days
--   'closed_by_manual_override' — operator-set (future feature)
--   'closed_by_reentry_origin'  — returned to origin before reaching any destination

CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_tracker_start ON tat_trip_facts_v2 (tracker_id, loading_start);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_status        ON tat_trip_facts_v2 (status);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_dest          ON tat_trip_facts_v2 (destination_name);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_terminal      ON tat_trip_facts_v2 (loading_terminal);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_trip_type     ON tat_trip_facts_v2 (trip_type);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_closed        ON tat_trip_facts_v2 (trip_closed_at);
