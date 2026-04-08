#!/usr/bin/env node
// rebuild_tat_v2_all_trackers_scoped.js
//
// Tracker-scoped rebuild runner for TAT V2.
// Runs the same pipeline as rebuild_tat_v2_phase20.js, but iterates tracker-by-tracker.
//
// Usage:
//   node rebuild_tat_v2_all_trackers_scoped.js
//   node rebuild_tat_v2_all_trackers_scoped.js --start 2025-10-01T00:00:00+00:00 --end 2026-04-02T00:00:00+00:00
//   node rebuild_tat_v2_all_trackers_scoped.js --tracker-id 3073943
//   node rebuild_tat_v2_all_trackers_scoped.js --tracker-ids 3073943,3074001
//   node rebuild_tat_v2_all_trackers_scoped.js --chunk-days 30 --http-retries 2
//   node rebuild_tat_v2_all_trackers_scoped.js --kill-existing
//   node rebuild_tat_v2_all_trackers_scoped.js --skip-normalize
//   node rebuild_tat_v2_all_trackers_scoped.js --skip-sequence
//   node rebuild_tat_v2_all_trackers_scoped.js --dry-run

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const { execSync } = require("child_process");

const DEFAULT_START = "2025-10-01T00:00:00+00:00";
const DEFAULT_END = "2026-04-05T00:00:00+00:00";
const DEFAULT_CHUNK_DAYS = 1000;
const DEFAULT_HTTP_RETRIES = 2;
const LOCK_FILE = "/tmp/rebuild_tat_v2_all_trackers_scoped.lock";

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
if (!projectRef) {
  console.error("Unable to parse project ref from NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}

const args = process.argv.slice(2);

function hasFlag(flag) {
  return args.includes(flag);
}

function getFlagValue(flag) {
  const byEquals = args.find((a) => a.startsWith(`${flag}=`));
  if (byEquals) return byEquals.split("=").slice(1).join("=");
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return null;
}

function parsePositiveInt(raw, fallback, name) {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${name}: ${raw}. Expected positive integer.`);
  }
  return n;
}

function parseTrackerId(raw, name = "--tracker-id") {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${name}: ${raw}. Expected positive integer.`);
  }
  return n;
}

function parseTrackerIds(raw) {
  if (!raw) return [];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => parseTrackerId(v, "--tracker-ids"));
  return Array.from(new Set(list)).sort((a, b) => a - b);
}

function toIso(raw, fallback, name) {
  const v = raw || fallback;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${name}: ${v}. Must be a valid ISO timestamp.`);
  }
  return d.toISOString();
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function clampIso(iso, maxIso) {
  return new Date(iso) > new Date(maxIso) ? maxIso : iso;
}

function label(iso) {
  return iso.slice(0, 19).replace("T", " ");
}

function buildChunks(startIso, endIso, chunkDays) {
  const chunks = [];
  let cur = startIso;
  while (new Date(cur) < new Date(endIso)) {
    const next = clampIso(addDays(cur, chunkDays), endIso);
    chunks.push({ start: cur, end: next });
    cur = next;
  }
  return chunks;
}

function isRetryableError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("http 429") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("abort")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminatePid(pid, reason) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return true;
  if (!isPidAlive(pid)) return true;

  console.log(`Stopping process ${pid}${reason ? ` (${reason})` : ""}...`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !isPidAlive(pid);
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(300);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !isPidAlive(pid);
  }
  await sleep(300);
  return !isPidAlive(pid);
}

function readLockPid() {
  if (!fs.existsSync(LOCK_FILE)) return null;
  try {
    const raw = fs.readFileSync(LOCK_FILE, "utf8").trim();
    const parsed = JSON.parse(raw);
    const pid = Number(parsed?.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeLockFile() {
  const payload = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    argv: process.argv.slice(1),
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(payload), "utf8");
}

function removeLockFile() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return;
    const lockPid = readLockPid();
    if (lockPid === null || lockPid === process.pid || !isPidAlive(lockPid)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // best-effort cleanup
  }
}

function listRebuildPids() {
  const patterns = ["rebuild_tat_v2_all_trackers_scoped.js", "rebuild_tat_v2_phase20.js"];
  const pids = new Set();

  for (const pattern of patterns) {
    try {
      const out = execSync(`pgrep -f '${pattern}' || true`, { encoding: "utf8" });
      out
        .split(/\s+/)
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
        .forEach((n) => pids.add(n));
    } catch {
      // ignore process scan failures
    }
  }

  pids.delete(process.pid);
  return Array.from(pids).sort((a, b) => a - b);
}

async function prepareProcessGuard(killExisting) {
  const lockPid = readLockPid();

  if (lockPid && lockPid !== process.pid && isPidAlive(lockPid)) {
    if (!killExisting) {
      throw new Error(
        `Another rebuild process is running (pid ${lockPid}). ` +
        `Re-run with --kill-existing to terminate it first.`
      );
    }
    const stopped = await terminatePid(lockPid, "lock holder");
    if (!stopped) {
      throw new Error(`Could not stop existing locked rebuild process pid ${lockPid}.`);
    }
  }

  if (killExisting) {
    const pids = listRebuildPids().filter((p) => p !== lockPid);
    for (const pid of pids) {
      await terminatePid(pid, "existing rebuild");
    }
  } else {
    const pids = listRebuildPids();
    if (pids.length > 0) {
      throw new Error(
        `Another rebuild process appears active (pids ${pids.join(", ")}). ` +
        `Re-run with --kill-existing to terminate existing rebuilds first.`
      );
    }
  }

  removeLockFile();
  writeLockFile();

  const cleanup = () => removeLockFile();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
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

  const bodyText = await res.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${bodyText}`);
  }
  if (parsed && parsed.error) {
    const message = parsed.error.message || JSON.stringify(parsed.error);
    throw new Error(message);
  }
  return parsed;
}

async function runSqlWithRetries(sql, retries, timeoutMs, context) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await runSql(sql, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt > retries) throw err;
      const isRateLimit = String(err?.message || "").includes("429");
      const waitMs = isRateLimit 
          ? Math.min(45000, 7000 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 2000)
          : 3000 * attempt;
      console.warn(`  ⚠ Retry ${attempt}/${retries} for ${context} in ${Math.round(waitMs / 1000)}s${isRateLimit ? " (Rate Limit)" : ""}`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function sqlTs(v) {
  return `'${String(v).replace(/'/g, "''")}'::timestamptz`;
}

async function fetchTrackerIds(startIso, endIso, retries, trackerId, trackerIds) {
  if (trackerId != null) return [trackerId];
  if (trackerIds.length > 0) return trackerIds;

  const sql = `
    SELECT DISTINCT tracker_id
    FROM trip_geofence_events_normalized
    WHERE tracker_id IS NOT NULL
      AND in_time >= ${sqlTs(startIso)}
      AND in_time < ${sqlTs(endIso)}
    ORDER BY tracker_id;
  `;
  const rows = await runSqlWithRetries(sql, retries, 3 * 60 * 1000, "fetch tracker ids");
  return rows.map((r) => Number(r.tracker_id)).filter((n) => Number.isInteger(n) && n > 0);
}

async function main() {
  const startIso = toIso(getFlagValue("--start"), DEFAULT_START, "--start");
  const endIso = toIso(getFlagValue("--end"), DEFAULT_END, "--end");
  if (new Date(startIso) >= new Date(endIso)) {
    throw new Error(`Invalid range: --start (${startIso}) must be before --end (${endIso}).`);
  }

  const trackerId = parseTrackerId(getFlagValue("--tracker-id"));
  const trackerIds = parseTrackerIds(getFlagValue("--tracker-ids"));
  const chunkDays = parsePositiveInt(getFlagValue("--chunk-days"), DEFAULT_CHUNK_DAYS, "--chunk-days");
  const retries = parsePositiveInt(getFlagValue("--http-retries"), DEFAULT_HTTP_RETRIES, "--http-retries");
  const concurrency = parsePositiveInt(getFlagValue("--concurrency"), 1, "--concurrency");
  const dryRun = hasFlag("--dry-run");
  const killExisting = hasFlag("--kill-existing");
  const skipNormalize = hasFlag("--skip-normalize");
  const skipSequence = hasFlag("--skip-sequence");
  if (trackerId != null && trackerIds.length > 0) {
    throw new Error("Use either --tracker-id or --tracker-ids, not both.");
  }

  const chunks = buildChunks(startIso, endIso, chunkDays);
  const resolvedTrackerIds = await fetchTrackerIds(startIso, endIso, retries, trackerId, trackerIds);

  console.log(`Project: ${projectRef}`);
  console.log(`Window: ${label(startIso)} -> ${label(endIso)}`);
  console.log(`Chunks: ${chunks.length} (chunk_days=${chunkDays})`);
  console.log(`Trackers: ${resolvedTrackerIds.length}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Kill existing: ${killExisting ? "yes" : "no"}`);
  console.log(`Skip normalize: ${skipNormalize ? "yes" : "no"}`);
  console.log(`Skip trip sequence backfill: ${skipSequence ? "yes" : "no"}`);
  if (dryRun) {
    console.log("Dry run only. No SQL executed.");
    return;
  }

  await prepareProcessGuard(killExisting);

  if (resolvedTrackerIds.length === 0) {
    console.log("No trackers found in selected window. Nothing to rebuild.");
    return;
  }

  const started = Date.now();

  // Process trackers in batches of 'concurrency'
  for (let t = 0; t < resolvedTrackerIds.length; t += concurrency) {
    const batch = resolvedTrackerIds.slice(t, t + concurrency);
    const batchNum = Math.floor(t / concurrency) + 1;
    const totalBatches = Math.ceil(resolvedTrackerIds.length / concurrency);

    console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing trackers: ${batch.join(", ")}`);

    await Promise.all(batch.map(async (tid) => {
      for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i];
        const logPrefix = `    [${tid}][Chunk ${i + 1}/${chunks.length}]`;

        if (!skipNormalize) {
          console.log(`${logPrefix} 1) normalize`);
          await runSqlWithRetries(
            `SELECT refresh_trip_geofence_events_normalized(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${tid});`,
            retries,
            12 * 60 * 1000,
            `normalize t=${tid}`
          );
        }

        console.log(`${logPrefix} 2) state events`);
        await runSqlWithRetries(
          `SELECT build_trip_state_events_v2(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${tid});`,
          retries,
          12 * 60 * 1000,
          `state events t=${tid}`
        );

        console.log(`${logPrefix} 3) border facts`);
        await runSqlWithRetries(
          `SELECT build_tat_trip_border_facts_v2(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${tid});`,
          retries,
          12 * 60 * 1000,
          `border facts t=${tid}`
        );

        console.log(`${logPrefix} 4) trip facts`);
        await runSqlWithRetries(
          `SELECT build_tat_trip_facts_v2(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${tid});`,
          retries,
          12 * 60 * 1000,
          `trip facts t=${tid}`
        );
      }
    }));
  }

  if (!skipSequence) {
    console.log("\n5) backfill_trip_sequence_v2");
    await runSqlWithRetries(
      "SELECT backfill_trip_sequence_v2();",
      retries,
      10 * 60 * 1000,
      "trip sequence backfill"
    );
  }

  console.log("\n6) Counts snapshot");
  const counts = await runSqlWithRetries(
    `
    SELECT 'trip_geofence_events_normalized' AS t, COUNT(*)::bigint AS count FROM trip_geofence_events_normalized
    UNION ALL
    SELECT 'trip_state_events' AS t, COUNT(*)::bigint AS count FROM trip_state_events
    UNION ALL
    SELECT 'tat_trip_border_facts_v2' AS t, COUNT(*)::bigint AS count FROM tat_trip_border_facts_v2
    UNION ALL
    SELECT 'tat_trip_facts_v2' AS t, COUNT(*)::bigint AS count FROM tat_trip_facts_v2;
    `,
    retries,
    3 * 60 * 1000,
    "count snapshot"
  );
  console.log(JSON.stringify(counts, null, 2));

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nDone. Tracker-scoped rebuild completed in ${elapsed}s.`);
}

main().catch((err) => {
  console.error("\nRebuild failed:", err?.message || err);
  process.exit(1);
});
