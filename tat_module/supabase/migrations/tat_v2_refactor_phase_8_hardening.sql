-- =============================================================
-- TAT V2 REFACTOR: Phase 8 — Hardening (Dedupe + Validation Gate)
-- Dependency: phase_6_fix.sql, phase_7.sql
--
-- Goals:
--   1) Enforce deterministic dedupe at DB level for QA/exception tables
--   2) Add fail-fast parity validation gate for rebuild verification
-- =============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Dedupe + unique index for tat_data_quality_issues
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
    SELECT
        issue_id,
        ROW_NUMBER() OVER (
            PARTITION BY
                COALESCE(run_id, '00000000-0000-0000-0000-000000000000'::uuid),
                issue_type,
                COALESCE(tracker_id, -1),
                COALESCE(trip_key, ''),
                md5(COALESCE(description, ''))
            ORDER BY created_at, issue_id
        ) AS rn
    FROM tat_data_quality_issues
)
DELETE FROM tat_data_quality_issues dq
USING ranked r
WHERE dq.issue_id = r.issue_id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tat_dq_dedupe
ON tat_data_quality_issues (
    COALESCE(run_id, '00000000-0000-0000-0000-000000000000'::uuid),
    issue_type,
    COALESCE(tracker_id, -1),
    COALESCE(trip_key, ''),
    md5(COALESCE(description, ''))
);


-- ─────────────────────────────────────────────────────────────────────────────
-- B. Dedupe + unique index for tat_trip_exceptions
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
    SELECT
        exception_id,
        ROW_NUMBER() OVER (
            PARTITION BY trip_key, exception_code
            ORDER BY created_at, exception_id
        ) AS rn
    FROM tat_trip_exceptions
    WHERE trip_key IS NOT NULL
)
DELETE FROM tat_trip_exceptions te
USING ranked r
WHERE te.exception_id = r.exception_id
  AND r.rn > 1;

DROP INDEX IF EXISTS idx_tat_trip_exceptions_trip_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tat_trip_exceptions_trip_code
ON tat_trip_exceptions (trip_key, exception_code)
WHERE trip_key IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- C. Fail-fast parity validation gate
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_tat_v2_parity_gate(
    p_start                      TIMESTAMPTZ,
    p_end                        TIMESTAMPTZ,
    p_max_trip_delta_pct         NUMERIC DEFAULT 5.0,
    p_max_significant_drift_pct  NUMERIC DEFAULT 15.0,
    p_max_border_missing_pct     NUMERIC DEFAULT 2.0,
    p_max_chronology_violations  INTEGER DEFAULT 0,
    p_fail_on_breach             BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_v1_trip_count           BIGINT;
    v_v2_trip_count           BIGINT;
    v_trip_delta_pct          NUMERIC;

    v_matched_trip_count      BIGINT;
    v_drift_trip_count        BIGINT;
    v_drift_pct               NUMERIC;

    v_border_trip_count       BIGINT;
    v_missing_border_count    BIGINT;
    v_border_missing_pct      NUMERIC;

    v_chronology_violations   BIGINT;
    v_breach                  BOOLEAN := FALSE;
    v_result                  JSON;
BEGIN
    -- 1) Trip-count parity
    SELECT COUNT(*) INTO v_v1_trip_count
    FROM tat_trips_data
    WHERE loading_start >= p_start
      AND loading_start <  p_end;

    SELECT COUNT(*) INTO v_v2_trip_count
    FROM tat_trip_facts_v2
    WHERE loading_start >= p_start
      AND loading_start <  p_end;

    v_trip_delta_pct :=
        CASE
            WHEN v_v1_trip_count = 0 THEN
                CASE WHEN v_v2_trip_count = 0 THEN 0 ELSE 100 END
            ELSE ROUND(ABS(v_v2_trip_count - v_v1_trip_count) * 100.0 / v_v1_trip_count, 2)
        END;

    -- 2) Per-trip significant drift rate (from parity view)
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE has_significant_drift)
    INTO v_matched_trip_count, v_drift_trip_count
    FROM v_tat_v1_v2_parity_durations
    WHERE loading_start >= p_start
      AND loading_start <  p_end;

    v_drift_pct :=
        CASE
            WHEN v_matched_trip_count = 0 THEN 0
            ELSE ROUND(v_drift_trip_count * 100.0 / v_matched_trip_count, 2)
        END;

    -- 3) Border-facts coverage
    SELECT
        COUNT(*) FILTER (WHERE f.has_border_event),
        COUNT(*) FILTER (
            WHERE f.has_border_event
              AND NOT EXISTS (
                  SELECT 1
                  FROM tat_trip_border_facts_v2 bf
                  WHERE bf.trip_key = f.trip_key
              )
        )
    INTO v_border_trip_count, v_missing_border_count
    FROM tat_trip_facts_v2 f
    WHERE f.loading_start >= p_start
      AND f.loading_start <  p_end;

    v_border_missing_pct :=
        CASE
            WHEN v_border_trip_count = 0 THEN 0
            ELSE ROUND(v_missing_border_count * 100.0 / v_border_trip_count, 2)
        END;

    -- 4) Event chronology violations
    SELECT COUNT(*) INTO v_chronology_violations
    FROM v_trip_event_chronology_qa
    WHERE loading_start >= p_start
      AND loading_start <  p_end;

    v_breach :=
        (v_trip_delta_pct         > p_max_trip_delta_pct)
        OR (v_drift_pct           > p_max_significant_drift_pct)
        OR (v_border_missing_pct  > p_max_border_missing_pct)
        OR (v_chronology_violations > p_max_chronology_violations);

    v_result := json_build_object(
        'range', json_build_object('start', p_start, 'end', p_end),
        'thresholds', json_build_object(
            'max_trip_delta_pct',        p_max_trip_delta_pct,
            'max_significant_drift_pct', p_max_significant_drift_pct,
            'max_border_missing_pct',    p_max_border_missing_pct,
            'max_chronology_violations', p_max_chronology_violations
        ),
        'metrics', json_build_object(
            'v1_trip_count',            v_v1_trip_count,
            'v2_trip_count',            v_v2_trip_count,
            'trip_delta_pct',           v_trip_delta_pct,
            'matched_trip_count',       v_matched_trip_count,
            'significant_drift_count',  v_drift_trip_count,
            'significant_drift_pct',    v_drift_pct,
            'border_trip_count',        v_border_trip_count,
            'missing_border_count',     v_missing_border_count,
            'missing_border_pct',       v_border_missing_pct,
            'chronology_violations',    v_chronology_violations
        ),
        'pass', NOT v_breach
    );

    IF v_breach AND p_fail_on_breach THEN
        RAISE EXCEPTION 'TAT V2 parity gate failed: %', v_result::TEXT;
    END IF;

    RETURN v_result;
END $$;
