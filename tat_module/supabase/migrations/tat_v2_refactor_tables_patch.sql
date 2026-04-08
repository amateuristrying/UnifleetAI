-- =============================================================
-- TAT V2 REFACTOR: Tables Patch
-- Purpose: Ensures tat_trip_facts_v2 is a proper TABLE (not a view)
--   with all required columns. An earlier migration may have created
--   it as a VIEW — this patch drops the view if found and recreates
--   it as a table, then adds any missing columns safely.
-- Run BEFORE: phase_4_fix, phase_6_fix
-- =============================================================

-- Step 1: Drop any existing tat_trip_facts_v2 object unconditionally.
-- It may be a VIEW (from an earlier migration) or an incomplete TABLE.
-- CASCADE also drops tat_trips_view_v2 which depends on it.
-- These will be recreated cleanly below / by phase_6_fix.sql.
DROP VIEW  IF EXISTS tat_trips_view_v2  CASCADE;
-- Drop as view first (legacy check), then as table — handles whichever form exists
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'tat_trip_facts_v2') THEN
        EXECUTE 'DROP VIEW tat_trip_facts_v2 CASCADE';
    END IF;
END $$;
DROP TABLE IF EXISTS tat_trip_facts_v2  CASCADE;

-- Step 2: Create the table if it does not exist yet.
-- (If it was just dropped above, or never existed, this creates it fresh.)
CREATE TABLE IF NOT EXISTS tat_trip_facts_v2 (
    trip_key             TEXT        PRIMARY KEY,
    tracker_id           INTEGER     NOT NULL,
    tracker_name         TEXT,
    loading_terminal     TEXT,
    origin_region        TEXT,
    destination_name     TEXT,
    customer_name        TEXT,
    trip_type            TEXT,
    status               TEXT,
    closure_reason       TEXT,
    lifecycle_confidence NUMERIC(3,2),
    dar_arrival          TIMESTAMPTZ,
    loading_start        TIMESTAMPTZ,
    loading_end          TIMESTAMPTZ,
    origin_exit          TIMESTAMPTZ,
    next_loading_entry   TIMESTAMPTZ,
    dest_entry           TIMESTAMPTZ,
    dest_exit            TIMESTAMPTZ,
    customer_entry       TIMESTAMPTZ,
    customer_exit        TIMESTAMPTZ,
    customs_entry        TIMESTAMPTZ,
    customs_exit         TIMESTAMPTZ,
    border_entry         TIMESTAMPTZ,
    border_exit          TIMESTAMPTZ,
    return_border_entry  TIMESTAMPTZ,
    return_border_exit   TIMESTAMPTZ,
    drc_region_entry     TIMESTAMPTZ,
    drc_region_exit      TIMESTAMPTZ,
    trip_closed_at       TIMESTAMPTZ,
    waiting_for_orders_hrs   NUMERIC(10,2),
    loading_phase_hrs        NUMERIC(10,2),
    post_loading_delay_hrs   NUMERIC(10,2),
    transit_hrs              NUMERIC(10,2),
    border_total_hrs         NUMERIC(10,2),
    customs_hrs              NUMERIC(10,2),
    destination_dwell_hrs    NUMERIC(10,2),
    customer_dwell_hrs       NUMERIC(10,2),
    return_hrs               NUMERIC(10,2),
    total_tat_hrs            NUMERIC(10,2),
    has_corridor_event   BOOLEAN DEFAULT FALSE,
    has_border_event     BOOLEAN DEFAULT FALSE,
    has_customs_event    BOOLEAN DEFAULT FALSE,
    missed_destination   BOOLEAN DEFAULT FALSE,
    exception_flags      JSONB,
    created_at           TIMESTAMPTZ DEFAULT clock_timestamp(),
    updated_at           TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Step 3: Add any columns that might be missing if the table already existed as a table
--   but was created by an older version without the full column set.
ALTER TABLE tat_trip_facts_v2
    ADD COLUMN IF NOT EXISTS tracker_name           TEXT,
    ADD COLUMN IF NOT EXISTS origin_region          TEXT,
    ADD COLUMN IF NOT EXISTS customer_name          TEXT,
    ADD COLUMN IF NOT EXISTS closure_reason         TEXT,
    ADD COLUMN IF NOT EXISTS lifecycle_confidence   NUMERIC(3,2),
    ADD COLUMN IF NOT EXISTS dar_arrival            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS loading_start          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS loading_end            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS origin_exit            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_loading_entry     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dest_entry             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dest_exit              TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS customer_entry         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS customer_exit          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS customs_entry          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS customs_exit           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS border_entry           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS border_exit            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_border_entry    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_border_exit     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS drc_region_entry       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS drc_region_exit        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trip_closed_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS waiting_for_orders_hrs NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS loading_phase_hrs      NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS post_loading_delay_hrs NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS transit_hrs            NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS border_total_hrs       NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS customs_hrs            NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS destination_dwell_hrs  NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS customer_dwell_hrs     NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS return_hrs             NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS total_tat_hrs          NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS has_corridor_event     BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_border_event       BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_customs_event      BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS missed_destination     BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS exception_flags        JSONB,
    ADD COLUMN IF NOT EXISTS loading_terminal       TEXT,
    ADD COLUMN IF NOT EXISTS destination_name       TEXT,
    ADD COLUMN IF NOT EXISTS trip_type              TEXT,
    ADD COLUMN IF NOT EXISTS status                 TEXT,
    ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT clock_timestamp(),
    ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ DEFAULT clock_timestamp();

-- Ensure the trip_key primary key exists (original table may have used a different PK setup)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tat_trip_facts_v2'::regclass
          AND contype   = 'p'
    ) THEN
        ALTER TABLE tat_trip_facts_v2 ADD PRIMARY KEY (trip_key);
    END IF;
END $$;

-- Add indexes for new columns (IF NOT EXISTS is safe to re-run)
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_tracker_start ON tat_trip_facts_v2 (tracker_id, loading_start);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_status        ON tat_trip_facts_v2 (status);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_dest          ON tat_trip_facts_v2 (destination_name);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_terminal      ON tat_trip_facts_v2 (loading_terminal);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_trip_type     ON tat_trip_facts_v2 (trip_type);
CREATE INDEX IF NOT EXISTS idx_tat_facts_v2_closed        ON tat_trip_facts_v2 (trip_closed_at);


-- =============================================================
-- BORDER REFACTOR ADDITIONS (merged from border_refactor_step1+2)
-- trip_state_events typed columns + tat_trip_border_facts_v2 table
-- =============================================================
-- =============================================================
-- TAT V2 BORDER REFACTOR — Step 1
-- Revise trip_state_events to carry typed border columns.
-- Requirement: border identity must NOT live only in event_meta.
-- Run BEFORE: step2 through step7
-- =============================================================

-- ── 1. Add typed columns to trip_state_events ────────────────────────────────

ALTER TABLE trip_state_events
    -- Human-readable name for the tracker (denormalised for easy querying)
    ADD COLUMN IF NOT EXISTS tracker_name        TEXT,
    -- Monotonically increasing trip sequence per tracker (populated post-insert)
    ADD COLUMN IF NOT EXISTS trip_sequence       INTEGER,
    -- Canonical geofence name (promoted from event_meta->>'geofence')
    ADD COLUMN IF NOT EXISTS canonical_name      TEXT,
    -- Geofence master FK (optional; populated when resolution was exact)
    ADD COLUMN IF NOT EXISTS geofence_id         UUID  REFERENCES geofence_master(geofence_id),
    -- Role taxonomy code (promoted from event_meta->>'role')
    ADD COLUMN IF NOT EXISTS role_code           TEXT,
    -- Broad lifecycle stage for the event
    --   loading | transit | destination | returning
    ADD COLUMN IF NOT EXISTS trip_stage          TEXT,
    -- outbound | return | null
    ADD COLUMN IF NOT EXISTS leg_direction       TEXT
        CHECK (leg_direction IN ('outbound','return') OR leg_direction IS NULL),
    -- Specific border crossing node
    --   tunduma | nakonde | kasumbalesa | sakania | mokambo | chembe | kasumulu | other | null
    ADD COLUMN IF NOT EXISTS border_code         TEXT,
    -- Family that groups related borders
    --   tunduma_nakonde | kasumbalesa | sakania | mokambo | chembe | kasumulu | other | null
    ADD COLUMN IF NOT EXISTS border_family       TEXT,
    -- Country code of the border node
    ADD COLUMN IF NOT EXISTS country_code        TEXT,
    -- Source visit UUID from trip_geofence_events_normalized
    ADD COLUMN IF NOT EXISTS source_visit_id     UUID,
    -- Array of source visit IDs when an event was merged from multiple visits
    ADD COLUMN IF NOT EXISTS source_event_ids    UUID[],
    -- event lifecycle: active | superseded
    ADD COLUMN IF NOT EXISTS event_status        TEXT  DEFAULT 'active';


-- ── 2. Indexes for the new queryable columns ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tse_border_code     ON trip_state_events (border_code)
    WHERE border_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tse_leg_direction   ON trip_state_events (leg_direction)
    WHERE leg_direction IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tse_role_code       ON trip_state_events (role_code)
    WHERE role_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tse_trip_stage      ON trip_state_events (trip_stage)
    WHERE trip_stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tse_tracker_name    ON trip_state_events (tracker_name)
    WHERE tracker_name IS NOT NULL;


-- ── 3. Backfill typed columns from existing event_meta ───────────────────────
-- Populates canonical_name and role_code from the JSONB blob for pre-existing
-- rows so that border resolution in step 3 can operate on a clean state.
-- Re-running is safe (WHERE canonical_name IS NULL guard).

UPDATE trip_state_events
SET
    canonical_name = event_meta->>'geofence',
    role_code      = event_meta->>'role'
WHERE canonical_name IS NULL
  AND event_meta IS NOT NULL;


-- ── 4. Helper: resolve_border_code ───────────────────────────────────────────
-- Maps a canonical geofence name to (border_code, border_family, country_code).
-- Pattern matching only — can be replaced with geofence_master lookup later.
-- Marked STABLE (reads data but does not modify; result depends only on input).

CREATE OR REPLACE FUNCTION resolve_border_code(p_canonical_name TEXT)
RETURNS TABLE(border_code TEXT, border_family TEXT, country_code TEXT)
LANGUAGE sql STABLE AS $$
    SELECT
        CASE
            WHEN p_canonical_name ILIKE '%tunduma%'      THEN 'tunduma'
            WHEN p_canonical_name ILIKE '%nakonde%'      THEN 'nakonde'
            WHEN p_canonical_name ILIKE '%kasumbalesa%'  THEN 'kasumbalesa'
            WHEN p_canonical_name ILIKE '%sakania%'      THEN 'sakania'
            WHEN p_canonical_name ILIKE '%mokambo%'      THEN 'mokambo'
            WHEN p_canonical_name ILIKE '%chembe%'       THEN 'chembe'
            WHEN p_canonical_name ILIKE '%kasumulu%'     THEN 'kasumulu'
            ELSE                                              'other'
        END AS border_code,
        CASE
            WHEN p_canonical_name ILIKE '%tunduma%'      THEN 'tunduma_nakonde'
            WHEN p_canonical_name ILIKE '%nakonde%'      THEN 'tunduma_nakonde'
            WHEN p_canonical_name ILIKE '%kasumbalesa%'  THEN 'kasumbalesa'
            WHEN p_canonical_name ILIKE '%sakania%'      THEN 'sakania'
            WHEN p_canonical_name ILIKE '%mokambo%'      THEN 'mokambo'
            WHEN p_canonical_name ILIKE '%chembe%'       THEN 'chembe'
            WHEN p_canonical_name ILIKE '%kasumulu%'     THEN 'kasumulu'
            ELSE                                              'other'
        END AS border_family,
        CASE
            WHEN p_canonical_name ILIKE '%tunduma%'      THEN 'TZ'
            WHEN p_canonical_name ILIKE '%nakonde%'      THEN 'ZM'
            WHEN p_canonical_name ILIKE '%kasumbalesa%'  THEN 'ZM'
            WHEN p_canonical_name ILIKE '%sakania%'      THEN 'DRC'
            WHEN p_canonical_name ILIKE '%mokambo%'      THEN 'ZM'
            WHEN p_canonical_name ILIKE '%chembe%'       THEN 'ZM'
            WHEN p_canonical_name ILIKE '%kasumulu%'     THEN 'TZ'
            ELSE                                              NULL
        END AS country_code
$$;


-- ── 5. Backfill border_code / border_family / country_code for existing rows ──
-- Only affects rows where event_code is a border event AND border_code IS NULL.
-- Inlined CASE expressions (LATERAL not usable when referencing target table).

UPDATE trip_state_events
SET
    border_code = CASE
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%tunduma%'     THEN 'tunduma'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%nakonde%'     THEN 'nakonde'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%sakania%'     THEN 'sakania'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%mokambo%'     THEN 'mokambo'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%chembe%'      THEN 'chembe'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%kasumulu%'    THEN 'kasumulu'
        ELSE 'other'
    END,
    border_family = CASE
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%tunduma%'     THEN 'tunduma_nakonde'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%nakonde%'     THEN 'tunduma_nakonde'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%kasumbalesa%' THEN 'kasumbalesa'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%sakania%'     THEN 'sakania'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%mokambo%'     THEN 'mokambo'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%chembe%'      THEN 'chembe'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%kasumulu%'    THEN 'kasumulu'
        ELSE 'other'
    END,
    country_code = CASE
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%tunduma%'     THEN 'TZ'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%nakonde%'     THEN 'ZM'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%kasumbalesa%' THEN 'ZM'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%sakania%'     THEN 'DRC'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%mokambo%'     THEN 'ZM'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%chembe%'      THEN 'ZM'
        WHEN COALESCE(canonical_name, event_meta->>'geofence') ILIKE '%kasumulu%'    THEN 'TZ'
        ELSE NULL
    END,
    leg_direction = CASE
        WHEN event_code IN ('border_entry','border_exit')               THEN 'outbound'
        WHEN event_code IN ('return_border_entry','return_border_exit') THEN 'return'
    END,
    trip_stage = CASE
        WHEN event_code IN ('border_entry','border_exit')               THEN 'transit'
        WHEN event_code IN ('return_border_entry','return_border_exit') THEN 'returning'
    END
WHERE event_code IN (
    'border_entry','border_exit',
    'return_border_entry','return_border_exit'
)
  AND border_code IS NULL;


-- ── 6. Backfill trip_stage for all non-border events ─────────────────────────

UPDATE trip_state_events
SET trip_stage = CASE
    WHEN event_code IN ('trip_anchor_start','loading_start','loading_end','origin_exit')
        THEN 'loading'
    WHEN event_code IN (
        'corridor_entry',
        'customs_entry','customs_exit',
        'destination_region_entry','destination_region_exit'
    )
        THEN 'transit'
    WHEN event_code IN (
        'destination_entry','destination_exit',
        'customer_entry','customer_exit'
    )
        THEN 'destination'
    WHEN event_code IN (
        'return_leg_start',
        'return_origin_entry',
        'trip_closed'
    )
        THEN 'returning'
    ELSE trip_stage  -- leave border events already set above
END
WHERE event_code NOT IN (
    'border_entry','border_exit',
    'return_border_entry','return_border_exit'
)
  AND trip_stage IS NULL;


-- ── 7. Backfill trip_sequence ─────────────────────────────────────────────────
-- Assigns an ordinal sequence number (1-based, per tracker) to every event,
-- based on the loading_start event order. All events within the same trip_key
-- receive the same sequence number.

WITH seq AS (
    SELECT
        trip_key,
        RANK() OVER (
            PARTITION BY tracker_id
            ORDER BY MIN(event_time)
        ) AS seq_no
    FROM trip_state_events
    WHERE event_code = 'loading_start'
    GROUP BY trip_key, tracker_id
)
UPDATE trip_state_events tse
SET trip_sequence = seq.seq_no
FROM seq
WHERE tse.trip_key = seq.trip_key
  AND tse.trip_sequence IS NULL;

-- =============================================================
-- TAT V2 BORDER REFACTOR — Step 2
-- Create tat_trip_border_facts_v2 — per-border child fact table.
-- This is the canonical store for per-border dwell, direction,
-- and provenance.  tat_trip_facts_v2 summarises from here.
-- Run AFTER: step1
-- Run BEFORE: step4, step5
-- =============================================================

CREATE TABLE IF NOT EXISTS tat_trip_border_facts_v2 (
    -- ── Identity ───────────────────────────────────────────────────────────
    trip_border_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_key         TEXT         NOT NULL,
    tracker_id       INTEGER      NOT NULL,
    tracker_name     TEXT,
    trip_sequence    INTEGER,

    -- ── Border identity ────────────────────────────────────────────────────
    -- border_code is the exact canonical node, e.g. 'tunduma', 'kasumbalesa'
    border_code      TEXT         NOT NULL,
    -- border_name is the human-readable name, e.g. 'TUNDUMA BORDER'
    border_name      TEXT         NOT NULL,
    -- border_family groups related nodes: 'tunduma_nakonde', 'kasumbalesa', …
    border_family    TEXT,
    -- Which country this border node belongs to
    country_code     TEXT,

    -- ── Direction & side ───────────────────────────────────────────────────
    -- outbound = truck travelling toward destination
    -- return   = truck travelling back to origin
    leg_direction    TEXT         NOT NULL
        CHECK (leg_direction IN ('outbound','return')),
    -- optional: which side of the border this record represents
    -- e.g. tz_side, zm_side, drc_side, mw_side
    border_side      TEXT,

    -- ── Timestamps ─────────────────────────────────────────────────────────
    entry_time       TIMESTAMPTZ,
    exit_time        TIMESTAMPTZ,

    -- ── Derived metrics ────────────────────────────────────────────────────
    dwell_hrs        NUMERIC(10,2)
        GENERATED ALWAYS AS (
            CASE
                WHEN entry_time IS NOT NULL AND exit_time IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (exit_time - entry_time))/3600.0, 2)
            END
        ) STORED,

    -- ── Quality / provenance ───────────────────────────────────────────────
    event_confidence   NUMERIC(5,2),
    -- Describes how this border row was constructed:
    --   exact_entry_exit_pair         — matched entry + exit from trip_state_events
    --   inferred_exit_from_next_event — exit inferred from the next downstream event
    --   entry_without_exit            — no exit found within trip window
    --   merged_multi_visit            — multiple visit passes merged into one row
    inference_rule     TEXT,
    -- UUIDs of the trip_state_events rows that sourced this fact
    source_event_ids   UUID[],

    -- ── Audit ──────────────────────────────────────────────────────────────
    created_at         TIMESTAMPTZ  DEFAULT clock_timestamp()
);

-- ── Constraints ───────────────────────────────────────────────────────────────
-- A trip can cross the same border multiple times on the same leg (unusual but
-- possible). Allow multiple rows; uniqueness is NOT enforced here.

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tbf_trip_key
    ON tat_trip_border_facts_v2 (trip_key);

CREATE INDEX IF NOT EXISTS idx_tbf_tracker_entry
    ON tat_trip_border_facts_v2 (tracker_id, entry_time);

CREATE INDEX IF NOT EXISTS idx_tbf_border_direction
    ON tat_trip_border_facts_v2 (border_code, leg_direction);

CREATE INDEX IF NOT EXISTS idx_tbf_border_family
    ON tat_trip_border_facts_v2 (border_family);

CREATE INDEX IF NOT EXISTS idx_tbf_created
    ON tat_trip_border_facts_v2 (created_at);

-- ── RLS (if RLS is enabled on this Supabase project) ─────────────────────────
-- Mirror the same policy pattern as tat_trip_facts_v2.
-- Uncomment and adjust if RLS is enabled:
-- ALTER TABLE tat_trip_border_facts_v2 ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service_role_all" ON tat_trip_border_facts_v2
--     TO service_role USING (true) WITH CHECK (true);

-- ── Quick validation view ─────────────────────────────────────────────────────
-- Returns per-trip border crossing summary. Useful for sanity checks.
CREATE OR REPLACE VIEW v_trip_border_summary AS
SELECT
    trip_key,
    tracker_id,
    tracker_name,
    COUNT(*) FILTER (WHERE leg_direction = 'outbound')     AS outbound_border_count,
    COUNT(*) FILTER (WHERE leg_direction = 'return')       AS return_border_count,
    ROUND(SUM(dwell_hrs) FILTER (WHERE leg_direction = 'outbound'), 2)
                                                           AS outbound_border_total_hrs,
    ROUND(SUM(dwell_hrs) FILTER (WHERE leg_direction = 'return'), 2)
                                                           AS return_border_total_hrs,
    STRING_AGG(DISTINCT border_code, ', ' ORDER BY border_code)
        FILTER (WHERE leg_direction = 'outbound')          AS outbound_borders,
    STRING_AGG(DISTINCT border_code, ', ' ORDER BY border_code)
        FILTER (WHERE leg_direction = 'return')            AS return_borders,
    MIN(entry_time) FILTER (WHERE leg_direction = 'outbound')
                                                           AS first_outbound_entry,
    MAX(exit_time)  FILTER (WHERE leg_direction = 'outbound')
                                                           AS last_outbound_exit,
    MIN(entry_time) FILTER (WHERE leg_direction = 'return')
                                                           AS first_return_entry,
    MAX(exit_time)  FILTER (WHERE leg_direction = 'return')
                                                           AS last_return_exit,
    -- Flag rows missing either entry or exit
    BOOL_OR(entry_time IS NULL)                            AS has_missing_entry,
    BOOL_OR(exit_time  IS NULL)                            AS has_missing_exit
FROM tat_trip_border_facts_v2
GROUP BY trip_key, tracker_id, tracker_name;
