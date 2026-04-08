#!/usr/bin/env node
// rebuild_tat_v2_phase20.js
//
// Rebuilds TAT V2 with Phase 20 state-machine logic using Supabase Management API.
//
// Usage:
//   node rebuild_tat_v2_phase20.js
//   node rebuild_tat_v2_phase20.js --start 2025-10-01T00:00:00+00:00 --end 2026-04-02T00:00:00+00:00
//   node rebuild_tat_v2_phase20.js --tracker-id 3073943 --start 2026-02-01T00:00:00+00:00 --end 2026-04-02T00:00:00+00:00
//   node rebuild_tat_v2_phase20.js --chunk-days 14 --http-retries 3
//   node rebuild_tat_v2_phase20.js --skip-normalize
//   node rebuild_tat_v2_phase20.js --skip-sequence
//   node rebuild_tat_v2_phase20.js --dry-run

require('dotenv').config({ path: '.env.local' });

const DEFAULT_START = '2025-10-01T00:00:00+00:00';
const DEFAULT_END = '2026-04-02T00:00:00+00:00';
const DEFAULT_CHUNK_DAYS = 30;
const DEFAULT_HTTP_RETRIES = 2;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local');
  process.exit(1);
}
if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(1);
}

const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
if (!projectRef) {
  console.error('Unable to parse project ref from NEXT_PUBLIC_SUPABASE_URL');
  process.exit(1);
}

const args = process.argv.slice(2);

function hasFlag(flag) {
  return args.includes(flag);
}

function getFlagValue(flag) {
  const byEquals = args.find((a) => a.startsWith(`${flag}=`));
  if (byEquals) return byEquals.split('=').slice(1).join('=');

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

function parseTrackerId(raw) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --tracker-id: ${raw}. Expected positive integer.`);
  }
  return n;
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
  return iso.slice(0, 19).replace('T', ' ');
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
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('http 429') ||
    msg.includes('http 502') ||
    msg.includes('http 503') ||
    msg.includes('http 504') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('abort')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSql(sql, timeoutMs = 10 * 60 * 1000) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
      const waitMs = 1500 * attempt;
      console.warn(`  ⚠ Retry ${attempt}/${retries} for ${context} in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function sqlTs(v) {
  return `'${String(v).replace(/'/g, "''")}'::timestamptz`;
}

function sqlTrackerArg(trackerId) {
  return trackerId == null ? 'NULL' : String(trackerId);
}

async function main() {
  const startIso = toIso(getFlagValue('--start'), DEFAULT_START, '--start');
  const endIso = toIso(getFlagValue('--end'), DEFAULT_END, '--end');
  if (new Date(startIso) >= new Date(endIso)) {
    throw new Error(`Invalid range: --start (${startIso}) must be before --end (${endIso}).`);
  }

  const trackerId = parseTrackerId(getFlagValue('--tracker-id'));
  const chunkDays = parsePositiveInt(getFlagValue('--chunk-days'), DEFAULT_CHUNK_DAYS, '--chunk-days');
  const retries = parsePositiveInt(getFlagValue('--http-retries'), DEFAULT_HTTP_RETRIES, '--http-retries');
  const dryRun = hasFlag('--dry-run');
  const skipNormalize = hasFlag('--skip-normalize');
  const skipSequence = hasFlag('--skip-sequence');

  const chunks = buildChunks(startIso, endIso, chunkDays);
  const trackerArg = sqlTrackerArg(trackerId);

  console.log(`Project: ${projectRef}`);
  console.log(`Window: ${label(startIso)} -> ${label(endIso)}`);
  console.log(`Chunks: ${chunks.length} (chunk_days=${chunkDays})`);
  console.log(`Tracker filter: ${trackerId == null ? 'ALL' : trackerId}`);
  console.log(`Skip normalize: ${skipNormalize ? 'yes' : 'no'}`);
  console.log(`Skip trip sequence backfill: ${skipSequence ? 'yes' : 'no'}`);
  if (dryRun) {
    console.log('Dry run only. No SQL executed.');
    return;
  }

  const started = Date.now();

  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    console.log(`\n[Chunk ${i + 1}/${chunks.length}] ${label(c.start)} -> ${label(c.end)}`);

    if (!skipNormalize) {
      console.log('  1) refresh_trip_geofence_events_normalized');
      await runSqlWithRetries(
        `SELECT refresh_trip_geofence_events_normalized(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${trackerArg});`,
        retries,
        12 * 60 * 1000,
        'phase2 normalize'
      );
    } else {
      console.log('  1) refresh_trip_geofence_events_normalized (skipped)');
    }

    console.log('  2) build_trip_state_events_v2 (Phase 20 state machine)');
    await runSqlWithRetries(
      `SELECT build_trip_state_events_v2(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${trackerArg});`,
      retries,
      12 * 60 * 1000,
      'phase3 state events'
    );

    console.log('  3) build_tat_trip_border_facts_v2');
    await runSqlWithRetries(
      `SELECT build_tat_trip_border_facts_v2(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${trackerArg});`,
      retries,
      12 * 60 * 1000,
      'border facts'
    );

    console.log('  4) build_tat_trip_facts_v2');
    await runSqlWithRetries(
      `SELECT build_tat_trip_facts_v2(${sqlTs(c.start)}, ${sqlTs(c.end)}, ${trackerArg});`,
      retries,
      12 * 60 * 1000,
      'trip facts'
    );
  }

  if (!skipSequence) {
    console.log('\n5) backfill_trip_sequence_v2');
    await runSqlWithRetries(
      'SELECT backfill_trip_sequence_v2();',
      retries,
      10 * 60 * 1000,
      'trip sequence backfill'
    );
  }

  console.log('\n6) Counts snapshot');
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
    'count snapshot'
  );
  console.log(JSON.stringify(counts, null, 2));

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nDone. Rebuild completed in ${elapsed}s.`);
}

main().catch((err) => {
  console.error('\nRebuild failed:', err?.message || err);
  process.exit(1);
});

