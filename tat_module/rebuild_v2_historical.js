// rebuild_v2_historical.js
//
// Rebuilds TAT V2 using Supabase Management API SQL calls.
//
// Resume examples:
//   node rebuild_v2_historical.js --from-stage p4b --from-chunk 6
//   node rebuild_v2_historical.js --from-stage p4
//   node rebuild_v2_historical.js --from-stage p5
//
// Optional overrides:
//   --start-date 2025-10-01T00:00:00+00:00
//   --end-date 2026-03-22T00:00:00+00:00
//   --chunk-days 30
//   --phase3-chunk-days 90
//   --phase3-min-chunk-days 7
//   --http-retries 2
//   --phase3-by-tracker
//   --no-phase3-tracker-fallback
//   --phase3-tracker-delay-ms 200
//   --allow-normalized-duplicates
//   --dry-run

require('dotenv').config({ path: '.env.local' });

const DEFAULT_START_DATE = '2025-10-01T00:00:00+00:00';
const DEFAULT_END_DATE = '2026-03-22T00:00:00+00:00';
const DEFAULT_CHUNK_DAYS = 30;
const DEFAULT_PHASE3_CHUNK_DAYS = 90;
const DEFAULT_PHASE3_MIN_CHUNK_DAYS = 7;
const DEFAULT_PHASE4_MIN_CHUNK_DAYS = 1;
const DEFAULT_HTTP_RETRIES = 2;
const DEFAULT_PHASE3_TRACKER_DELAY_MS = 200;

const STAGE_ORDER = ['p2', 'p3', 'p2b', 'p4b', 'p4', 'p5'];
const CHUNKED_STAGES = new Set(['p2', 'p3', 'p4b', 'p4']);

// Management API helper
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL');
    process.exit(1);
}
if (!ACCESS_TOKEN) {
    console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local');
    console.error('Generate one at: https://supabase.com/dashboard/account/tokens');
    process.exit(1);
}

const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];

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

    const result = await res.json();
    if (result.error) {
        throw new Error(result.error.message || JSON.stringify(result.error));
    }
    return result;
}

// Date helpers
function addDays(isoStr, days) {
    const d = new Date(isoStr);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
}

function clamp(isoStr, maxStr) {
    return new Date(isoStr) > new Date(maxStr) ? maxStr : isoStr;
}

function label(isoStr) {
    return isoStr.slice(0, 10);
}

function buildChunks(startDate, endDate, chunkDays) {
    const chunks = [];
    let chunkStart = startDate;

    while (new Date(chunkStart) < new Date(endDate)) {
        const chunkEnd = clamp(addDays(chunkStart, chunkDays), endDate);
        chunks.push({ start: chunkStart, end: chunkEnd });
        chunkStart = chunkEnd;
    }

    return chunks;
}

function diffDaysCeil(startDate, endDate) {
    const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function splitWindowMidpoint(startDate, endDate) {
    const days = diffDaysCeil(startDate, endDate);
    if (days <= 1) return null;

    const halfDays = Math.floor(days / 2);
    let mid = addDays(startDate, halfDays);

    if (new Date(mid) <= new Date(startDate) || new Date(mid) >= new Date(endDate)) {
        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();
        const midMs = Math.floor((startMs + endMs) / 2);
        mid = new Date(midMs).toISOString();
    }

    if (new Date(mid) <= new Date(startDate) || new Date(mid) >= new Date(endDate)) {
        return null;
    }

    return mid;
}

function isTimeoutError(err) {
    const msg = String(err?.message || '').toLowerCase();
    const name = String(err?.name || '').toLowerCase();
    return (
        name.includes('timeouterror') ||
        name.includes('aborterror') ||
        msg.includes('http 524') ||
        msg.includes('http 544') ||
        msg.includes('connection timeout') ||
        msg.includes('timeout occurred') ||
        msg.includes('timed out') ||
        msg.includes('due to timeout') ||
        msg.includes('operation was aborted') ||
        msg.includes('this operation was aborted') ||
        msg.includes('aborterror') ||
        msg.includes('statement timeout') ||
        msg.includes('57014') ||
        msg.includes('canceling statement due to statement timeout') ||
        msg.includes('timeout')
    );
}

function isTooManyRequestsError(err) {
    const msg = String(err?.message || '').toLowerCase();
    return (
        msg.includes('http 429') ||
        msg.includes('too many requests') ||
        msg.includes('throttlerexception')
    );
}

function isRetryableHttpError(err) {
    if (isTimeoutError(err) || isTooManyRequestsError(err)) return true;
    const msg = String(err?.message || '').toLowerCase();
    return (
        msg.includes('http 502') ||
        msg.includes('http 503') ||
        msg.includes('http 504') ||
        msg.includes('http 520') ||
        msg.includes('http 522') ||
        msg.includes('http 523')
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSqlWithRetries(sql, timeoutMs, retries, contextLabel = '') {
    let lastErr = null;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        try {
            return await runSql(sql, timeoutMs);
        } catch (err) {
            lastErr = err;
            const canRetry = isRetryableHttpError(err) && attempt <= retries;
            if (!canRetry) throw err;

            let waitMs = attempt * 2000;
            if (isTooManyRequestsError(err)) {
                // API throttling needs a longer cool-down than transport timeouts.
                waitMs = Math.min(60000, 8000 * attempt) + Math.floor(Math.random() * 1000);
            }
            const labelText = contextLabel ? ` ${contextLabel}` : '';
            const reason = isTooManyRequestsError(err) ? 'Rate limit' : 'Timeout';
            console.warn(`  ⚠ ${reason}${labelText}; retry ${attempt}/${retries} in ${waitMs / 1000}s`);
            await sleep(waitMs);
        }
    }
    throw lastErr;
}

function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.result)) return payload.result;
    if (Array.isArray(payload?.rows)) return payload.rows;
    return [];
}

function sqlQuoteTs(ts) {
    return `'${String(ts).replace(/'/g, "''")}'::timestamptz`;
}

function isTruthyFlag(flag) {
    return process.argv.slice(2).includes(flag);
}

// CLI parsing
function getFlagValue(flag) {
    const args = process.argv.slice(2);
    const equalsArg = args.find(a => a.startsWith(`${flag}=`));
    if (equalsArg) return equalsArg.split('=').slice(1).join('=');

    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];

    return null;
}

function parsePositiveInt(raw, fallback, flagName) {
    if (!raw) return fallback;

    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid ${flagName}: ${raw}. Must be a positive integer.`);
    }
    return n;
}

function parseNonNegativeInt(raw, fallback, flagName) {
    if (!raw) return fallback;

    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid ${flagName}: ${raw}. Must be a non-negative integer.`);
    }
    return n;
}

function normalizeStage(raw) {
    const key = (raw || 'p2').toLowerCase();
    const aliases = {
        p2: 'p2',
        phase2: 'p2',
        normalize: 'p2',

        p3: 'p3',
        phase3: 'p3',
        events: 'p3',

        p2b: 'p2b',
        backfill: 'p2b',
        seq: 'p2b',
        sequence: 'p2b',

        p4b: 'p4b',
        border: 'p4b',
        borderfacts: 'p4b',
        border_facts: 'p4b',

        p4: 'p4',
        phase4: 'p4',
        facts: 'p4',

        p5: 'p5',
        phase5: 'p5',
        exceptions: 'p5',
    };

    const normalized = aliases[key];
    if (!normalized) {
        throw new Error(`Invalid --from-stage: ${raw}. Use one of: ${STAGE_ORDER.join(', ')}`);
    }

    return normalized;
}

function parseOptions() {
    const dryRun = process.argv.slice(2).includes('--dry-run');

    const startDate = getFlagValue('--start-date') || DEFAULT_START_DATE;
    const endDate = getFlagValue('--end-date') || DEFAULT_END_DATE;
    const trackerId = getFlagValue('--tracker-id')
        ? parsePositiveInt(getFlagValue('--tracker-id'), null, '--tracker-id')
        : null;
    const chunkDays = parsePositiveInt(getFlagValue('--chunk-days'), DEFAULT_CHUNK_DAYS, '--chunk-days');
    const phase3ChunkDays = parsePositiveInt(
        getFlagValue('--phase3-chunk-days'),
        DEFAULT_PHASE3_CHUNK_DAYS,
        '--phase3-chunk-days'
    );
    const phase3MinChunkDays = parsePositiveInt(
        getFlagValue('--phase3-min-chunk-days'),
        DEFAULT_PHASE3_MIN_CHUNK_DAYS,
        '--phase3-min-chunk-days'
    );
    const phase4MinChunkDays = parsePositiveInt(
        getFlagValue('--phase4-min-chunk-days'),
        DEFAULT_PHASE4_MIN_CHUNK_DAYS,
        '--phase4-min-chunk-days'
    );
    const httpRetries = parsePositiveInt(
        getFlagValue('--http-retries'),
        DEFAULT_HTTP_RETRIES,
        '--http-retries'
    );
    const phase3TrackerDelayMs = parseNonNegativeInt(
        getFlagValue('--phase3-tracker-delay-ms'),
        DEFAULT_PHASE3_TRACKER_DELAY_MS,
        '--phase3-tracker-delay-ms'
    );
    const phase3ByTracker = isTruthyFlag('--phase3-by-tracker') || Boolean(trackerId);
    const phase3TrackerFallback = !isTruthyFlag('--no-phase3-tracker-fallback');
    const phase4ByTracker = isTruthyFlag('--phase4-by-tracker') || Boolean(trackerId);
    const phase4TrackerFallback = !isTruthyFlag('--no-phase4-tracker-fallback');
    const phase4TrackerDelayMs = parseNonNegativeInt(
        getFlagValue('--phase4-tracker-delay-ms'),
        DEFAULT_PHASE3_TRACKER_DELAY_MS,
        '--phase4-tracker-delay-ms'
    );
    const allowNormalizedDuplicates = isTruthyFlag('--allow-normalized-duplicates');

    const fromStage = normalizeStage(getFlagValue('--from-stage') || 'p2');
    const fromChunk = parsePositiveInt(getFlagValue('--from-chunk'), 1, '--from-chunk');
    if (new Date(startDate) >= new Date(endDate)) {
        throw new Error(`Invalid date range: start (${startDate}) must be before end (${endDate}).`);
    }

    if (!CHUNKED_STAGES.has(fromStage) && fromChunk !== 1) {
        throw new Error('--from-chunk is only valid for chunked stages: p2, p3, p4b, p4.');
    }
    if (phase3MinChunkDays > phase3ChunkDays) {
        throw new Error('--phase3-min-chunk-days must be <= --phase3-chunk-days.');
    }
    if (phase4MinChunkDays > chunkDays) {
        throw new Error('--phase4-min-chunk-days must be <= --chunk-days.');
    }

    return {
        startDate,
        endDate,
        chunkDays,
        phase3ChunkDays,
        phase3MinChunkDays,
        phase4MinChunkDays,
        httpRetries,
        phase3TrackerDelayMs,
        phase3ByTracker,
        phase3TrackerFallback,
        phase4ByTracker,
        phase4TrackerFallback,
        phase4TrackerDelayMs,
        trackerId,
        allowNormalizedDuplicates,
        fromStage,
        fromChunk,
        dryRun,
    };
}

async function getSingleRow(sql, timeoutMs, retries, contextLabel = '') {
    const payload = await runSqlWithRetries(sql, timeoutMs, retries, contextLabel);
    if (Array.isArray(payload) && payload.length > 0) return payload[0];
    if (Array.isArray(payload?.result) && payload.result.length > 0) return payload.result[0];
    if (Array.isArray(payload?.rows) && payload.rows.length > 0) return payload.rows[0];
    if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
    return null;
}

async function preflightPhase3Input(opts) {
    if (opts.dryRun || opts.allowNormalizedDuplicates) return;

    const dupSql = `
        SELECT COUNT(*)::bigint AS dup_rows
        FROM (
            SELECT
                tracker_id,
                in_time,
                out_time,
                canonical_geofence_id,
                COALESCE(role_code, '') AS role_code,
                COUNT(*) AS c
            FROM trip_geofence_events_normalized
            WHERE canonical_geofence_id IS NOT NULL
              AND in_time >= '${opts.startDate}'
              AND in_time <  '${opts.endDate}'
            GROUP BY 1,2,3,4,5
            HAVING COUNT(*) > 1
        ) d
    `.trim();

    const row = await getSingleRow(
        dupSql,
        5 * 60 * 1000,
        opts.httpRetries,
        'Phase 3 duplicate preflight'
    );

    const dupRows = Number(row?.dup_rows || 0);
    if (dupRows > 0) {
        throw new Error(
            `Preflight failed: found ${dupRows} canonical duplicates in trip_geofence_events_normalized. ` +
            `Apply dedupe migration (tat_v2_refactor_phase_9_normalized_dedupe.sql), rebuild from p2, then retry p3. ` +
            `Use --allow-normalized-duplicates to bypass (not recommended).`
        );
    }
}

async function runChunkedPhase({
    passTitle,
    chunkLabel,
    chunks,
    startChunk,
    dryRun,
    sqlBuilder,
    timeoutMs,
    successLine,
    doneLine,
}) {
    if (chunks.length === 0) {
        console.log(`\n⚠ ${passTitle}: no chunks in range`);
        return;
    }

    if (startChunk > chunks.length) {
        throw new Error(`${passTitle}: --from-chunk ${startChunk} exceeds max chunk ${chunks.length}.`);
    }

    console.log('\n══════════════════════════════════════════════');
    console.log(passTitle);
    console.log(`  Resume from chunk: ${startChunk}`);
    console.log('══════════════════════════════════════════════');

    for (let idx = startChunk - 1; idx < chunks.length; idx += 1) {
        const i = idx + 1;
        const chunk = chunks[idx];
        const sql = sqlBuilder(chunk.start, chunk.end);

        console.log(`\n[${chunkLabel} chunk ${i}] ${label(chunk.start)} → ${label(chunk.end)}`);

        if (dryRun) {
            console.log(`  · Dry run SQL: ${sql}`);
        } else {
            await runSql(sql, timeoutMs);
            console.log(`  ✓ ${successLine}`);
        }
    }

    console.log(`\n✅ ${doneLine}`);
}

async function runPhase2Chunks(opts, startChunk = 1) {
    const chunks = buildChunks(opts.startDate, opts.endDate, opts.chunkDays);
    await runChunkedPhase({
        passTitle: `PASS 1 — Phase 2: Geofence Normalization (${opts.chunkDays}-day chunks)`,
        chunkLabel: 'P2',
        chunks,
        startChunk,
        dryRun: opts.dryRun,
        sqlBuilder: (s, e) => `SELECT refresh_trip_geofence_events_normalized('${s}', '${e}')`,
        timeoutMs: 10 * 60 * 1000,
        successLine: 'Normalized',
        doneLine: 'Phase 2 complete',
    });
}

async function runPhase3Chunks(opts, startChunk = 1) {
    await preflightPhase3Input(opts);

    const chunks = buildChunks(opts.startDate, opts.endDate, opts.phase3ChunkDays);
    if (chunks.length === 0) {
        console.log(`\n⚠ PASS 2 — Phase 3: Trip State Ledger: no chunks in range`);
        return;
    }

    if (startChunk > chunks.length) {
        throw new Error(`PASS 2 — Phase 3: --from-chunk ${startChunk} exceeds max chunk ${chunks.length}.`);
    }

    console.log('\n══════════════════════════════════════════════');
    console.log(`PASS 2 — Phase 3: Trip State Ledger (${opts.phase3ChunkDays}-day chunks)`);
    console.log(`  Resume from chunk: ${startChunk}`);
    console.log('══════════════════════════════════════════════');

    async function getTrackersForWindow(startDate, endDate) {
        if (opts.trackerId) {
            return [opts.trackerId];
        }

        const sql = `
            SELECT DISTINCT tracker_id
            FROM trip_geofence_events_normalized
            WHERE in_time >= ${sqlQuoteTs(startDate)}
              AND in_time <  ${sqlQuoteTs(endDate)}
              ${opts.trackerId ? `AND tracker_id = ${opts.trackerId}` : ''}
              AND tracker_id IS NOT NULL
            ORDER BY tracker_id
        `.trim();

        if (opts.dryRun) {
            return [];
        }

        const payload = await runSqlWithRetries(
            sql,
            5 * 60 * 1000,
            opts.httpRetries,
            `[P3 tracker list] ${label(startDate)} → ${label(endDate)}`
        );

        const rows = extractRows(payload);
        return rows
            .map(r => Number(r.tracker_id))
            .filter(n => Number.isInteger(n));
    }

    async function runPhase3ByTracker(baseChunkNumber, startDate, endDate, depth = 0) {
        const indent = '  '.repeat(depth);
        if (opts.dryRun) {
            const sampleSql = `SELECT build_trip_state_events_v2('${startDate}', '${endDate}', <tracker_id>)`;
            console.log(`${indent}· Dry run tracker mode SQL: ${sampleSql}`);
            return;
        }

        const trackers = await getTrackersForWindow(startDate, endDate);
        console.log(
            `${indent}· Tracker fallback ${label(startDate)} → ${label(endDate)}: ${trackers.length} tracker(s)`
        );

        if (trackers.length === 0) {
            return;
        }

        async function runPhase3TrackerWindow(trackerId, windowStart, windowEnd, splitDepth = 0) {
            const splitIndent = `${indent}${'  '.repeat(splitDepth)}`;
            const sql = `SELECT build_trip_state_events_v2('${windowStart}', '${windowEnd}', ${trackerId})`;
            const days = diffDaysCeil(windowStart, windowEnd);

            try {
                await runSqlWithRetries(
                    sql,
                    10 * 60 * 1000,
                    opts.httpRetries,
                    `[P3 chunk ${baseChunkNumber} t=${trackerId}] ${label(windowStart)} → ${label(windowEnd)}`
                );
                if (splitDepth > 0) {
                    console.log(
                        `${splitIndent}✓ Tracker sub-window t=${trackerId} ${label(windowStart)} → ${label(windowEnd)} (${days}d)`
                    );
                }
                return;
            } catch (err) {
                const canSplit = isTimeoutError(err) && days > opts.phase3MinChunkDays;
                const midpoint = splitWindowMidpoint(windowStart, windowEnd);
                if (!canSplit || !midpoint) {
                    throw err;
                }

                console.warn(
                    `${splitIndent}⚠ Timeout t=${trackerId} ${label(windowStart)} → ${label(windowEnd)} (${days}d); splitting`
                );
                await runPhase3TrackerWindow(trackerId, windowStart, midpoint, splitDepth + 1);
                await runPhase3TrackerWindow(trackerId, midpoint, windowEnd, splitDepth + 1);
            }
        }

        for (let i = 0; i < trackers.length; i += 1) {
            const trackerId = trackers[i];
            await runPhase3TrackerWindow(trackerId, startDate, endDate, 0);
            if (opts.phase3TrackerDelayMs > 0 && i < trackers.length - 1) {
                await sleep(opts.phase3TrackerDelayMs);
            }
            if ((i + 1) % 25 === 0 || i === trackers.length - 1) {
                console.log(`${indent}  · Tracker progress ${i + 1}/${trackers.length}`);
            }
        }
    }

    async function runPhase3Window(baseChunkNumber, startDate, endDate, depth = 0) {
        const sql = opts.trackerId
            ? `SELECT build_trip_state_events_v2('${startDate}', '${endDate}', ${opts.trackerId})`
            : `SELECT build_trip_state_events_v2('${startDate}', '${endDate}')`;
        const days = diffDaysCeil(startDate, endDate);
        const indent = '  '.repeat(depth);

        if (opts.dryRun) {
            console.log(`${indent}· Dry run SQL: ${sql}`);
            return;
        }

        try {
            await runSqlWithRetries(
                sql,
                10 * 60 * 1000,
                opts.httpRetries,
                `[P3 chunk ${baseChunkNumber}] ${label(startDate)} → ${label(endDate)}`
            );
            if (depth > 0) {
                console.log(`${indent}✓ Sub-window ${label(startDate)} → ${label(endDate)} (${days}d)`);
            }
            return;
        } catch (err) {
            const canSplit = isTimeoutError(err) && days > opts.phase3MinChunkDays;
            const midpoint = splitWindowMidpoint(startDate, endDate);
            if (!canSplit || !midpoint) {
                if (isTimeoutError(err) && opts.phase3TrackerFallback) {
                    console.warn(
                        `${indent}⚠ Timeout persists on ${label(startDate)} → ${label(endDate)} (${days}d); switching to tracker fallback`
                    );
                    await runPhase3ByTracker(baseChunkNumber, startDate, endDate, depth + 1);
                    console.log(`${indent}✓ Tracker fallback completed for ${label(startDate)} → ${label(endDate)}`);
                    return;
                }
                throw err;
            }

            console.warn(
                `${indent}⚠ Timeout on ${label(startDate)} → ${label(endDate)} (${days}d); splitting`
            );
            await runPhase3Window(baseChunkNumber, startDate, midpoint, depth + 1);
            await runPhase3Window(baseChunkNumber, midpoint, endDate, depth + 1);
        }
    }

    for (let idx = startChunk - 1; idx < chunks.length; idx += 1) {
        const i = idx + 1;
        const chunk = chunks[idx];
        console.log(`\n[P3 chunk ${i}] ${label(chunk.start)} → ${label(chunk.end)}`);
        if (opts.phase3ByTracker) {
            await runPhase3ByTracker(i, chunk.start, chunk.end, 0);
        } else {
            await runPhase3Window(i, chunk.start, chunk.end, 0);
        }
        console.log('  ✓ Events written');
    }

    console.log('\n✅ Phase 3 complete');
}

async function runTripSequenceBackfill(opts) {
    console.log('\n══════════════════════════════════════════════');
    console.log('PASS 2b — Trip Sequence Backfill');
    console.log('══════════════════════════════════════════════');

    const sql = `SELECT backfill_trip_sequence_v2()`;
    if (opts.dryRun) {
        console.log(`  · Dry run SQL: ${sql}`);
    } else {
        await runSql(sql, 15 * 60 * 1000);
        console.log('\n✅ Trip sequence backfill complete');
    }
}

async function runPhase4BorderChunks(opts, startChunk = 1) {
    const chunks = buildChunks(opts.startDate, opts.endDate, opts.chunkDays);
    await runChunkedPhase({
        passTitle: `PASS 3b — Phase 4.5: Border Facts (${opts.chunkDays}-day chunks)`,
        chunkLabel: 'P4b',
        chunks,
        startChunk,
        dryRun: opts.dryRun,
        sqlBuilder: (s, e) => `SELECT build_tat_trip_border_facts_v2('${s}', '${e}')`,
        timeoutMs: 10 * 60 * 1000,
        successLine: 'Border facts written',
        doneLine: 'Phase 4.5 complete',
    });
}

async function runPhase4Chunks(opts, startChunk = 1) {
    const chunks = buildChunks(opts.startDate, opts.endDate, opts.chunkDays);
    if (chunks.length === 0) {
        console.log(`\n⚠ PASS 3 — Phase 4: Trip Facts: no chunks in range`);
        return;
    }

    if (startChunk > chunks.length) {
        throw new Error(`PASS 3 — Phase 4: --from-chunk ${startChunk} exceeds max chunk ${chunks.length}.`);
    }

    console.log('\n══════════════════════════════════════════════');
    console.log(`PASS 3 — Phase 4: Trip Facts (${opts.chunkDays}-day chunks)`);
    console.log(`  Resume from chunk: ${startChunk}`);
    console.log('══════════════════════════════════════════════');

    async function getTrackersForFactsWindow(startDate, endDate) {
        if (opts.trackerId) {
            return [opts.trackerId];
        }

        const sql = `
            SELECT DISTINCT tracker_id
            FROM trip_state_events
            WHERE event_code = 'loading_start'
              AND event_time >= ${sqlQuoteTs(startDate)}
              AND event_time <  ${sqlQuoteTs(endDate)}
              ${opts.trackerId ? `AND tracker_id = ${opts.trackerId}` : ''}
              AND tracker_id IS NOT NULL
            ORDER BY tracker_id
        `.trim();

        if (opts.dryRun) {
            return [];
        }

        const payload = await runSqlWithRetries(
            sql,
            5 * 60 * 1000,
            opts.httpRetries,
            `[P4 tracker list] ${label(startDate)} → ${label(endDate)}`
        );

        const rows = extractRows(payload);
        return rows
            .map(r => Number(r.tracker_id))
            .filter(n => Number.isInteger(n));
    }

    async function runPhase4ByTracker(baseChunkNumber, startDate, endDate, depth = 0) {
        const indent = '  '.repeat(depth);
        if (opts.dryRun) {
            const sampleSql = `SELECT build_tat_trip_facts_v2('${startDate}', '${endDate}', <tracker_id>)`;
            console.log(`${indent}· Dry run tracker mode SQL: ${sampleSql}`);
            return;
        }

        const trackers = await getTrackersForFactsWindow(startDate, endDate);
        console.log(
            `${indent}· Tracker fallback ${label(startDate)} → ${label(endDate)}: ${trackers.length} tracker(s)`
        );

        if (trackers.length === 0) {
            return;
        }

        async function runPhase4TrackerWindow(trackerId, windowStart, windowEnd, splitDepth = 0) {
            const splitIndent = `${indent}${'  '.repeat(splitDepth)}`;
            const sql = `SELECT build_tat_trip_facts_v2('${windowStart}', '${windowEnd}', ${trackerId})`;
            const days = diffDaysCeil(windowStart, windowEnd);

            try {
                await runSqlWithRetries(
                    sql,
                    10 * 60 * 1000,
                    opts.httpRetries,
                    `[P4 chunk ${baseChunkNumber} t=${trackerId}] ${label(windowStart)} → ${label(windowEnd)}`
                );
                if (splitDepth > 0) {
                    console.log(
                        `${splitIndent}✓ Tracker sub-window t=${trackerId} ${label(windowStart)} → ${label(windowEnd)} (${days}d)`
                    );
                }
                return;
            } catch (err) {
                const canSplit = isTimeoutError(err) && days > opts.phase4MinChunkDays;
                const midpoint = splitWindowMidpoint(windowStart, windowEnd);
                if (!canSplit || !midpoint) {
                    throw err;
                }

                console.warn(
                    `${splitIndent}⚠ Timeout t=${trackerId} ${label(windowStart)} → ${label(windowEnd)} (${days}d); splitting`
                );
                await runPhase4TrackerWindow(trackerId, windowStart, midpoint, splitDepth + 1);
                await runPhase4TrackerWindow(trackerId, midpoint, windowEnd, splitDepth + 1);
            }
        }

        for (let i = 0; i < trackers.length; i += 1) {
            const trackerId = trackers[i];
            await runPhase4TrackerWindow(trackerId, startDate, endDate, 0);
            if (opts.phase4TrackerDelayMs > 0 && i < trackers.length - 1) {
                await sleep(opts.phase4TrackerDelayMs);
            }
            if ((i + 1) % 25 === 0 || i === trackers.length - 1) {
                console.log(`${indent}  · Tracker progress ${i + 1}/${trackers.length}`);
            }
        }
    }

    async function runPhase4Window(baseChunkNumber, startDate, endDate, depth = 0) {
        const sql = opts.trackerId
            ? `SELECT build_tat_trip_facts_v2('${startDate}', '${endDate}', ${opts.trackerId})`
            : `SELECT build_tat_trip_facts_v2('${startDate}', '${endDate}')`;
        const days = diffDaysCeil(startDate, endDate);
        const indent = '  '.repeat(depth);

        if (opts.dryRun) {
            console.log(`${indent}· Dry run SQL: ${sql}`);
            return;
        }

        if (opts.phase4ByTracker) {
            await runPhase4ByTracker(baseChunkNumber, startDate, endDate, depth);
            return;
        }

        try {
            await runSqlWithRetries(
                sql,
                10 * 60 * 1000,
                opts.httpRetries,
                `[P4 chunk ${baseChunkNumber}] ${label(startDate)} → ${label(endDate)}`
            );
            if (depth > 0) {
                console.log(`${indent}✓ Sub-window ${label(startDate)} → ${label(endDate)} (${days}d)`);
            }
            return;
        } catch (err) {
            const canSplit = isTimeoutError(err) && days > opts.phase4MinChunkDays;
            const midpoint = splitWindowMidpoint(startDate, endDate);
            if (!canSplit || !midpoint) {
                if (isTimeoutError(err) && opts.phase4TrackerFallback) {
                    console.warn(
                        `${indent}⚠ Timeout persists on ${label(startDate)} → ${label(endDate)} (${days}d); switching to tracker fallback`
                    );
                    await runPhase4ByTracker(baseChunkNumber, startDate, endDate, depth + 1);
                    console.log(`${indent}✓ Tracker fallback completed for ${label(startDate)} → ${label(endDate)}`);
                    return;
                }
                throw err;
            }

            console.warn(
                `${indent}⚠ Timeout on ${label(startDate)} → ${label(endDate)} (${days}d); splitting`
            );
            await runPhase4Window(baseChunkNumber, startDate, midpoint, depth + 1);
            await runPhase4Window(baseChunkNumber, midpoint, endDate, depth + 1);
        }
    }

    for (let idx = startChunk - 1; idx < chunks.length; idx += 1) {
        const i = idx + 1;
        const chunk = chunks[idx];
        console.log(`\n[P4 chunk ${i}] ${label(chunk.start)} → ${label(chunk.end)}`);
        await runPhase4Window(i, chunk.start, chunk.end, 0);
        console.log('  ✓ Facts written');
    }

    console.log('\n✅ Phase 4 complete');
}

async function runPhase5Full(opts) {
    console.log('\n══════════════════════════════════════════════');
    console.log('PASS 4 — Phase 5: Exception Flags');
    console.log('══════════════════════════════════════════════');

    const sql = `SELECT generate_tat_v2_exceptions('${opts.startDate}', '${opts.endDate}')`;

    if (opts.dryRun) {
        console.log(`  · Dry run SQL: ${sql}`);
        return;
    }

    try {
        await runSql(sql);
        console.log('\n✅ Phase 5 complete');
    } catch (err) {
        console.warn('\n⚠ Phase 5 error (non-critical, continuing):', err.message);
    }
}

async function main() {
    const opts = parseOptions();

    console.log('TAT V2 Historical Rebuild (via Management API)');
    console.log(`  Project: ${projectRef}`);
    console.log(`  Range:   ${label(opts.startDate)} to ${label(opts.endDate)}`);
    console.log(`  Start:   stage=${opts.fromStage}, chunk=${opts.fromChunk}`);
    if (opts.trackerId) console.log(`  Tracker: ${opts.trackerId}`);
    if (opts.dryRun) console.log('  Mode:    dry-run (no SQL executed)');

    const t0 = Date.now();
    const fromIdx = STAGE_ORDER.indexOf(opts.fromStage);

    for (let i = fromIdx; i < STAGE_ORDER.length; i += 1) {
        const stage = STAGE_ORDER[i];
        const startChunk = stage === opts.fromStage ? opts.fromChunk : 1;

        if (stage === 'p2') {
            await runPhase2Chunks(opts, startChunk);
        } else if (stage === 'p3') {
            await runPhase3Chunks(opts, startChunk);
        } else if (stage === 'p2b') {
            await runTripSequenceBackfill(opts);
        } else if (stage === 'p4b') {
            await runPhase4BorderChunks(opts, startChunk);
        } else if (stage === 'p4') {
            await runPhase4Chunks(opts, startChunk);
        } else if (stage === 'p5') {
            await runPhase5Full(opts);
        }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n${'='.repeat(46)}`);
    console.log(`TAT V2 REBUILD COMPLETE in ${elapsed}s`);
    console.log('  Validate: SELECT * FROM v_tat_v1_v2_parity ORDER BY destination;');
    console.log(`${'='.repeat(46)}`);
}

main().catch(err => {
    console.error('\n❌ Rebuild aborted:', err.message);
    process.exit(1);
});
