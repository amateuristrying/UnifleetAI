/**
 * Batch Stop Security Analysis Pipeline
 *
 * Reads stops from the `stops` table, scores each for suspicious activity,
 * then aggregates into H3 hex risk zones and DBSCAN clusters.
 *
 * Usage:
 *   npx tsx src/scripts/batch-stop-analysis.ts --from 2025-10-01 --to 2025-10-31
 *   npx tsx src/scripts/batch-stop-analysis.ts --from 2025-10-31 --to 2025-10-31 --force
 *
 * Options:
 *   --from          Start date (YYYY-MM-DD, required)
 *   --to            End date   (YYYY-MM-DD, required)
 *   --batch-size    Stops per DB page (default 500)
 *   --force         Re-analyze already-scored stops
 *   --skip-hotspots Skip H3 aggregation + DBSCAN (just score stops)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Force direct API URL for server-side script
process.env.NEXT_PUBLIC_NAVIXY_API_URL = 'https://api.navixy.com/v2';

import { getSupabaseAdmin } from '../lib/supabase-server';
import { NavixyServerService } from '../services/navixy-server';
import { analyzeStop, type SafeZoneGeo, type RiskHexLookup } from '../lib/stop-analysis';
import { aggregateStopsToHexGrid, clusterRiskHexes, propagateRisk } from '../lib/hotspot-aggregation';
import { SCORING_THRESHOLDS } from '../lib/telematics-config';
import * as turf from '@turf/turf';
import type {
    StopRecord,
    StopRiskResult,
    VehicleStopProfile,
    AdjacentTrips,
} from '../types/security';

// ────────────────────────────────────────────────────────────
// Verification Helper
// ────────────────────────────────────────────────────────────

async function verifyTowRisk(
    result: StopRiskResult,
    adjacentTrips: AdjacentTrips,
    sessionKey: string
): Promise<boolean> {
    // If we don't have both trips, we can't strictly verify the "gap", so we trust the fallback or fail safe?
    // User wants to REDUCE false positives. So if we can't verify signal, maybe we assume it's noise if it's borderline?
    // Let's proceed only if we have the trips to check.
    if (!adjacentTrips.prevTrip || !adjacentTrips.nextTrip) return true; // Cannot verify, keep original result

    console.log(`    [VERIFY] Checking Tow Risk signals for stop ${result.stopId}...`);

    try {
        // 1. Fetch END of Previous Trip (last 2 mins)
        // We need a small buffer before the end time
        const prevEnd = new Date(adjacentTrips.prevTrip.end_time);
        const prevStartWindow = new Date(prevEnd.getTime() - 2 * 60 * 1000); // -2 mins

        const prevTrack = await NavixyServerService.getTrack(
            result.trackerId,
            prevStartWindow.toISOString(),
            adjacentTrips.prevTrip.end_time,
            sessionKey
        );

        // 2. Fetch START of Next Trip (first 2 mins)
        const nextStart = new Date(adjacentTrips.nextTrip.start_time);
        const nextEndWindow = new Date(nextStart.getTime() + 2 * 60 * 1000); // +2 mins

        const nextTrack = await NavixyServerService.getTrack(
            result.trackerId,
            adjacentTrips.nextTrip.start_time,
            nextEndWindow.toISOString(),
            sessionKey
        );

        // 3. Check Signal Quality
        const MIN_SATELLITES = 4;

        // Get last point of prev trip
        const lastPoint = prevTrack && prevTrack.length > 0 ? prevTrack[prevTrack.length - 1] : null;
        // Get first point of next trip
        const firstPoint = nextTrack && nextTrack.length > 0 ? nextTrack[0] : null;

        if (!lastPoint || !firstPoint) {
            console.log(`    [VERIFY] FAIL: Missing track points for verification.`);
            return false;
        }

        const sat1 = lastPoint.satellites ?? lastPoint.sat ?? 0;
        const sat2 = firstPoint.satellites ?? firstPoint.sat ?? 0;
        const speed1 = lastPoint.speed ?? 0;
        const speed2 = firstPoint.speed ?? 0;

        console.log(`    [VERIFY] Stats: PrevEnd(Sat=${sat1}, Spd=${speed1}), NextStart(Sat=${sat2}, Spd=${speed2})`);

        if (sat1 < MIN_SATELLITES || sat2 < MIN_SATELLITES) {
            console.log(`    [VERIFY] DISCARDED: Low signal detected.`);
            return false;
        }

        // Rule B: Moving at Gap Boundaries (> 5 km/h) => Tracking Gap/Power Cut while driving (Not a Tow)
        const MAX_GAP_SPEED = 5;
        if (speed1 > MAX_GAP_SPEED || speed2 > MAX_GAP_SPEED) {
            console.log(`    [VERIFY] DISCARDED: Vehicle moving at gap boundaries (Tracking Cut).`);
            return false;
        }

        // 4. Re-calculate Distance with verified points
        const p1 = turf.point([lastPoint.lng, lastPoint.lat]);
        const p2 = turf.point([firstPoint.lng, firstPoint.lat]);
        const dist = turf.distance(p1, p2, { units: 'kilometers' });

        const THRESHOLD = SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS.POSITION_MISMATCH_KM;

        if (dist > THRESHOLD) {
            console.log(`    [VERIFY] CONFIRMED: Distance ${dist.toFixed(2)}km > ${THRESHOLD}km`);
            return true;
        } else {
            console.log(`    [VERIFY] DISCARDED: Verified distance ${dist.toFixed(2)}km <= ${THRESHOLD}km`);
            return false;
        }

    } catch (e) {
        console.error(`    [VERIFY] Error during verification:`, e);
        return true; // Fail open if API error? Or Fail safe? Let's fail open (keep risk) to avoid suppressing real threats on API blips.
    }
}

// ────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const flags: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
        }
    }
    if (!flags.from || !flags.to) {
        console.error('Usage: npx tsx src/scripts/batch-stop-analysis.ts --from YYYY-MM-DD --to YYYY-MM-DD [--batch-size N] [--force] [--skip-hotspots]');
        process.exit(1);
    }
    return {
        from: flags.from,
        to: flags.to,
        batchSize: parseInt(flags['batch-size'] || '500', 10),
        force: flags.force === 'true',
        skipHotspots: flags['skip-hotspots'] === 'true',
    };
}

// ────────────────────────────────────────────────────────────
// Data loaders
// ────────────────────────────────────────────────────────────

async function loadSafeZones(sessionKey: string): Promise<SafeZoneGeo[]> {
    const zones = await NavixyServerService.listZones(sessionKey);
    const safeZones: SafeZoneGeo[] = [];

    for (const z of zones) {
        let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;

        if (z.type === 'circle' && z.center && z.radius) {
            geometry = turf.circle(
                [z.center.lng, z.center.lat],
                z.radius,
                { steps: 32, units: 'meters' },
            ).geometry as GeoJSON.Polygon;
        } else if (z.type === 'polygon' || z.type === 'sausage') {
            if (z.points && z.points.length > 0) {
                const coords = z.points.map((p: any) => [p.lng, p.lat]);
                coords.push(coords[0]);
                geometry = { type: 'Polygon', coordinates: [coords] };
            } else {
                try {
                    const points = await NavixyServerService.listZonePoints(z.id, sessionKey);
                    if (points && points.length > 0) {
                        const coords = points.map((p: any) => [p.lng, p.lat]);
                        coords.push(coords[0]);
                        geometry = { type: 'Polygon', coordinates: [coords] };
                    }
                } catch { /* skip zone */ }
            }
        }

        if (geometry) {
            safeZones.push({ id: z.id, name: z.label || z.name || `Zone ${z.id}`, geometry });
        }
    }

    return safeZones;
}

async function loadExistingRiskHexes(supabase: any): Promise<RiskHexLookup[]> {
    const { data, error } = await supabase
        .from('risk_zone_hexes')
        .select('h3_index, risk_score')
        .gte('risk_score', 30)
        .order('version', { ascending: false })
        .limit(5000);

    if (error || !data) return [];

    // Deduplicate to latest version per hex
    const seen = new Set<string>();
    const results: RiskHexLookup[] = [];
    for (const row of data) {
        if (!seen.has(row.h3_index)) {
            seen.add(row.h3_index);
            results.push({ h3Index: row.h3_index, riskScore: row.risk_score });
        }
    }
    return results;
}

async function loadVehicleProfile(
    supabase: any,
    trackerId: number,
    lookbackDate: string,
): Promise<VehicleStopProfile> {
    // Median duration
    const { data: medianData } = await supabase.rpc('get_vehicle_stop_median', {
        p_tracker_id: trackerId,
        p_from_date: lookbackDate,
    }).maybeSingle();

    // We handle the case where the RPC doesn't exist yet — fallback to manual query
    let medianDuration = 3600; // 1h default
    let nightMedianDuration = 7200; // 2h default

    if (medianData) {
        medianDuration = medianData.median_duration ?? 3600;
        nightMedianDuration = medianData.night_median_duration ?? 7200;
    } else {
        // Fallback: simple query
        const { data: stops } = await supabase
            .from('stops')
            .select('duration_seconds, start_time')
            .eq('tracker_id', trackerId)
            .gte('trip_date', lookbackDate)
            .not('duration_seconds', 'is', null)
            .order('duration_seconds', { ascending: true })
            .limit(500);

        if (stops && stops.length > 0) {
            const durations = stops.map((s: any) => s.duration_seconds as number).sort((a: number, b: number) => a - b);
            medianDuration = durations[Math.floor(durations.length / 2)];

            const nightDurations = stops
                .filter((s: any) => {
                    const h = new Date(s.start_time).getUTCHours();
                    return h >= 22 || h < 5;
                })
                .map((s: any) => s.duration_seconds as number)
                .sort((a: number, b: number) => a - b);

            if (nightDurations.length > 0) {
                nightMedianDuration = nightDurations[Math.floor(nightDurations.length / 2)];
            }
        }
    }

    // Frequent locations (round to ~100 m precision)
    const { data: locData } = await supabase
        .from('stops')
        .select('lat, lng')
        .eq('tracker_id', trackerId)
        .gte('trip_date', lookbackDate)
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .limit(1000);

    const frequentLocations: VehicleStopProfile['frequentLocations'] = [];

    if (locData && locData.length > 0) {
        // Grid-snap to ~100 m and count
        const gridMap = new Map<string, { sumLat: number; sumLng: number; count: number }>();
        for (const row of locData) {
            const key = `${(row.lat as number).toFixed(3)},${(row.lng as number).toFixed(3)}`;
            const entry = gridMap.get(key) || { sumLat: 0, sumLng: 0, count: 0 };
            entry.sumLat += row.lat as number;
            entry.sumLng += row.lng as number;
            entry.count++;
            gridMap.set(key, entry);
        }
        for (const entry of Array.from(gridMap.values())) {
            if (entry.count >= 2) {
                frequentLocations.push({
                    lat: entry.sumLat / entry.count,
                    lng: entry.sumLng / entry.count,
                    count: entry.count,
                });
            }
        }
        frequentLocations.sort((a, b) => b.count - a.count);
    }

    return {
        trackerId,
        medianDurationSeconds: medianDuration,
        nightMedianDurationSeconds: nightMedianDuration,
        frequentLocations: frequentLocations.slice(0, 50),
    };
}

async function loadAdjacentTrips(
    supabase: any,
    trackerId: number,
    stopStart: string,
    stopEnd: string | null,
): Promise<AdjacentTrips> {
    const result: AdjacentTrips = {};

    // Previous trip (ended before this stop started)
    const { data: prevData } = await supabase
        .from('v_ai_trip_logs')
        .select('trip_id, end_time, end_geom, distance_km, duration_hours')
        .eq('tracker_id', trackerId)
        .lte('end_time', stopStart)
        .order('end_time', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (prevData?.end_geom?.coordinates) {
        result.prevTrip = {
            trip_id: prevData.trip_id,
            end_time: prevData.end_time,
            end_lat: prevData.end_geom.coordinates[1],
            end_lng: prevData.end_geom.coordinates[0],
            distance_km: prevData.distance_km ?? 0,
            duration_hours: prevData.duration_hours ?? 0,
        };
    }

    // Next trip (started after this stop ended)
    if (stopEnd) {
        const { data: nextData } = await supabase
            .from('v_ai_trip_logs')
            .select('trip_id, start_time, start_geom')
            .eq('tracker_id', trackerId)
            .gte('start_time', stopEnd)
            .order('start_time', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (nextData?.start_geom?.coordinates) {
            result.nextTrip = {
                trip_id: nextData.trip_id,
                start_time: nextData.start_time,
                start_lat: nextData.start_geom.coordinates[1],
                start_lng: nextData.start_geom.coordinates[0],
            };
        }
    }

    return result;
}

// ────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────

interface Stats {
    total: number;
    scored: number;
    skipped: number;
    skippedNoCoords: number;
    skippedShort: number;
    skippedAlreadyScored: number;
    errors: number;
    critical: number;
    warning: number;
    minor: number;
    safe: number;
}

async function main() {
    const opts = parseArgs();
    const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;

    if (!sessionKey) {
        console.error('Missing NEXT_PUBLIC_NAVIXY_SESSION_KEY in .env.local');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('  UNIFLEET STOP SECURITY ANALYSIS');
    console.log('  H3 Hexagonal Hotspot Detection + DBSCAN Clustering');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Date range:      ${opts.from} → ${opts.to}`);
    console.log(`  Batch size:      ${opts.batchSize}`);
    console.log(`  Force re-score:  ${opts.force}`);
    console.log(`  Skip hotspots:   ${opts.skipHotspots}`);
    console.log('═══════════════════════════════════════════════════════\n');

    const supabase = getSupabaseAdmin();
    const H3_CONF = SCORING_THRESHOLDS.STOP_RISK.H3;

    // ── Phase 1: Load context ──────────────────────────────

    console.log('[Phase 1] Loading context...');

    console.log('  Fetching Safe Zones from Navixy...');
    const safeZones = await loadSafeZones(sessionKey);
    console.log(`  Loaded ${safeZones.length} safe zones.`);

    console.log('  Loading existing risk hexes...');
    const riskHexes = await loadExistingRiskHexes(supabase);
    console.log(`  Loaded ${riskHexes.length} risk hexes.\n`);

    // ── Phase 2: Fetch & score stops ───────────────────────

    console.log('[Phase 2] Scoring stops...');

    const { count: totalCount } = await supabase
        .from('stops')
        .select('id', { count: 'exact', head: true })
        .gte('trip_date', opts.from)
        .lte('trip_date', opts.to)
        .not('lat', 'is', null)
        .not('lng', 'is', null);

    const totalStops = totalCount || 0;
    console.log(`  Found ${totalStops} stops with coordinates in date range.\n`);

    if (totalStops === 0) {
        console.log('No stops to process. Exiting.');
        return;
    }

    const stats: Stats = {
        total: totalStops,
        scored: 0, skipped: 0, skippedNoCoords: 0, skippedShort: 0,
        skippedAlreadyScored: 0, errors: 0,
        critical: 0, warning: 0, minor: 0, safe: 0,
    };

    const allScoredStops: StopRiskResult[] = [];

    // Vehicle profile cache (avoid re-querying for same tracker)
    const profileCache = new Map<number, VehicleStopProfile>();
    const lookbackDate = new Date(opts.from);
    lookbackDate.setDate(lookbackDate.getDate() - H3_CONF.ROLLING_WINDOW_DAYS);
    const lookbackStr = lookbackDate.toISOString().split('T')[0];

    let offset = 0;
    let batchNum = 0;
    const totalBatches = Math.ceil(totalStops / opts.batchSize);

    while (true) {
        batchNum++;

        const { data: stops, error: fetchErr } = await supabase
            .from('stops')
            .select('id, tracker_id, tracker_name, start_time, end_time, duration_seconds, lat, lng, address, trip_date, ignition_on_seconds, ignition_on_percent')
            .gte('trip_date', opts.from)
            .lte('trip_date', opts.to)
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .order('tracker_id', { ascending: true })
            .order('start_time', { ascending: true })
            .range(offset, offset + opts.batchSize - 1);

        if (fetchErr) {
            console.error(`[FATAL] Failed to fetch stops: ${fetchErr.message}`);
            break;
        }
        if (!stops || stops.length === 0) break;

        // Skip already-scored (unless --force)
        let toProcess: StopRecord[] = stops as StopRecord[];

        if (!opts.force) {
            const stopIds = stops.map((s: any) => s.id);
            const { data: existing } = await supabase
                .from('stop_risk_scores')
                .select('stop_id')
                .in('stop_id', stopIds);

            const scoredSet = new Set((existing || []).map((e: any) => e.stop_id));
            const before = toProcess.length;
            toProcess = toProcess.filter(s => !scoredSet.has(s.id));
            stats.skippedAlreadyScored += before - toProcess.length;
        }

        console.log(`  [Batch ${batchNum}/${totalBatches}] ${toProcess.length} to score (${stops.length - toProcess.length} already done)`);

        for (const stop of toProcess) {
            try {
                // Load vehicle profile (cached)
                if (!profileCache.has(stop.tracker_id)) {
                    profileCache.set(
                        stop.tracker_id,
                        await loadVehicleProfile(supabase, stop.tracker_id, lookbackStr),
                    );
                }
                const profile = profileCache.get(stop.tracker_id)!;

                // Load adjacent trips for position mismatch + short trip detection
                const adjacentTrips = await loadAdjacentTrips(
                    supabase, stop.tracker_id, stop.start_time, stop.end_time,
                );

                // Score
                const result = analyzeStop({
                    stop,
                    safeZones,
                    riskHexes,
                    vehicleProfile: profile,
                    adjacentTrips,
                });

                if (!result) {
                    stats.skippedShort++;
                    continue;
                }

                // --- NEW: VERIFY TOW RISK (if detected) ---
                if (result.isPositionMismatch) {
                    const isConfirmed = await verifyTowRisk(result, adjacentTrips, sessionKey);
                    if (!isConfirmed) {
                        // Downgrade: remove the flag and the score points
                        result.isPositionMismatch = false;
                        result.positionMismatchKm = null;

                        // Remove "POSITION_MISMATCH_TOW_RISK" from reasons
                        result.riskReasons = result.riskReasons.filter(r => r !== 'POSITION_MISMATCH_TOW_RISK');

                        // Deduct score
                        const W = SCORING_THRESHOLDS.STOP_RISK.WEIGHTS;
                        result.riskScore = Math.max(0, result.riskScore - W.POSITION_MISMATCH);

                        // Re-evaluate severity
                        const T = SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS;
                        result.severityLevel =
                            result.riskScore >= T.CRITICAL ? 'CRITICAL' :
                                result.riskScore >= T.WARNING ? 'WARNING' :
                                    'MINOR';
                    }
                }

                // Persist
                const row = {
                    stop_id: result.stopId,
                    tracker_id: result.trackerId,
                    tracker_name: result.trackerName,
                    risk_score: result.riskScore,
                    severity_level: result.severityLevel,
                    risk_reasons: result.riskReasons,
                    stop_lat: result.stopLat,
                    stop_lng: result.stopLng,
                    stop_start: result.stopStart,
                    stop_end: result.stopEnd,
                    stop_duration_hours: result.stopDurationHours,
                    h3_index: result.h3Index,
                    is_night_stop: result.isNightStop,
                    is_in_risk_zone: result.isInRiskZone,
                    risk_zone_h3: result.riskZoneH3,
                    is_in_safe_zone: result.isInSafeZone,
                    safe_zone_name: result.safeZoneName,
                    is_ignition_anomaly: result.isIgnitionAnomaly,
                    ignition_on_percent: result.ignitionOnPercent,
                    is_long_duration: result.isLongDuration,
                    is_position_mismatch: result.isPositionMismatch,
                    position_mismatch_km: result.positionMismatchKm,
                    is_repeat_location: result.isRepeatLocation,
                    repeat_count: result.repeatCount,
                    is_unusual_location: result.isUnusualLocation,
                    nearest_historical_km: result.nearestHistoricalKm,
                    is_short_preceding_trip: result.isShortPrecedingTrip,
                    prev_trip_id: result.prevTripId,
                    next_trip_id: result.nextTripId,
                    analyzed_at: new Date().toISOString(),
                };

                const { error: upsertErr } = await supabase
                    .from('stop_risk_scores')
                    .upsert(row, { onConflict: 'stop_id' });

                if (upsertErr) {
                    console.error(`    [ERR] stop ${stop.id}: ${upsertErr.message}`);
                    stats.errors++;
                    continue;
                }

                allScoredStops.push(result);
                stats.scored++;

                if (result.severityLevel === 'CRITICAL') stats.critical++;
                else if (result.severityLevel === 'WARNING') stats.warning++;
                else if (result.riskScore > 0) stats.minor++;
                else stats.safe++;

                // Inline progress for high-risk stops
                if (result.riskScore >= 40) {
                    console.log(`    [${result.severityLevel}] score=${result.riskScore} tracker=${stop.tracker_id} reasons=${result.riskReasons.join(', ')}`);
                }
            } catch (err: any) {
                console.error(`    [ERR] stop ${stop.id}: ${err.message}`);
                stats.errors++;
            }
        }

        // Progress
        const done = stats.scored + stats.skippedAlreadyScored + stats.skippedShort + stats.errors;
        console.log(`  Progress: ${done}/${totalStops} | C:${stats.critical} W:${stats.warning} M:${stats.minor} safe:${stats.safe} err:${stats.errors}`);

        offset += opts.batchSize;
        if (stops.length < opts.batchSize) break;
    }

    // ── Phase 3: H3 aggregation + DBSCAN ────────────────────

    if (!opts.skipHotspots && allScoredStops.length > 0) {
        console.log('\n[Phase 3] Building H3 hotspot grid...');

        // Also load historically scored stops for the rolling window
        const { data: historicalStops } = await supabase
            .from('stop_risk_scores')
            .select('stop_id, tracker_id, tracker_name, risk_score, severity_level, risk_reasons, stop_lat, stop_lng, stop_start, stop_end, stop_duration_hours, h3_index, is_night_stop, is_in_risk_zone, risk_zone_h3, is_in_safe_zone, safe_zone_name, is_ignition_anomaly, ignition_on_percent, is_long_duration, is_position_mismatch, position_mismatch_km, is_repeat_location, repeat_count, is_unusual_location, nearest_historical_km, is_short_preceding_trip, is_remote_highway, corridor_avg_speed, prev_trip_id, next_trip_id')
            .gte('stop_start', lookbackStr)
            .gte('risk_score', 20)
            .limit(10000);

        // Merge current + historical (deduplicate by stopId)
        const seenIds = new Set(allScoredStops.map(s => s.stopId));
        const mergedStops = [...allScoredStops];

        if (historicalStops) {
            for (const row of historicalStops) {
                if (!seenIds.has(row.stop_id)) {
                    seenIds.add(row.stop_id);
                    mergedStops.push({
                        stopId: row.stop_id,
                        trackerId: row.tracker_id,
                        trackerName: row.tracker_name,
                        riskScore: row.risk_score,
                        severityLevel: row.severity_level,
                        riskReasons: row.risk_reasons || [],
                        stopLat: row.stop_lat,
                        stopLng: row.stop_lng,
                        stopStart: row.stop_start,
                        stopEnd: row.stop_end,
                        stopDurationHours: row.stop_duration_hours,
                        h3Index: row.h3_index,
                        isNightStop: row.is_night_stop,
                        isInRiskZone: row.is_in_risk_zone,
                        riskZoneH3: row.risk_zone_h3,
                        isInSafeZone: row.is_in_safe_zone,
                        safeZoneName: row.safe_zone_name,
                        isIgnitionAnomaly: row.is_ignition_anomaly,
                        ignitionOnPercent: row.ignition_on_percent,
                        isLongDuration: row.is_long_duration,
                        isPositionMismatch: row.is_position_mismatch,
                        positionMismatchKm: row.position_mismatch_km,
                        isRepeatLocation: row.is_repeat_location,
                        repeatCount: row.repeat_count,
                        isUnusualLocation: row.is_unusual_location,
                        nearestHistoricalKm: row.nearest_historical_km,
                        isShortPrecedingTrip: row.is_short_preceding_trip,
                        isRemoteHighway: row.is_remote_highway,
                        corridorAvgSpeed: row.corridor_avg_speed,
                        prevTripId: row.prev_trip_id,
                        nextTripId: row.next_trip_id,
                    });
                }
            }
        }

        console.log(`  Aggregating ${mergedStops.length} scored stops into H3 grid...`);

        // 3a. Aggregate to hex grid
        let hexGrid = aggregateStopsToHexGrid(mergedStops);
        console.log(`  Generated ${hexGrid.length} risk hexes.`);

        // 3b. Propagate risk to neighbours
        hexGrid = propagateRisk(hexGrid, 1);
        console.log(`  After propagation: ${hexGrid.length} hexes.`);

        // 3c. DBSCAN cluster
        const clusters = clusterRiskHexes(hexGrid);
        console.log(`  DBSCAN found ${clusters.length} risk zone clusters.\n`);

        // 3d. Determine next version number
        const { data: versionData } = await supabase
            .from('risk_zone_hexes')
            .select('version')
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextVersion = (versionData?.version ?? 0) + 1;
        console.log(`  Persisting as version ${nextVersion}...`);

        // 3e. Insert hex grid
        if (hexGrid.length > 0) {
            const hexRows = hexGrid.map(h => ({
                h3_index: h.h3Index,
                h3_resolution: h.h3Resolution,
                risk_score: h.riskScore,
                incident_count: h.incidentCount,
                critical_count: h.criticalCount,
                warning_count: h.warningCount,
                night_incident_count: h.nightIncidentCount,
                day_incident_count: h.dayIncidentCount,
                reason_distribution: h.reasonDistribution,
                center_lat: h.centerLat,
                center_lng: h.centerLng,
                boundary_geojson: h.boundaryGeojson,
                window_days: H3_CONF.ROLLING_WINDOW_DAYS,
                version: nextVersion,
            }));

            // Insert in batches of 200
            for (let i = 0; i < hexRows.length; i += 200) {
                const chunk = hexRows.slice(i, i + 200);
                const { error } = await supabase.from('risk_zone_hexes').insert(chunk);
                if (error) console.error(`  [ERR] Hex insert batch ${i}: ${error.message}`);
            }
            console.log(`  Inserted ${hexRows.length} hex rows.`);
        }

        // 3f. Insert clusters
        if (clusters.length > 0) {
            const clusterRows = clusters.map(c => ({
                cluster_id: c.clusterId,
                risk_score: c.riskScore,
                hex_count: c.hexCount,
                incident_count: c.incidentCount,
                polygon_geojson: c.polygonGeojson,
                center_lat: c.centerLat,
                center_lng: c.centerLng,
                is_night_dominant: c.isNightDominant,
                primary_reason: c.primaryReason,
                reason_distribution: c.reasonDistribution,
                version: nextVersion,
            }));

            const { error } = await supabase.from('risk_zone_clusters').insert(clusterRows);
            if (error) console.error(`  [ERR] Cluster insert: ${error.message}`);
            else console.log(`  Inserted ${clusterRows.length} cluster rows.`);
        }

        // Log top risk hexes
        const topHexes = hexGrid.filter(h => h.incidentCount > 0).slice(0, 10);
        if (topHexes.length > 0) {
            console.log('\n  ── Top 10 Risk Hexes ──');
            for (const h of topHexes) {
                const topReason = Object.entries(h.reasonDistribution)
                    .sort((a, b) => b[1] - a[1])[0];
                console.log(
                    `  H3=${h.h3Index.slice(0, 12)}… score=${h.riskScore} incidents=${h.incidentCount} ` +
                    `night=${h.nightIncidentCount} reason=${topReason?.[0] || '-'} ` +
                    `(${h.centerLat.toFixed(3)}, ${h.centerLng.toFixed(3)})`,
                );
            }
        }
    }

    // ── Summary ─────────────────────────────────────────────

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  STOP SECURITY ANALYSIS COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Total stops in range:       ${stats.total}`);
    console.log(`  Scored:                     ${stats.scored}`);
    console.log(`  Skipped (already scored):   ${stats.skippedAlreadyScored}`);
    console.log(`  Skipped (too short / null):  ${stats.skippedShort}`);
    console.log(`  Errors:                     ${stats.errors}`);
    console.log(`  ─────────────────────────────`);
    console.log(`  CRITICAL:                   ${stats.critical}`);
    console.log(`  WARNING:                    ${stats.warning}`);
    console.log(`  MINOR:                      ${stats.minor}`);
    console.log(`  SAFE (score 0):             ${stats.safe}`);
    console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
