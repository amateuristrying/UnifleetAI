#!/usr/bin/env node
// export_tat_trip_key_details.js
// Exports one CSV file with trip-level TAT key details across all trip types.

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const DEFAULT_START = '2025-10-01T00:00:00+00:00';
const DEFAULT_END = '2026-03-22T00:00:00+00:00';
const DEFAULT_PAGE_SIZE = 2000;
const DEFAULT_OUT = `exports/tat_trip_key_details_${DEFAULT_START.slice(0, 10)}_${DEFAULT_END.slice(0, 10)}.csv`;

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

function getFlagValue(args, flag) {
  const equalsArg = args.find(a => a.startsWith(`${flag}=`));
  if (equalsArg) return equalsArg.split('=').slice(1).join('=');
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

function parsePositiveInt(value, fallback, flagName) {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${flagName}: ${value}. Must be a positive integer.`);
  }
  return n;
}

function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.result)) return result.result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function csvValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sqlStringLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const payload = await res.json();
  if (payload?.error) {
    throw new Error(payload.error.message || JSON.stringify(payload.error));
  }

  return extractRows(payload);
}

function buildQuery(startTs, endTs, limit, offset) {
  return `
WITH border_rollup AS (
  SELECT
    bf.trip_key,
    COUNT(*) FILTER (WHERE bf.leg_direction = 'outbound') AS outbound_border_count_actual,
    COUNT(*) FILTER (WHERE bf.leg_direction = 'return')   AS return_border_count_actual,
    ROUND(SUM(bf.dwell_hrs) FILTER (WHERE bf.leg_direction = 'outbound'), 2) AS outbound_border_total_hrs_actual,
    ROUND(SUM(bf.dwell_hrs) FILTER (WHERE bf.leg_direction = 'return'), 2)   AS return_border_total_hrs_actual,
    MIN(bf.entry_time) FILTER (WHERE bf.leg_direction = 'outbound') AS outbound_first_border_entry,
    MAX(bf.exit_time)  FILTER (WHERE bf.leg_direction = 'outbound') AS outbound_last_border_exit,
    MIN(bf.entry_time) FILTER (WHERE bf.leg_direction = 'return')   AS return_first_border_entry,
    MAX(bf.exit_time)  FILTER (WHERE bf.leg_direction = 'return')   AS return_last_border_exit,
    STRING_AGG(DISTINCT bf.border_code, ' > ' ORDER BY bf.border_code)
      FILTER (WHERE bf.leg_direction = 'outbound') AS border_route_outbound,
    STRING_AGG(DISTINCT bf.border_code, ' > ' ORDER BY bf.border_code)
      FILTER (WHERE bf.leg_direction = 'return') AS border_route_return,
    COUNT(*) FILTER (WHERE bf.exit_time IS NULL) AS open_border_rows
  FROM tat_trip_border_facts_v2 bf
  GROUP BY bf.trip_key
),
exception_rollup AS (
  SELECT
    te.trip_key,
    COUNT(*) AS exception_count,
    STRING_AGG(DISTINCT te.exception_code, ';' ORDER BY te.exception_code) AS exception_codes
  FROM tat_trip_exceptions te
  WHERE te.trip_key IS NOT NULL
  GROUP BY te.trip_key
)
SELECT
  f.trip_key,
  f.tracker_id,
  f.tracker_name,
  f.trip_type,
  f.status,
  f.closure_reason,
  f.lifecycle_confidence,

  f.loading_terminal,
  f.origin_region,
  f.destination_name,
  f.customer_name,

  f.dar_arrival,
  f.loading_start,
  f.loading_end,
  f.origin_exit,

  br.outbound_first_border_entry,
  br.outbound_last_border_exit,
  br.border_route_outbound,
  COALESCE(br.outbound_border_count_actual, f.outbound_border_count, 0) AS outbound_border_count,
  COALESCE(br.outbound_border_total_hrs_actual, f.outbound_border_total_hrs, 0) AS outbound_border_total_hrs,

  f.dest_entry,
  f.dest_exit,
  f.customer_entry,
  f.customer_exit,
  f.customs_entry,
  f.customs_exit,
  f.completion_time,

  br.return_first_border_entry,
  br.return_last_border_exit,
  br.border_route_return,
  COALESCE(br.return_border_count_actual, f.return_border_count, 0) AS return_border_count,
  COALESCE(br.return_border_total_hrs_actual, f.return_border_total_hrs, 0) AS return_border_total_hrs,

  f.trip_closed_at,
  f.next_loading_entry,

  f.waiting_for_orders_hrs,
  f.loading_phase_hrs,
  f.post_loading_delay_hrs,
  f.transit_hrs,
  f.border_total_hrs,
  f.customs_hrs,
  f.destination_dwell_hrs,
  f.customer_dwell_hrs,
  f.return_hrs,
  f.total_tat_hrs,

  f.has_corridor_event,
  f.has_border_event,
  f.has_customs_event,
  f.missed_destination,
  f.has_destination_region_only,

  COALESCE(br.open_border_rows, 0) AS open_border_rows,
  (COALESCE(br.open_border_rows, 0) > 0) AS has_open_border_row,

  COALESCE(er.exception_count, 0) AS exception_count,
  COALESCE(er.exception_codes, '') AS exception_codes,

  ROUND(
    COALESCE(f.total_tat_hrs, 0) - (
      COALESCE(f.waiting_for_orders_hrs, 0) +
      COALESCE(f.loading_phase_hrs, 0) +
      COALESCE(f.post_loading_delay_hrs, 0) +
      COALESCE(f.transit_hrs, 0) +
      COALESCE(f.border_total_hrs, 0) +
      COALESCE(f.customs_hrs, 0) +
      COALESCE(f.destination_dwell_hrs, 0) +
      COALESCE(f.customer_dwell_hrs, 0) +
      COALESCE(f.return_hrs, 0)
    ),
    2
  ) AS residual_hrs
FROM tat_trip_facts_v2 f
LEFT JOIN border_rollup br ON br.trip_key = f.trip_key
LEFT JOIN exception_rollup er ON er.trip_key = f.trip_key
WHERE f.loading_start >= ${sqlStringLiteral(startTs)}::timestamptz
  AND f.loading_start <  ${sqlStringLiteral(endTs)}::timestamptz
ORDER BY f.loading_start, f.trip_key
LIMIT ${limit} OFFSET ${offset};
`.trim();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node export_tat_trip_key_details.js [options]

Options:
  --start <ts>       Start timestamp (default: ${DEFAULT_START})
  --end <ts>         End timestamp (default: ${DEFAULT_END})
  --out <path>       Output CSV path (default: ${DEFAULT_OUT})
  --page-size <n>    Rows per SQL page (default: ${DEFAULT_PAGE_SIZE})
  --dry-run          Print config and sample SQL without executing
`);
    return;
  }

  const startTs = getFlagValue(args, '--start') || DEFAULT_START;
  const endTs = getFlagValue(args, '--end') || DEFAULT_END;
  const outPath = getFlagValue(args, '--out') || DEFAULT_OUT;
  const pageSize = parsePositiveInt(getFlagValue(args, '--page-size'), DEFAULT_PAGE_SIZE, '--page-size');
  const dryRun = args.includes('--dry-run');

  if (new Date(startTs) >= new Date(endTs)) {
    throw new Error(`Invalid range: --start (${startTs}) must be before --end (${endTs}).`);
  }

  const columns = [
    'trip_key', 'tracker_id', 'tracker_name', 'trip_type', 'status', 'closure_reason', 'lifecycle_confidence',
    'loading_terminal', 'origin_region', 'destination_name', 'customer_name',
    'dar_arrival', 'loading_start', 'loading_end', 'origin_exit',
    'outbound_first_border_entry', 'outbound_last_border_exit', 'border_route_outbound',
    'outbound_border_count', 'outbound_border_total_hrs',
    'dest_entry', 'dest_exit', 'customer_entry', 'customer_exit', 'customs_entry', 'customs_exit', 'completion_time',
    'return_first_border_entry', 'return_last_border_exit', 'border_route_return',
    'return_border_count', 'return_border_total_hrs',
    'trip_closed_at', 'next_loading_entry',
    'waiting_for_orders_hrs', 'loading_phase_hrs', 'post_loading_delay_hrs', 'transit_hrs', 'border_total_hrs',
    'customs_hrs', 'destination_dwell_hrs', 'customer_dwell_hrs', 'return_hrs', 'total_tat_hrs',
    'has_corridor_event', 'has_border_event', 'has_customs_event', 'missed_destination', 'has_destination_region_only',
    'open_border_rows', 'has_open_border_row', 'exception_count', 'exception_codes', 'residual_hrs'
  ];

  console.log('TAT Trip Key Details Export');
  console.log(`  Project:   ${projectRef}`);
  console.log(`  Range:     ${startTs} -> ${endTs}`);
  console.log(`  Page size: ${pageSize}`);
  console.log(`  Output:    ${outPath}`);

  if (dryRun) {
    console.log('\nDry run enabled. Sample SQL:\n');
    console.log(buildQuery(startTs, endTs, 5, 0));
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });
  stream.write(`${columns.join(',')}\n`);

  let offset = 0;
  let page = 1;
  let totalRows = 0;

  while (true) {
    const sql = buildQuery(startTs, endTs, pageSize, offset);
    console.log(`\n[Page ${page}] Fetching rows offset=${offset} limit=${pageSize}`);
    const rows = await runSql(sql);

    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      const line = columns.map(col => csvValue(row[col])).join(',');
      stream.write(`${line}\n`);
    }

    totalRows += rows.length;
    console.log(`  Wrote ${rows.length} row(s) (total ${totalRows})`);

    if (rows.length < pageSize) {
      break;
    }

    offset += rows.length;
    page += 1;
  }

  stream.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log(`\nDone. Exported ${totalRows} rows to ${outPath}`);
}

main().catch(err => {
  console.error('\nExport failed:', err.message);
  process.exit(1);
});
