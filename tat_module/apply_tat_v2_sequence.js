#!/usr/bin/env node
// apply_tat_v2_sequence.js
// Applies TAT V2 migrations in dependency order via Supabase Management API.
//
// Usage:
//   node apply_tat_v2_sequence.js
//   node apply_tat_v2_sequence.js --dry-run
//   node apply_tat_v2_sequence.js --from tat_v2_refactor_phase_3_fix.sql
//   node apply_tat_v2_sequence.js --to tat_v2_refactor_phase_4_fix.sql
//   node apply_tat_v2_sequence.js --allow-full-sequence
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
//   SUPABASE_ACCESS_TOKEN=sbp_xxx

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");

const MIGRATION_SEQUENCE = [
  "supabase/migrations/tat_v2_refactor_core.sql",
  "supabase/migrations/tat_v2_refactor_tables.sql",
  "supabase/migrations/tat_v2_refactor_seed.sql",
  "supabase/migrations/tat_v2_refactor_seed_extended.sql",
  "supabase/migrations/tat_v2_refactor_phase_2.sql",
  "supabase/migrations/tat_v2_refactor_phase_2_fix.sql",
  "supabase/migrations/tat_v2_refactor_tables_patch.sql",
  "supabase/migrations/tat_v2_refactor_phase_3_fix.sql",
  "supabase/migrations/tat_v2_backfill_trip_sequence.sql",
  "supabase/migrations/tat_v2_refactor_phase_4_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_5.sql",
  "supabase/migrations/tat_v2_refactor_phase_6_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_7.sql",
  "supabase/migrations/tat_v2_refactor_phase_8_hardening.sql",
  "supabase/migrations/tat_v2_refactor_phase_9_normalized_dedupe.sql",
  "supabase/migrations/tat_v2_refactor_phase_10_phase2_conflict_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_11_phase3_session_overlap_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_12_phase3_dar_anchor_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_13_trip_sequence_compat.sql",
  "supabase/migrations/tat_v2_refactor_phase_14_trip_details_timeout_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_15_uncovered_trip_summary.sql",
  "supabase/migrations/tat_v2_refactor_phase_16_uncovered_summary_fast.sql",
  "supabase/migrations/tat_v2_refactor_phase_17_uncovered_edge_buffer_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_18_operational_role_resolution.sql",
  "supabase/migrations/tat_v2_refactor_phase_19_stop_state_event_driven_uncovered.sql",
  "supabase/migrations/tat_v2_refactor_phase_20_stop_state_state_machine.sql",
  "supabase/migrations/tat_v2_refactor_phase_21_remove_visit_gap_logic.sql",
  "supabase/migrations/tat_v2_refactor_phase_22_ops_waiting_stage.sql",
  "supabase/migrations/tat_v2_refactor_phase_23_persist_stop_state.sql",
  "supabase/migrations/tat_v2_refactor_phase_24_dar_origin_region_presence.sql",
  "supabase/migrations/tat_v2_refactor_phase_25_origin_region_ops_alignment.sql",
  "supabase/migrations/tat_v2_refactor_phase_26_operational_stop_rename.sql",
  "supabase/migrations/tat_v2_refactor_phase_27_operational_stop_backfill_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_28_daily_split_stitching.sql",
  "supabase/migrations/tat_v2_refactor_phase_29_strict_stop_state_mode.sql",
  "supabase/migrations/tat_v2_refactor_phase_30_midnight_continuity_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_31_unfiltered_operational_stream.sql",
  "supabase/migrations/tat_v2_refactor_phase_32_transition_policy_versioning_lineage.sql",
  "supabase/migrations/tat_v2_refactor_phase_33_state_events_rebuild_perf.sql",
  "supabase/migrations/tat_v2_refactor_phase_34_state_machine_lookahead_tuning.sql",
  "supabase/migrations/tat_v2_refactor_phase_35_strict_transition_enforcement.sql",
  "supabase/migrations/tat_v2_refactor_phase_36_return_origin_semantics_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_37_return_origin_hotfix.sql",
  "supabase/migrations/tat_v2_refactor_phase_38_return_origin_hotfix2.sql",
  "supabase/migrations/tat_v2_refactor_phase_39_anchor_from_previous_return_origin.sql",
  "supabase/migrations/tat_v2_refactor_phase_40_anchor_origin_hardening.sql",
  "supabase/migrations/tat_v2_refactor_phase_41_chunk_safe_reanchor.sql",
  "supabase/migrations/tat_v2_refactor_phase_42_chunk_safe_reanchor_hotfix.sql",
  "supabase/migrations/tat_v2_refactor_phase_43_reanchor_chunk_gate_removal.sql",
  "supabase/migrations/tat_v2_refactor_phase_44_reanchor_once_guard.sql",
  "supabase/migrations/tat_v2_refactor_phase_45_origin_hierarchy_master.sql",
  "supabase/migrations/tat_v2_refactor_phase_46_pretransit_split_metrics.sql",
  "supabase/migrations/tat_v2_refactor_phase_47_pretransit_union_fix.sql",
  "supabase/migrations/tat_v2_refactor_phase_48_return_origin_transition_guard.sql",
  "supabase/migrations/tat_v2_refactor_phase_49_return_origin_post_progression.sql",
  "supabase/migrations/tat_v2_refactor_phase_50_dar_arrival_prev_closure_clamp.sql",
  "supabase/migrations/tat_v2_refactor_phase_51_pretransit_metrics_use_effective_dar.sql",
  "supabase/migrations/tat_v2_refactor_phase_52_origin_exit_zone_fallback.sql",
  "supabase/migrations/tat_v2_refactor_phase_54_border_episode_split.sql",
  "supabase/migrations/tat_v2_refactor_phase_61_dynamic_intelligence.sql",
  "supabase/migrations/tat_v2_refactor_phase_61_1_cleanup_overloads.sql",
  "supabase/migrations/tat_v2_refactor_phase_62_midnight_split_guard.sql",
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allowFullSequence = args.includes("--allow-full-sequence");

function getFlagValue(flag) {
  const equalsArg = args.find((a) => a.startsWith(`${flag}=`));
  if (equalsArg) return equalsArg.split("=")[1];
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

function resolveBoundaryIndex(files, value) {
  if (!value) return -1;
  const normalized = value.replace(/^\.\//, "");
  const byExact = files.findIndex((f) => f === normalized);
  if (byExact !== -1) return byExact;
  const byBase = files.findIndex((f) => path.basename(f) === path.basename(normalized));
  return byBase;
}

function filterSequence(files) {
  const from = getFlagValue("--from");
  const to = getFlagValue("--to");

  let startIdx = 0;
  let endIdx = files.length - 1;

  if (from) {
    const idx = resolveBoundaryIndex(files, from);
    if (idx === -1) {
      throw new Error(`--from not found in sequence: ${from}`);
    }
    startIdx = idx;
  }

  if (to) {
    const idx = resolveBoundaryIndex(files, to);
    if (idx === -1) {
      throw new Error(`--to not found in sequence: ${to}`);
    }
    endIdx = idx;
  }

  if (startIdx > endIdx) {
    throw new Error(`Invalid range: --from (${from}) is after --to (${to})`);
  }

  return files.slice(startIdx, endIdx + 1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!ACCESS_TOKEN) {
  console.error("Missing SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];
if (!projectRef || projectRef.length < 3) {
  console.error("Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL:", SUPABASE_URL);
  process.exit(1);
}

async function runSql(sql, timeoutMs = 10 * 60 * 1000) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const result = await res.json();
  if (result.error) {
    throw new Error(result.error.message || JSON.stringify(result.error));
  }
}

async function main() {
  const sequence = filterSequence(MIGRATION_SEQUENCE);
  const from = getFlagValue("--from");
  const to = getFlagValue("--to");
  const selectingFullRange = !from && !to && sequence.length === MIGRATION_SEQUENCE.length;

  if (selectingFullRange && !dryRun && !allowFullSequence) {
    throw new Error(
      "Safety guard: refusing to apply full TAT V2 sequence without explicit consent.\n" +
      "Use --from/--to to target specific migration(s), or pass --allow-full-sequence if you truly intend a full run."
    );
  }

  for (const relPath of sequence) {
    if (!fs.existsSync(relPath)) {
      throw new Error(`Migration file not found: ${relPath}`);
    }
  }

  console.log(`Project: ${projectRef}`);
  console.log(`Migrations to apply: ${sequence.length}`);
  if (selectingFullRange) {
    console.log(`Safety mode: full sequence selected (${allowFullSequence ? "override enabled" : "guarded"})`);
  }
  sequence.forEach((m, i) => {
    console.log(`  ${String(i + 1).padStart(2, "0")}. ${m}`);
  });

  if (dryRun) {
    console.log("Dry run only. No migrations executed.");
    return;
  }

  const startedAt = Date.now();
  for (let i = 0; i < sequence.length; i += 1) {
    const relPath = sequence[i];
    const sql = fs.readFileSync(relPath, "utf8");
    console.log(`\n[${i + 1}/${sequence.length}] Applying ${relPath} (${Math.round(sql.length / 1024)} KB)`);
    await runSql(sql);
    console.log("  Applied");
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone. Applied ${sequence.length} migration(s) in ${elapsedSec}s.`);
}

main().catch((err) => {
  console.error("\nMigration sequence failed:", err.message);
  process.exit(1);
});
