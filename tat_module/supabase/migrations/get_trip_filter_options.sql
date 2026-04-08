-- =============================================================
-- R2: Batched filter metadata function
-- Replaces 3 full-table-scan REST queries with 1 RPC call.
--
-- Each sub-query uses DISTINCT ON or GROUP BY so Postgres only
-- materialises the small set of unique values — no full row
-- payload is shipped over the wire.
--
-- trip_count on vehicles lets the UI show "Vehicle Name (42 trips)"
-- in the dropdown at zero extra cost.
-- =============================================================

CREATE OR REPLACE FUNCTION get_trip_filter_options()
RETURNS JSON
LANGUAGE sql
STABLE          -- result can be cached within a single transaction
PARALLEL SAFE   -- safe to run in parallel query plans
AS $$
SELECT json_build_object(

    -- ── 1. Distinct loading terminals, alphabetical ──────────────────────
    'origins', (
        SELECT COALESCE(json_agg(loading_terminal ORDER BY loading_terminal), '[]'::json)
        FROM (
            SELECT DISTINCT loading_terminal
            FROM   tat_trips_data
            WHERE  loading_terminal IS NOT NULL
        ) o
    ),

    -- ── 2. Distinct destination names, alphabetical ──────────────────────
    'destinations', (
        SELECT COALESCE(json_agg(dest_name ORDER BY dest_name), '[]'::json)
        FROM (
            SELECT DISTINCT dest_name
            FROM   tat_trips_data
            WHERE  dest_name IS NOT NULL
        ) d
    ),

    -- ── 3. Vehicles: one row per tracker_id, sorted by name.
    --       trip_count gives the UI an optional "(N trips)" suffix. ────────
    'vehicles', (
        SELECT COALESCE(
            json_agg(
                json_build_object(
                    'tracker_id',   tracker_id,
                    'tracker_name', tracker_name,
                    'trip_count',   trip_count
                )
                ORDER BY tracker_name
            ),
            '[]'::json
        )
        FROM (
            SELECT
                tracker_id,
                -- Use the most recent name in case a vehicle was renamed
                (ARRAY_AGG(tracker_name ORDER BY loading_entry DESC))[1] AS tracker_name,
                COUNT(*)                                                   AS trip_count
            FROM   tat_trips_data
            WHERE  tracker_id IS NOT NULL
              AND  tracker_name IS NOT NULL
            GROUP BY tracker_id
        ) v
    )
);
$$;

-- Optional: grant execute to the anon/authenticated roles used by your
-- Supabase client (adjust role names to match your project).
-- GRANT EXECUTE ON FUNCTION get_trip_filter_options() TO anon;
-- GRANT EXECUTE ON FUNCTION get_trip_filter_options() TO authenticated;