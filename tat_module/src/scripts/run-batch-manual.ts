
import { getSupabaseAdmin } from '../lib/supabase-server';
import { NavixyServerService } from '../services/navixy-server';
import { analyzeRouteDeviation } from '../lib/route-analysis';
import { RouteLearningService } from '../services/route-learning'; // Added for corridor learning
import { SeverityLevel } from '../types/security';
import * as turf from '@turf/turf';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// FORCE OVERRIDE: Use direct Navixy API URL for this server-side script
// (The .env might point to /api/navixy for client-side proxy usage)
process.env.NEXT_PUBLIC_NAVIXY_API_URL = 'https://api.navixy.com/v2';

// Mock globals if needed (e.g. fetch is global in Node 18+)
// If strictly needed: import fetch from 'node-fetch'; global.fetch = fetch;

async function run() {
    const DATE_TARGET = '2025-10-31';
    const dateFrom = `${DATE_TARGET}T00:00:00.000Z`;
    const dateTo = `${DATE_TARGET}T23:59:59.999Z`;

    console.log(`🚀 Starting Manual Analysis for ${DATE_TARGET}`);
    console.log(`Range: ${dateFrom} to ${dateTo}`);

    const supabase = getSupabaseAdmin();
    const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!sessionKey || !mapboxToken) {
        console.error('Missing configuration');
        process.exit(1);
    }

    // 1. Fetch Safe Zones
    let safeZones: any[] = [];
    try {
        console.log('Fetching Safe Zones...');
        const zones = await NavixyServerService.listZones(sessionKey);

        safeZones = await Promise.all(zones.map(async (z: any) => {
            let geometry = null;
            if (z.type === 'circle' && z.center && z.radius) {
                geometry = turf.circle([z.center.lng, z.center.lat], z.radius, { steps: 10, units: 'meters' }).geometry;
            } else if ((z.type === 'polygon' || z.type === 'sausage')) {
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
                    } catch (e) { }
                }
            }
            return { id: z.id, label: z.label, geometry };
        }));

        safeZones = safeZones.filter(z => z.geometry !== null);
        console.log(`Loaded ${safeZones.length} Safe Zones.`);
    } catch (e) {
        console.error('Failed to load safe zones', e);
    }

    // 2. Fetch Trips
    console.log('Fetching Trips...');
    const { data: trips, error } = await supabase
        .from('v_ai_trip_logs')
        .select('*')
        .gte('trip_date', dateFrom)
        .lte('trip_date', dateTo);

    if (error || !trips) {
        console.error('Error fetching trips:', error);
        return;
    }

    console.log(`Found ${trips.length} trips.`);

    let processedCount = 0;

    // 3. Process Each
    for (const trip of trips) {
        // Simple log
        process.stdout.write(`Analyzing Trip ${trip.trip_id} (${processedCount + 1}/${trips.length})... `);

        try {
            if (!trip.start_geom || !trip.end_geom) {
                console.log('Skipped (No Geom)');
                continue;
            }

            const trackPoints = await NavixyServerService.getTrack(
                trip.tracker_id,
                trip.start_time,
                trip.end_time,
                sessionKey
            );

            if (!trackPoints || trackPoints.length < 2) {
                console.log('Skipped (No Track)');
                continue;
            }

            console.log('[DebugTrackPoint]', trackPoints[0]);

            const startCoords = trip.start_geom.coordinates;
            const endCoords = trip.end_geom.coordinates;

            const result = await analyzeRouteDeviation({
                startCoords: [startCoords[0], startCoords[1]],
                endCoords: [endCoords[0], endCoords[1]],
                trackPoints: trackPoints.map((p: any) => ({
                    lat: p.lat,
                    lng: p.lng,
                    time: p.get_time || p.time,
                    sat: p.sat,
                    speed: p.speed
                })),
                mapboxToken,
                enableMapMatching: true,
                safeZones
            });

            // 3b. Learn Corridors (Populate fleet_corridors with metadata)
            // This ensures tracker_id, day_of_week, etc. are captured
            try {
                const h3Count = await RouteLearningService.learnCorridorsFromTrack(
                    trackPoints.map((p: any) => ({
                        lat: p.lat,
                        lng: p.lng,
                        time: p.get_time ? (new Date(p.get_time).getTime() / 1000) : p.time
                    })),
                    trip.tracker_id
                );
                process.stdout.write(` [Learned ${h3Count} hexes]`);
            } catch (learnErr) {
                console.error('Learning failed', learnErr);
            }

            // Persist
            const dsr = result.actualKm > 0 ? (result.deviationKm / result.actualKm) * 100 : 0;
            let severity: SeverityLevel = 'MINOR';
            if (dsr > 15) severity = 'CRITICAL';
            else if (dsr > 5) severity = 'WARNING';

            // Repeat Offender Check
            let riskScore = result.riskScore || 0;
            const riskReasons = result.riskReasons || [];

            try {
                const sevenDaysAgo = new Date(trip.start_time);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                const { count, error: historyError } = await supabase
                    .from('route_security_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('tracker_id', trip.tracker_id)
                    .gte('analyzed_at', sevenDaysAgo.toISOString()) // Approximate check against analysis time
                    .or('severity_level.eq.CRITICAL,unauthorized_stops.gt.0');

                if (!historyError && count !== null && count > 2) {
                    riskScore += 15;
                    riskReasons.push(`REPEAT_OFFENDER_(${count}_PRIOR)`);
                }
            } catch (hErr) { }

            riskScore = Math.min(riskScore, 100);

            await supabase.rpc('upsert_security_analysis', {
                p_trip_id: trip.trip_id,
                p_tracker_id: trip.tracker_id,
                p_tracker_name: trip.tracker_name,
                p_proposed_km: result.proposedKm,
                p_actual_km: result.actualKm,
                p_deviation_km: result.deviationKm,
                p_deviation_severity_ratio: dsr,
                p_severity_level: severity,
                p_route_breaches: result.routeBreaches,
                p_unauthorized_stops: result.unauthorizedStops,
                p_deviation_segments: result.deviationSegments ? result.deviationSegments : null,
                p_stop_events: result.stopEvents?.length > 0 ? result.stopEvents : null,
                p_risk_score: riskScore,
                p_risk_reasons: riskReasons
            });

            console.log(`Done. Score: ${riskScore} | Stops: ${result.unauthorizedStops}`);
            processedCount++;

        } catch (err: any) {
            console.log(`Error: ${err.message}`);
        }
    }

    console.log('\n✅ Batch Analysis Complete.');
}

run();
