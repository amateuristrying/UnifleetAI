import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { NavixyServerService } from '@/services/navixy-server';
import { analyzeRouteDeviation } from '@/lib/route-analysis';
import { SeverityLevel } from '@/types/security';
import * as turf from '@turf/turf';
import { RouteLearningService } from '@/services/route-learning';
import { SCORING_THRESHOLDS } from '@/lib/telematics-config';
import { latLngToCell } from 'h3-js';

// 5 Minutes timeout for batch processing
export const maxDuration = 300;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { dateFrom, dateTo, limit = 5 } = body;

        // 1. Setup
        const supabase = getSupabaseAdmin();
        const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
        const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

        if (!sessionKey || !mapboxToken) {
            return NextResponse.json({ success: false, error: 'Server configuration missing' }, { status: 500 });
        }

        // 2. Find eligible trips (not yet analyzed)
        // We do a "Not In" check manually or via a Left Join query
        // For simplicity: Get recent trips, check against existing IDs

        // A. Get Trips
        let query = supabase
            .from('v_ai_trip_logs')
            .select('*')
            .order('start_time', { ascending: false });

        if (dateFrom) query = query.gte('trip_date', dateFrom);
        if (dateTo) query = query.lte('trip_date', dateTo);

        // Fetch a bit more than limit to account for already analyzed ones
        const { data: trips, error: tripError } = await query.limit(limit * 5);

        if (tripError || !trips) {
            return NextResponse.json({ success: false, error: tripError?.message }, { status: 500 });
        }

        // B. Get Analyzed IDs
        const tripIds = trips.map(t => t.trip_id);
        const { data: analyzed, error: analyzedError } = await supabase
            .from('route_security_events')
            .select('trip_id')
            .in('trip_id', tripIds);

        const analyzedSet = new Set(analyzed?.map(a => a.trip_id) || []);

        // C. Filter
        const pendingTrips = trips.filter(t => !analyzedSet.has(t.trip_id)).slice(0, limit);

        if (pendingTrips.length === 0) {
            return NextResponse.json({
                success: true,
                processed: 0,
                remaining: 0,
                message: 'No new trips to analyze in this range.'
            });
        }

        // 2a. Fetch Safe Zones (once per batch)
        let safeZones: any[] = [];
        try {
            const zones = await NavixyServerService.listZones(sessionKey);
            // We need geometry. Best effort: if points are included, use them. 
            // If not, we might need to fetch points for each polygon zone, which is expensive.
            // Strategy: Only use zones that have 'points' or 'radius' (circles) in the list response.
            // If Navixy list response doesn't include points for polygons, we would need to batch fetch them.
            // For now, let's assume circles and see if we can get points.

            // Optimization: Fetch points for known critical zones or all polygons?
            // To be robust, let's filter only needed zones types if possible.
            safeZones = zones.map((z: any) => ({
                id: z.id,
                label: z.label,
                geometry: null // Logic to build geometry
            }));

            // Populate geometry
            // Note: Navixy listZones usually requires separate call for points for large polygons?
            // Let's rely on what we get. If points are missing, we skip safe zone check for that zone.
            // Actually, the hook `useGeofences` does a batch fetch. We should do similar if needed.
            // BUT for batch analysis, let's try to be efficient. 
            // Let's assume for this iteration we support Circular zones (common for depots) + Polygons if points present.

            safeZones = await Promise.all(zones.map(async (z: any) => {
                let geometry = null;
                if (z.type === 'circle' && z.center && z.radius) {
                    // Convert circle to Polygon approximation or keep as custom type for turf?
                    // Turf doesn't have native circle geometry type for booleanPointInPolygon.
                    // We can use turf.circle to generate a polygon.
                    geometry = turf.circle([z.center.lng, z.center.lat], z.radius, { steps: SCORING_THRESHOLDS.CIRCLE_GEOFENCE.POLYGON_STEPS, units: 'meters' }).geometry;
                } else if ((z.type === 'polygon' || z.type === 'sausage')) {
                    if (z.points && z.points.length > 0) {
                        const coords = z.points.map((p: any) => [p.lng, p.lat]);
                        coords.push(coords[0]); // close loop
                        geometry = { type: 'Polygon', coordinates: [coords] };
                    } else {
                        // Fetch points if missing and critical? Skipping for speed in this MVP.
                        // Or implement `listZonePoints` usage if we really need it.
                        // Let's fetch points for Polygons.
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

            // Filter out null geometries
            safeZones = safeZones.filter(z => z.geometry !== null);

        } catch (e) {
            console.error('Failed to load safe zones', e);
        }

        // 3. Process Batch
        let processedCount = 0;

        for (const trip of pendingTrips) {
            try {
                // A. Fetch Track
                // Ensure we have valid GPS points
                if (!trip.start_geom || !trip.end_geom) continue;

                const trackPoints = await NavixyServerService.getTrack(
                    trip.tracker_id,
                    trip.start_time,
                    trip.end_time,
                    sessionKey
                );

                if (!trackPoints || trackPoints.length < 2) continue;

                // B. Analyze
                const startCoords = trip.start_geom.coordinates; // [lng, lat]
                const endCoords = trip.end_geom.coordinates;

                const result = await analyzeRouteDeviation({
                    startCoords: [startCoords[0], startCoords[1]],
                    endCoords: [endCoords[0], endCoords[1]],
                    trackPoints: trackPoints.map((p: any) => ({
                        lat: p.lat,
                        lng: p.lng,
                        time: p.get_time || p.time, // Navixy API returns 'get_time'
                        sat: p.sat,
                        speed: p.speed
                    })),
                    mapboxToken,
                    enableMapMatching: true,
                    safeZones // Pass the loaded safe zones
                });

                // C. Persist
                const dsr = result.actualKm > 0 ? (result.deviationKm / result.actualKm) * 100 : 0;
                let severity: SeverityLevel = 'MINOR';
                if (dsr > 15) severity = 'CRITICAL';
                else if (dsr > 5) severity = 'WARNING';

                let riskScore = result.riskScore || 0;
                const riskReasons = result.riskReasons || [];

                // --- RISK ENGINE INTEGRATION ---
                // 1. Check Stops against Risk Zones & Corridors
                if (result.stopEvents?.length > 0) {
                    for (const stop of result.stopEvents) {
                        // Skip authorized stops
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

                            // 2. Persist Derived Stop (for Nightly Clustering)
                            await supabase.from('derived_stops').insert({
                                trip_id: trip.trip_id,
                                tracker_id: trip.tracker_id,
                                start_time: stop.startTime || new Date(trip.start_time).toISOString(),
                                end_time: stop.endTime,
                                duration_mins: stop.duration_mins,
                                location: `POINT(${stop.lng} ${stop.lat})`,
                                location_h3: latLngToCell(stop.lat, stop.lng, 9),
                                is_night_stop: false,
                                risk_score: stopRisk.score
                            });

                        } catch (err) {
                            console.warn('Risk engine check failed for stop:', err);
                        }
                    }
                }

                // 2. Check Deviation Segments (Corridor Check)
                // If we have deviations, check if they are "New Roads" or just "Off Route"
                // (Optional enhancement for later)

                // P2.8: Repeat Offender — use config weight instead of hardcoded value
                try {
                    const sevenDaysAgo = new Date();
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                    const { count, error: historyError } = await supabase
                        .from('route_security_events')
                        .select('*', { count: 'exact', head: true })
                        .eq('tracker_id', trip.tracker_id)
                        .gte('analyzed_at', sevenDaysAgo.toISOString())
                        .or('severity_level.eq.CRITICAL,unauthorized_stops.gt.0');

                    if (!historyError && count !== null && count > 2) {
                        riskScore += SCORING_THRESHOLDS.RISK_SCORING.WEIGHTS.REPEAT_OFFENDER;
                        riskReasons.push(`REPEAT_OFFENDER_(${count}_PRIOR)`);
                    }
                } catch (hErr) {
                    console.warn('Failed to check history for repeat offender:', hErr);
                }

                // Cap Score
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
                    // New Fields
                    p_risk_score: riskScore,
                    p_risk_reasons: riskReasons
                });

                processedCount++;

            } catch (err) {
                console.error(`[BatchAnalyze] Failed trip ${trip.trip_id}:`, err);
            }
        }

        return NextResponse.json({
            success: true,
            processed: processedCount,
            remaining: pendingTrips.length - processedCount // Approximation/Logic specific
        });

    } catch (err: any) {
        console.error('[BatchAnalyze] Error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
