/**
 * Batch Security Analysis Pipeline
 *
 * Iterates through ALL trips in v_ai_trip_logs, fetches GPS tracks from Navixy,
 * runs route deviation analysis, and persists results to route_security_events.
 *
 * Usage:
 *   npx tsx scripts/batch-security-analysis.ts --from 2025-01-01 --to 2025-12-31
 *   npx tsx scripts/batch-security-analysis.ts --from 2025-06-01 --to 2025-06-30 --concurrency 3 --force
 *
 * Options:
 *   --from          Start date (YYYY-MM-DD, required)
 *   --to            End date (YYYY-MM-DD, required)
 *   --batch-size    Trips per DB page (default 100)
 *   --concurrency   Parallel trip analyses (default 5)
 *   --force         Re-analyze already-processed trips
 */


import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as turf from '@turf/turf';
import { analyzeRouteDeviation } from '../src/lib/route-analysis';
import type { SeverityLevel, StopEvent, SecurityHotspot } from '../src/types/security';
import { RouteLearningService } from '../src/services/route-learning';
import { SCORING_THRESHOLDS } from '../src/lib/telematics-config';
import { latLngToCell } from 'h3-js';
import { NavixyServerService } from '../src/services/navixy-server';

// ────────────────────────────────────────────────────────────
// Safe Zone Helper
// ────────────────────────────────────────────────────────────

async function fetchSafeZones(sessionKey: string) {
    console.log('Fetching Safe Zones from Navixy...');
    const rawZones = await NavixyServerService.listZones(sessionKey);

    // Convert to Analysis format
    return rawZones
        .filter(z => z.type !== 'sausage') // EXCLUDE SAUSAGES per user request
        .map(z => {
            let geometry: any = null;
            if (z.type === 'circle' && z.points?.[0] && z.radius) {
                geometry = { type: 'Point', coordinates: [z.points[0].lng, z.points[0].lat] };
            } else if (z.type === 'polygon' && z.points && z.points.length > 0) {
                const coords = z.points.map((p: any) => [p.lng, p.lat]);
                // Close ring
                if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
                    coords.push(coords[0]);
                }
                geometry = { type: 'Polygon', coordinates: [coords] };
            }

            if (!geometry) return null;

            return {
                id: z.id,
                label: z.name || z.label || `Zone ${z.id}`,
                geometry,
                radius: z.radius // for circles
            };
        })
        .filter(z => z !== null) as NonNullable<ReturnType<typeof analyzeRouteDeviation> extends Promise<infer R> ? any : any>['safeZones'];
}

// ────────────────────────────────────────────────────────────
// Load environment
// ────────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const NAVIXY_SESSION_KEY = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY!;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
const NAVIXY_BASE = 'https://api.navixy.com/v2';

// ────────────────────────────────────────────────────────────
// CLI argument parsing
// ────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const flags: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            if (args[i + 1] && !args[i + 1].startsWith('--')) {
                flags[key] = args[++i];
            } else {
                flags[key] = 'true';
            }
        }
    }

    if (!flags.from || !flags.to) {
        console.error('Usage: npx tsx scripts/batch-security-analysis.ts --from YYYY-MM-DD --to YYYY-MM-DD [--batch-size N] [--concurrency N] [--force]');
        process.exit(1);
    }

    return {
        from: flags.from,
        to: flags.to,
        batchSize: parseInt(flags['batch-size'] || '100', 10),
        concurrency: parseInt(flags.concurrency || '5', 10),
        force: flags.force === 'true',
    };
}

// ────────────────────────────────────────────────────────────
// Validate environment
// ────────────────────────────────────────────────────────────

function validateEnv() {
    const missing: string[] = [];
    if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!NAVIXY_SESSION_KEY) missing.push('NEXT_PUBLIC_NAVIXY_SESSION_KEY');
    if (!MAPBOX_TOKEN) missing.push('NEXT_PUBLIC_MAPBOX_TOKEN');

    if (missing.length > 0) {
        console.error(`Missing environment variables in .env.local: ${missing.join(', ')}`);
        process.exit(1);
    }
}

// ────────────────────────────────────────────────────────────
// Navixy direct API (bypasses browser CORS proxy)
// ────────────────────────────────────────────────────────────

function formatNavixyDate(isoStr: string): string {
    const d = new Date(isoStr);
    return d.toISOString().replace('T', ' ').split('.')[0];
}

async function fetchTrack(trackerId: number, from: string, to: string): Promise<any[]> {
    const fromStr = encodeURIComponent(formatNavixyDate(from));
    const toStr = encodeURIComponent(formatNavixyDate(to));
    const url = `${NAVIXY_BASE}/track/read?tracker_id=${trackerId}&from=${fromStr}&to=${toStr}&hash=${NAVIXY_SESSION_KEY}`;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            const res = await fetch(url);

            if (!res.ok) {
                // Do not retry client errors (except rate limits)
                if (res.status === 400 || res.status === 401 || res.status === 403) {
                    console.error(`[Navixy] ${res.status} Error for ID ${trackerId}. URL: ${url}`);
                    return []; // Fail fast, don't retry
                }

                // If 429 or 5xx, valid to retry.
                console.warn(`[Navixy] ${res.status} ${res.statusText} for ${trackerId}`);
                if (res.status === 429) await delay(2000 * (attempts + 1));
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            return data?.success ? data.list : [];

        } catch (err: any) {
            attempts++;
            const isLast = attempts === maxAttempts;
            const delayMs = 1000 * Math.pow(2, attempts); // 2s, 4s, 8s...

            // Only retry if it's NOT a 4xx error we explicitly threw above (unless it fell through)
            if (err.message.startsWith('HTTP 40')) {
                // 429 cases fall here, so we wait and continue loop
                if (!err.message.includes('429') && isLast) return [];
            }

            if (err.cause && (err.cause.code === 'UND_ERR_SOCKET' || err.cause.code === 'ECONNRESET')) {
                console.warn(`[Navixy] Connection reset for ${trackerId}. Retrying ${attempts}/${maxAttempts} in ${delayMs}ms...`);
            } else {
                console.warn(`[Navixy] Fetch error for ${trackerId}: ${err.message}. Retrying ${attempts}/${maxAttempts}...`);
            }

            if (isLast) return []; // Give up
            await delay(delayMs);
        }
    }
    return [];
}

// ────────────────────────────────────────────────────────────
// Concurrency utilities
// ────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function pooled<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const idx = cursor++;
            results[idx] = await fn(items[idx], idx);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

// ────────────────────────────────────────────────────────────
// Hotspot Generation (Cluster Analysis)
// ────────────────────────────────────────────────────────────

function generateHotspots(
    tripId: string,
    trackerId: number,
    trackerName: string,
    deviationSegments: GeoJSON.FeatureCollection | null,
    stopEvents: StopEvent[],
    severity: SeverityLevel
): Omit<SecurityHotspot, 'id' | 'created_at' | 'updated_at'>[] {
    const hotspots: Omit<SecurityHotspot, 'id' | 'created_at' | 'updated_at'>[] = [];
    const analyzedAt = new Date().toISOString();

    // 1. Convert Deviation Segments to Centroids
    if (deviationSegments && deviationSegments.features) {
        deviationSegments.features.forEach((feat) => {
            if (feat.geometry.type === 'LineString') {
                const center = turf.center(feat);
                const lengthKm = turf.length(feat, { units: 'kilometers' });

                // Only create hotspots for significant deviations (> 1km or critical)
                if (lengthKm > 0.5) {
                    hotspots.push({
                        trip_id: tripId,
                        tracker_id: trackerId,
                        tracker_name: trackerName,
                        severity_level: severity,
                        point_type: 'deviation_centroid',
                        lat: center.geometry.coordinates[1],
                        lng: center.geometry.coordinates[0],
                        deviation_km: parseFloat(lengthKm.toFixed(2)),
                        duration_mins: null,
                        analyzed_at: analyzedAt
                    });
                }
            }
        });
    }

    // 2. Add Stop Events
    stopEvents.forEach(stop => {
        hotspots.push({
            trip_id: tripId,
            tracker_id: trackerId,
            tracker_name: trackerName,
            severity_level: 'CRITICAL', // Stops off-route are always high risk
            point_type: 'unauthorized_stop',
            lat: stop.lat,
            lng: stop.lng,
            deviation_km: 0,
            duration_mins: stop.duration_mins,
            analyzed_at: analyzedAt
        });
    });

    return hotspots;
}


// ────────────────────────────────────────────────────────────
// Trip processing
// ────────────────────────────────────────────────────────────

interface TripRow {
    trip_id: string;
    tracker_id: number;
    tracker_name: string;
    start_time: string;
    end_time: string;
    start_geom: any;
    end_geom: any;
}

interface Stats {
    processed: number;
    skipped: number;
    errors: number;
    critical: number;
    warning: number;
    minor: number;
    noTrack: number;
}

async function processTrip(
    trip: TripRow,
    supabase: any,
    stats: Stats,
    safeZones: any[]
): Promise<void> {
    const { trip_id, tracker_id, tracker_name, start_time, end_time, start_geom, end_geom } = trip;

    const startCoords = start_geom?.coordinates as [number, number] | undefined;
    const endCoords = end_geom?.coordinates as [number, number] | undefined;

    if (!startCoords || !endCoords) {
        stats.skipped++;
        return;
    }

    // 1. Fetch GPS track from Navixy
    const rawPoints = await fetchTrack(tracker_id, start_time, end_time);
    if (!rawPoints || rawPoints.length < 2) {
        stats.noTrack++;
        return;
    }

    // Map Navixy structure to Analysis Params (extracting sat, alt, speed)
    const trackPoints = rawPoints.map((p: any) => ({
        lat: p.lat,
        lng: p.lng,
        time: p.get_time || p.time, // '2025-10-31 10:00:00' or unix
        sat: p.satellites ?? p.sat, // Handle aliasing
        alt: p.alt ?? p.altitude,
        speed: p.speed
    }));

    await delay(100); // rate limit Navixy

    // 2. Run analysis (Flagship Mode: Adaptive Tolerance + Map Matching)
    const result = await analyzeRouteDeviation({
        startCoords,
        endCoords,
        trackPoints,
        mapboxToken: MAPBOX_TOKEN,
        enableMapMatching: true, // FORCE PRO MODE
        profile: 'mapbox/driving',
        safeZones
    });

    await delay(150); // rate limit Mapbox

    // 2b. Learn Corridors (Populate fleet_corridors)
    try {
        const learningTrack = trackPoints.map(p => ({
            lat: p.lat,
            lng: p.lng,
            time: typeof p.time === 'string' ? Math.floor(new Date(p.time).getTime() / 1000) : Number(p.time)
        }));
        await RouteLearningService.learnCorridorsFromTrack(learningTrack, trip.tracker_id);
    } catch (learnErr) {
        console.warn(`  [WARN] Corridor learning failed for ${trip_id}:`, learnErr);
    }

    // 3. Compute severity
    const dsr = result.actualKm > 0 ? (result.deviationKm / result.actualKm) * 100 : 0;
    let severity: SeverityLevel = dsr > 15 ? 'CRITICAL' : dsr > 5 ? 'WARNING' : 'MINOR';

    // --- RISK ENGINE INTEGRATION ---
    let riskScore = result.riskScore || 0;
    const riskReasons = result.riskReasons || [];

    if (result.stopEvents?.length > 0) {
        for (const stop of result.stopEvents) {
            if (stop.isAuthorized) continue;
            try {
                // P2.5: Pass tracker_id for per-vehicle corridor scoping
                const stopRisk = await RouteLearningService.evaluateStopRisk(stop.lat, stop.lng, trip.tracker_id);
                if (stopRisk.score > 0) {
                    riskScore += stopRisk.score;
                    riskReasons.push(...stopRisk.reasons);
                }

                // P2.8: Wire up KNOWN_HOTSPOT_STOP weight from config
                if (stopRisk.reasons.some((r: string) => r.includes('RISK_ZONE_HIT'))) {
                    riskScore += SCORING_THRESHOLDS.RISK_SCORING.WEIGHTS.KNOWN_HOTSPOT_STOP;
                    riskReasons.push('KNOWN_HOTSPOT_STOP');
                }

                // Persist Derived Stop
                await supabase.from('derived_stops').insert({
                    trip_id: trip.trip_id,
                    tracker_id: trip.tracker_id,
                    start_time: stop.startTime || new Date(trip.start_time).toISOString(),
                    end_time: stop.endTime,
                    duration_mins: stop.duration_mins,
                    location: `POINT(${stop.lng} ${stop.lat})`,
                    location_h3: latLngToCell(stop.lat, stop.lng, 9),
                    is_night_stop: false, // TODO: Compute from accurate time if needed, or let SQL trigger handle
                    risk_score: stopRisk.score
                });
            } catch (err) { } // Fail open
        }
    }

    // P2.8: Repeat Offender Check — use config weight instead of hardcoded value
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { count } = await supabase.from('route_security_events')
            .select('*', { count: 'exact', head: true })
            .eq('tracker_id', trip.tracker_id)
            .gte('analyzed_at', sevenDaysAgo.toISOString())
            .or('severity_level.eq.CRITICAL,unauthorized_stops.gt.0');

        if (count && count > 2) {
            riskScore += SCORING_THRESHOLDS.RISK_SCORING.WEIGHTS.REPEAT_OFFENDER;
            riskReasons.push(`REPEAT_OFFENDER_(${count}_PRIOR)`);
        }
    } catch (e) { }

    riskScore = Math.min(riskScore, 100);

    // 4. Upsert Security Event
    const row = {
        trip_id,
        tracker_id,
        tracker_name,
        proposed_km: parseFloat(result.proposedKm.toFixed(2)),
        actual_km: parseFloat(result.actualKm.toFixed(2)),
        deviation_km: parseFloat(result.deviationKm.toFixed(2)),
        deviation_severity_ratio: parseFloat(dsr.toFixed(2)),
        severity_level: severity,
        route_breaches: result.routeBreaches,
        unauthorized_stops: result.unauthorizedStops,
        deviation_segments: result.deviationSegments,
        stop_events: result.stopEvents.length > 0 ? result.stopEvents : null,
        analyzed_at: new Date().toISOString(),
        risk_score: riskScore,
        risk_reasons: riskReasons
    };

    const { error } = await supabase
        .from('route_security_events')
        .upsert(row as any, { onConflict: 'trip_id' });

    if (error) {
        console.error(`  [ERROR] trip ${trip_id} (Upsert Event): ${error.message}`);
        stats.errors++;
    } else {
        // 5. Generate and Upsert Hotspots (if any)
        const hotspots = generateHotspots(trip_id, tracker_id, tracker_name, result.deviationSegments, result.stopEvents, severity);

        if (hotspots.length > 0) {
            await supabase.from('security_hotspots').delete().eq('trip_id', trip_id);
            const { error: hotspotError } = await supabase.from('security_hotspots').insert(hotspots);
            if (hotspotError) console.warn(`  [WARN] trip ${trip_id} (Hotspots): ${hotspotError.message}`);
        }

        stats.processed++;
        if (severity === 'CRITICAL') stats.critical++;
        else if (severity === 'WARNING') stats.warning++;
        else stats.minor++;
    }
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────

async function main() {
    validateEnv();
    const opts = parseArgs();

    console.log('═══════════════════════════════════════════════════════');
    console.log('  UNIFLEET BATCH SECURITY ANALYSIS (ADAPTIVE ENGINE)');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Date range:  ${opts.from} → ${opts.to}`);
    console.log(`  Batch size:  ${opts.batchSize}`);
    console.log(`  Concurrency: ${opts.concurrency}`);
    console.log(`  Force:       ${opts.force}`);
    console.log('═══════════════════════════════════════════════════════\n');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const stats: Stats = {
        processed: 0,
        skipped: 0,
        errors: 0,
        critical: 0,
        warning: 0,
        minor: 0,
        noTrack: 0,
    };

    // Count total trips in range
    const { count: totalCount } = await supabase
        .from('v_ai_trip_logs')
        .select('trip_id', { count: 'exact', head: true })
        .gte('trip_date', opts.from)
        .lte('trip_date', opts.to);

    const totalTrips = totalCount || 0;
    console.log(`Found ${totalTrips} trips in date range.\n`);

    if (totalTrips === 0) {
        console.log('No trips to process. Exiting.');
        return;
    }

    const totalBatches = Math.ceil(totalTrips / opts.batchSize);
    let globalOffset = 0;
    let batchNum = 0;

    // Fetch Global Safe Zones once
    const safeZones = await fetchSafeZones(NAVIXY_SESSION_KEY);
    console.log(`Loaded ${safeZones.length} Safe Zones for analysis.`);

    while (true) {
        batchNum++;
        const from = globalOffset;
        const to = globalOffset + opts.batchSize - 1;

        // Fetch batch of trips
        const { data: trips, error: fetchError } = await supabase
            .from('v_ai_trip_logs')
            .select('trip_id, tracker_id, tracker_name, start_time, end_time, start_geom, end_geom')
            .gte('trip_date', opts.from)
            .lte('trip_date', opts.to)
            .order('start_time', { ascending: true })
            .range(from, to);

        if (fetchError) {
            console.error(`[FATAL] Failed to fetch trips: ${fetchError.message}`);
            break;
        }

        if (!trips || trips.length === 0) break;

        // Skip already-analyzed trips (unless --force)
        let tripsToProcess: TripRow[] = trips as TripRow[];

        if (!opts.force) {
            const tripIds = trips.map(t => t.trip_id);
            const { data: existing } = await supabase
                .from('route_security_events')
                .select('trip_id')
                .in('trip_id', tripIds);

            const analyzedSet = new Set((existing || []).map(e => e.trip_id));
            const before = tripsToProcess.length;
            tripsToProcess = tripsToProcess.filter(t => !analyzedSet.has(t.trip_id));
            stats.skipped += before - tripsToProcess.length;
        }

        if (tripsToProcess.length === 0) {
            console.log(`[Batch ${batchNum}/${totalBatches}] All ${trips.length} trips already analyzed, skipping.`);
            globalOffset += opts.batchSize;
            continue;
        }

        console.log(`[Batch ${batchNum}/${totalBatches}] Processing ${tripsToProcess.length} trips (${trips.length - tripsToProcess.length} skipped)...`);

        // Process with concurrency pool
        await pooled(tripsToProcess, opts.concurrency, async (trip) => {
            try {
                await processTrip(trip, supabase, stats, safeZones);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`  [ERROR] trip ${trip.trip_id}: ${msg}`);
                stats.errors++;
            }
        });

        const total = stats.processed + stats.skipped + stats.errors + stats.noTrack;
        console.log(
            `  Progress: ${total}/${totalTrips} | ` +
            `${stats.critical} CRITICAL | ${stats.warning} WARNING | ${stats.minor} MINOR | ` +
            `${stats.errors} errors | ${stats.noTrack} no-track`
        );

        globalOffset += opts.batchSize;
        if (trips.length < opts.batchSize) break; // last page
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  BATCH COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Processed:    ${stats.processed}`);
    console.log(`  Skipped:      ${stats.skipped} (already analyzed)`);
    console.log(`  No GPS track: ${stats.noTrack}`);
    console.log(`  Errors:       ${stats.errors}`);
    console.log(`  ─────────────────────────────`);
    console.log(`  CRITICAL:     ${stats.critical}`);
    console.log(`  WARNING:      ${stats.warning}`);
    console.log(`  MINOR:        ${stats.minor}`);
    console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});

