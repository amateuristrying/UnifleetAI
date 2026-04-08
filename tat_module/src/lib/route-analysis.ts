/**
 * Route Deviation Analysis Engine
 *
 * PRO VERSION: Adaptive Tolerance & Context Aware
 *
 * Key Capabilities:
 * - Adaptive Tolerance: 25m (Highway) -> 60m (City) -> Dynamic (Signal/Terrain)
 * - Map Matching: Extracts road metadata (Speed Limits, Typical Speeds)
 * - Signal Aware: Relaxes rules when GPS signal is poor (Satellites < 4)
 * - Terrain Aware: Detects winding roads / hills to reduce false positives
 */

import * as turf from '@turf/turf';
import { SCORING_THRESHOLDS } from './telematics-config';
import type { SeverityLevel, StopEvent } from '../types/security';
export interface RouteAnalysisResult {
    proposedKm: number;
    actualKm: number;
    deviationKm: number;
    unauthorizedStops: number;
    routeBreaches: number;
    deviationSegments: GeoJSON.FeatureCollection<GeoJSON.LineString> | null;
    stopEvents: StopEvent[];

    // Risk Scoring
    riskScore?: number;
    riskReasons?: string[];

    // New Visualization Fields
    terrainType?: 'FLAT' | 'HILLY' | 'WINDING'; /* Computed from Sinuosity */
    sinuosity?: number;
    avgSpeedCurrent?: number; /* Avg speed of actual trip */
    speedLimitSegments?: GeoJSON.FeatureCollection<GeoJSON.LineString>; /* For map visualization */
    speedLimitPoints?: GeoJSON.FeatureCollection<GeoJSON.Point>; /* For Sign Icons */

    // Match Quality Metrics
    matchConfidence?: number; /* 0-1 score from Mapbox */
    fractionMatched?: number; /* % of points successfully matched */
    distanceRatio?: number; /* matched_distance / raw_distance */
    isGoodMatch?: boolean; /* heuristic based on above metrics */
}


// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface AnalysisParams {
    startCoords: [number, number];                          // [lng, lat]
    endCoords: [number, number];                            // [lng, lat]
    trackPoints: Array<{
        lat: number;
        lng: number;
        time: string | number;
        sat?: number;       // Satellite count (Navixy)
        alt?: number;       // Altitude (Navixy)
        speed?: number;     // Speed (Navixy)
    }>;
    mapboxToken: string;
    profile?: 'mapbox/driving' | 'mapbox/driving-traffic'; // default mapbox/driving
    toleranceMeters?: number;       // Base tolerance (overridden by adaptive engine if enabled)
    enableMapMatching?: boolean;    // default true for PRO analysis

    // NEW: Safe Zones (Geofences) to exclude from unauthorized stop detection
    safeZones?: Array<{
        id: number;
        label: string;
        geometry: any; // Turf Polygon/MultiPolygon or Circle (Point + Radius)
        radius?: number; // For circle geofences (meters)
    }>;

    // P2.8: Pre-computed risk context (injected by batch pipeline)
    hotspotStopScore?: number;      // Score from known hotspot stops
    repeatOffenderCount?: number;   // Number of prior incidents for this tracker
}

interface RawTrackPoint {
    lng: number;
    lat: number;
    time: number;   // unix seconds
    sat?: number;
    alt?: number;
    speed?: number;
}

interface MatchedPoint {
    lng: number;
    lat: number;
    maxspeed?: number;  // km/h from Mapbox
    typicalSpeed?: number; // km/h from Mapbox
    isEstimated?: boolean; // If true, point was not strictly matched but filled/estimated
    confidence?: number; // 0-1 from Mapbox
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────
// 1. Fetch Optimal Route (Mapbox Directions API)
// ────────────────────────────────────────────────────────────

async function fetchOptimalRoute(
    start: [number, number],
    end: [number, number],
    token: string,
    profile: string = 'mapbox/driving'
): Promise<GeoJSON.Feature<GeoJSON.LineString> | null> {
    const url =
        `https://api.mapbox.com/directions/v5/${profile}/` +
        `${start[0]},${start[1]};${end[0]},${end[1]}` +
        `?geometries=geojson&overview=full&access_token=${token}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const json = await res.json();
    if (!json.routes?.[0]) return null;

    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'LineString',
            coordinates: json.routes[0].geometry.coordinates,
        },
    };
}

// ────────────────────────────────────────────────────────────
// 1b. GPS Pre-cleaning (Validation)
// ────────────────────────────────────────────────────────────

function cleanTrack(raw: RawTrackPoint[]): RawTrackPoint[] {
    if (raw.length < 2) return raw;

    const cleaned: RawTrackPoint[] = [raw[0]];
    const MAX_SPEED_KMH = 150; // Hard cap
    const MAX_TELEPORT_SPEED_KMH = 150; // Between points

    for (let i = 1; i < raw.length; i++) {
        const prev = cleaned[cleaned.length - 1];
        const curr = raw[i];

        // 1. Sanity check reported speed (if available)
        if (curr.speed !== undefined && curr.speed > MAX_SPEED_KMH) {
            continue; // Skip noise
        }

        // 2. Check for teleportation (impossible distance / time)
        const distKm = turf.distance(
            turf.point([prev.lng, prev.lat]),
            turf.point([curr.lng, curr.lat]),
            { units: 'kilometers' }
        );
        const timeDiffHours = (curr.time - prev.time) / 3600;

        // Allow some jitter if points are very close (< 20m) or time diff is 0
        if (distKm > 0.02 && timeDiffHours > 0) {
            const calculatedSpeed = distKm / timeDiffHours;
            if (calculatedSpeed > MAX_TELEPORT_SPEED_KMH) {
                continue; // Skip teleport
            }
        }

        cleaned.push(curr);
    }
    return cleaned;
}

// ────────────────────────────────────────────────────────────
// 2. Map Matching (Mapbox Map Matching API)
// ────────────────────────────────────────────────────────────

async function mapMatchTrack(
    raw: RawTrackPoint[],
    token: string,
    profile: string = 'mapbox/driving'
): Promise<MatchedPoint[]> {
    const CHUNK_SIZE = 95; // Mapbox limit is 100
    const chunks: RawTrackPoint[][] = [];
    for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
        chunks.push(raw.slice(i, i + CHUNK_SIZE));
    }

    let matchedPoints: MatchedPoint[] = [];

    for (const chunk of chunks) {
        if (chunk.length < 2) continue;

        // Simplify coordinates for URL length, but keep enough precision
        const coordsStr = chunk.map(c => `${Number(c.lng.toFixed(6))},${Number(c.lat.toFixed(6))}`).join(';');

        // Use implicit timestamps for trace (optional, but helps matching logic)
        // const timesStr = chunk.map(c => c.time).join(';');

        try {
            // Requesting annotations: maxspeed, speed
            const url = `https://api.mapbox.com/matching/v5/${profile}/${coordsStr}` +
                `?geometries=geojson&overview=full` +
                `&annotations=maxspeed,speed` + // Key for adaptive tolerance
                `&tidy=true&access_token=${token}`;

            const res = await fetch(url);

            // Handle 429 or other errors gracefully by falling back to raw
            if (!res.ok) {
                // Push raw as fallback
                matchedPoints.push(...chunk.map(c => ({ lng: c.lng, lat: c.lat, isEstimated: true })));
                continue;
            }

            const data = await res.json();

            if (data.code === 'Ok' && data.matchings && data.matchings.length > 0) {

                // Iterate over ALL matchings (segments), not just the first one
                for (const matching of data.matchings) {
                    const geometry = matching.geometry.coordinates; // [lng, lat][]
                    const confidence = matching.confidence;

                    // Parse annotations (flattened from legs)
                    const allMaxSpeeds: number[] = [];
                    const allTypicalSpeeds: number[] = [];

                    if (matching.legs) {
                        for (const leg of matching.legs) {
                            if (leg.annotation?.maxspeed) allMaxSpeeds.push(...leg.annotation.maxspeed);
                            if (leg.annotation?.speed) allTypicalSpeeds.push(...leg.annotation.speed);
                        }
                    }

                    // Map geometry to metadata
                    geometry.forEach((coord: number[], idx: number) => {
                        const ms = allMaxSpeeds[Math.min(idx, allMaxSpeeds.length - 1)];
                        const ts = allTypicalSpeeds[Math.min(idx, allTypicalSpeeds.length - 1)];

                        matchedPoints.push({
                            lng: coord[0],
                            lat: coord[1],
                            maxspeed: (typeof ms === 'number' && ms > 0) ? ms : undefined,
                            typicalSpeed: (typeof ts === 'number' && ts > 0) ? ts : undefined,
                            isEstimated: false,
                            confidence, // Propagate confidence
                        });
                    });
                }
            } else {
                matchedPoints.push(...chunk.map(c => ({ lng: c.lng, lat: c.lat, isEstimated: true })));
            }
        } catch (err) {
            console.warn('Map matching error:', err);
            matchedPoints.push(...chunk.map(c => ({ lng: c.lng, lat: c.lat, isEstimated: true })));
        }

        await delay(150); // Rate limit
    }

    return matchedPoints;
}

// ────────────────────────────────────────────────────────────
// 3. Adaptive Tolerance Logic
// ────────────────────────────────────────────────────────────

function getAdaptiveTolerance(
    point: MatchedPoint,
    rawContext: RawTrackPoint | null, // The raw point closest to this matched point
    sectionSinuosity: number
): number {
    const C = SCORING_THRESHOLDS.ROUTE_DEVIATION.TOLERANCE;
    const M = SCORING_THRESHOLDS.ROUTE_DEVIATION.MULTIPLIERS;

    // 1. Base Tolerance from Road Class (Proxy: MaxSpeed)
    let tolerance = C.DEFAULT_METERS;

    // Prefer maxspeed (legal limit), fallback to typicalSpeed
    const refSpeed = point.maxspeed ?? point.typicalSpeed ?? (rawContext?.speed ?? 0);

    if (refSpeed >= 80) {
        tolerance = C.HIGHWAY_METERS; // 25m
    } else if (refSpeed >= 50) {
        tolerance = C.ARTERIAL_METERS; // 40m
    } else if (refSpeed > 0) {
        tolerance = C.CITY_METERS; // 60m
    } else {
        // If no data, assume city/complex env to be safe
        tolerance = C.CITY_METERS;
    }

    // 2. Adjust for Signal Quality
    if (rawContext && rawContext.sat !== undefined) {
        if (rawContext.sat < 4) {
            tolerance *= M.POOR_SIGNAL; // x1.5
        } else if (rawContext.sat >= 10 && refSpeed > 90) {
            // High speed + Good signal = Precision Expected
            tolerance *= M.HIGH_SPEED_GOOD_GPS; // x0.8
        }
    }

    // 3. Adjust for Terrain (Sinuosity)
    if (sectionSinuosity > 1.4) {
        tolerance *= M.DIFFICULT_TERRAIN; // x1.5
    }

    // Cap at reasonable max to prevent infinite drift allowed
    return Math.min(tolerance, 100) / 1000; // Return in Kilometers
}

// ────────────────────────────────────────────────────────────
// 4. Deviation Analysis (Turf.js)
// ────────────────────────────────────────────────────────────

function computeDeviations(
    matchedPoints: MatchedPoint[],
    rawTrack: RawTrackPoint[],
    optimalLine: GeoJSON.LineString,
    minSegmentKm: number,
    globalSinuosity: number
): GeoJSON.Feature<GeoJSON.LineString>[] {
    const deviationFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    let currentSegment: number[][] = [];
    let segmentStartTime: number | null = null;
    let segmentEndTime: number | null = null;

    // Helper to find raw context for signal data
    // optimization: linear scan since both are roughly time-ordered
    let rawIdx = 0;

    const TIME_THRESHOLD = SCORING_THRESHOLDS.ROUTE_DEVIATION.TIME_THRESHOLD_SECONDS || 120;

    for (let i = 0; i < matchedPoints.length; i++) {
        const pt = matchedPoints[i];

        // Sync raw pointer roughly by distance to avoid expensive search
        // (Simple heuristic: nearest neighbor in small window)
        let bestRaw = rawTrack[rawIdx];
        let minDist = Infinity;
        const searchWindow = 10;
        for (let j = Math.max(0, rawIdx); j < Math.min(rawTrack.length, rawIdx + searchWindow); j++) {
            const d = Math.abs(rawTrack[j].lng - pt.lng) + Math.abs(rawTrack[j].lat - pt.lat);
            if (d < minDist) {
                minDist = d;
                bestRaw = rawTrack[j];
                rawIdx = j; // Advance pointer to keep in sync
            }
        }

        // Calculate dynamic tolerance for THIS point
        const toleranceKm = getAdaptiveTolerance(pt, bestRaw, globalSinuosity);

        const pointGeo = turf.point([pt.lng, pt.lat]);
        const distanceToRoute = turf.pointToLineDistance(pointGeo, optimalLine, { units: 'kilometers' });

        if (distanceToRoute > toleranceKm) {
            // Start or Continue Segment
            if (currentSegment.length === 0) {
                segmentStartTime = pt.isEstimated ? bestRaw.time : Math.floor(Date.now() / 1000); // approximate
                // Try to look up time from raw?
                // Since we have bestRaw... use it
                segmentStartTime = bestRaw.time;
            }
            currentSegment.push([pt.lng, pt.lat]);
            segmentEndTime = bestRaw.time;
        } else {
            // End Segment
            if (currentSegment.length > 2 && segmentStartTime !== null && segmentEndTime !== null) {
                const durationSeconds = segmentEndTime - segmentStartTime;

                // FILTER: Only persist if deviation > Time Threshold
                if (durationSeconds > TIME_THRESHOLD) {
                    const line = turf.lineString(currentSegment);

                    // Secondary Check: Min Distance (to avoid super slow crawling drift)
                    if (turf.length(line, { units: 'kilometers' }) > minSegmentKm) {
                        deviationFeatures.push(line);
                    }
                }
            }
            currentSegment = [];
            segmentStartTime = null;
            segmentEndTime = null;
        }
    }

    // Final flush
    if (currentSegment.length > 2 && segmentStartTime !== null && segmentEndTime !== null) {
        const durationSeconds = segmentEndTime - segmentStartTime;
        if (durationSeconds > TIME_THRESHOLD) {
            const line = turf.lineString(currentSegment);
            if (turf.length(line, { units: 'kilometers' }) > minSegmentKm) {
                deviationFeatures.push(line);
            }
        }
    }

    return deviationFeatures;
}

// ────────────────────────────────────────────────────────────
// 5. Dwell Detection (unauthorized stops within deviations)
// ────────────────────────────────────────────────────────────

function detectUnauthorizedStops(
    deviationFeatures: GeoJSON.Feature<GeoJSON.LineString>[],
    rawTrack: RawTrackPoint[],
    stationaryMinutes: number,
    safeZones?: AnalysisParams['safeZones']
): StopEvent[] {
    const stops: StopEvent[] = [];

    // Pre-calculate line strings for perf
    // In strict mode, we only check stops that occurred geographically ON the deviation geometry

    for (const devFeat of deviationFeatures) {
        // Find raw points physically close to this deviation segment
        // Filter is expensive, optimize with bounding box check?
        const bbox = turf.bbox(devFeat); // [minX, minY, maxX, maxY]

        const candidates = rawTrack.filter(pt =>
            pt.lng >= bbox[0] && pt.lng <= bbox[2] &&
            pt.lat >= bbox[1] && pt.lat <= bbox[3]
        );

        if (candidates.length < 2) continue;

        const segmentPoints = candidates.filter(pt => {
            const point = turf.point([pt.lng, pt.lat]);
            // Relaxed buffer for stopped vehicle GPS drift (30m)
            return turf.pointToLineDistance(point, devFeat, { units: 'kilometers' }) < 0.03;
        });

        if (segmentPoints.length < 2) continue;

        let dwellStart: RawTrackPoint | null = null;

        const checkDwell = (p1: RawTrackPoint, p2: RawTrackPoint) => {
            const mins = (p2.time - p1.time) / 60;
            if (mins >= stationaryMinutes) {
                // Check if Authorized (Inside Safe Zone)
                let isAuthorized = false;
                let zoneId: number | undefined;
                let zoneLabel: string | undefined;

                if (safeZones && safeZones.length > 0) {
                    const pt = turf.point([p1.lng, p1.lat]);
                    for (const z of safeZones) {
                        try {
                            if (z.geometry.type === 'Polygon' || z.geometry.type === 'MultiPolygon') {
                                // @ts-ignore
                                if (turf.booleanPointInPolygon(pt, z.geometry)) {
                                    isAuthorized = true;
                                    zoneId = z.id;
                                    zoneLabel = z.label;
                                    break;
                                }
                            }
                            // P3.10: Handle circle geofences via distance check
                            else if (z.geometry.type === 'Point' && z.radius) {
                                const center = turf.point(z.geometry.coordinates);
                                const dist = turf.distance(pt, center, { units: 'meters' });
                                if (dist <= z.radius) {
                                    isAuthorized = true;
                                    zoneId = z.id;
                                    zoneLabel = z.label;
                                    break;
                                }
                            }
                        } catch (e) {
                            // ignore geometry error
                        }
                    }
                }

                stops.push({
                    lat: p1.lat,
                    lng: p1.lng,
                    duration_mins: Math.round(mins),
                    startTime: new Date(dwellStart!.time * 1000).toISOString(),
                    endTime: new Date(p2.time * 1000).toISOString(),
                    isAuthorized,
                    zoneId,
                    zoneLabel
                });
            }
        };

        for (let i = 0; i < segmentPoints.length - 1; i++) {
            const p1 = segmentPoints[i];
            const p2 = segmentPoints[i + 1];
            const dist = turf.distance(
                turf.point([p1.lng, p1.lat]),
                turf.point([p2.lng, p2.lat]),
                { units: 'kilometers' }
            );

            // Stationary logic: very small movement (< 30m) between points
            if (dist < 0.03) {
                if (!dwellStart) dwellStart = p1;
            } else {
                if (dwellStart) {
                    checkDwell(dwellStart, p1);
                    dwellStart = null;
                }
            }
        }

        // Trailing check
        if (dwellStart) {
            const last = segmentPoints[segmentPoints.length - 1];
            checkDwell(dwellStart, last);
        }
    }

    // Dedupe stops
    return stops.filter((s, i, self) =>
        i === self.findIndex(t => t.lat === s.lat && t.lng === s.lng)
    );
}

// ────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────

export async function analyzeRouteDeviation(params: AnalysisParams): Promise<RouteAnalysisResult> {
    const {
        startCoords,
        endCoords,
        trackPoints,
        mapboxToken,
        profile = 'mapbox/driving',
        enableMapMatching = true, // Default to true for Security Module
        safeZones
    } = params;

    const minSegmentKm = (SCORING_THRESHOLDS.ROUTE_DEVIATION?.MIN_DEVIATION_LENGTH_METERS || 100) / 1000;
    const stationaryMins = SCORING_THRESHOLDS.ROUTE_DEVIATION?.STATIONARY_THRESHOLD_MINUTES || 5;

    const empty: RouteAnalysisResult = {
        proposedKm: 0, actualKm: 0, deviationKm: 0,
        unauthorizedStops: 0, routeBreaches: 0,
        deviationSegments: null, stopEvents: [],
    };

    // 1. Fetch optimal route
    const optimalRoute = await fetchOptimalRoute(startCoords, endCoords, mapboxToken, profile);
    if (!optimalRoute) return empty;

    const proposedKm = turf.length(optimalRoute, { units: 'kilometers' });

    // 2. Prepare raw track with robustness
    let rawTrack: RawTrackPoint[] = trackPoints
        .filter(pt => pt.lat != null && pt.lng != null && !isNaN(pt.lat) && !isNaN(pt.lng))
        .map(pt => ({
            lng: pt.lng,
            lat: pt.lat,
            time: typeof pt.time === 'string' ? Math.floor(new Date(pt.time).getTime() / 1000) : Number(pt.time),
            sat: pt.sat,
            alt: pt.alt,
            speed: pt.speed
        }))
        .sort((a, b) => a.time - b.time); // Ensure chrono order

    // Apply GPS Pre-cleaning
    rawTrack = cleanTrack(rawTrack);

    if (rawTrack.length < 2) return empty;

    // 3. Map Matching / Path Enhancement
    let matchedPoints: MatchedPoint[];
    let avgConfidence = 0;

    if (enableMapMatching) {
        matchedPoints = await mapMatchTrack(rawTrack, mapboxToken, profile);
        // Fallback if matching failed completely (empty array) but raw exists
        if (matchedPoints.length === 0) {
            matchedPoints = rawTrack.map(r => ({ lng: r.lng, lat: r.lat, isEstimated: true }));
        } else {
            // Compute Average Confidence
            const validConfidences = matchedPoints.filter(p => p.confidence !== undefined).map(p => p.confidence as number);
            if (validConfidences.length > 0) {
                avgConfidence = validConfidences.reduce((a, b) => a + b, 0) / validConfidences.length;
            }
        }
    } else {
        matchedPoints = rawTrack.map(r => ({ lng: r.lng, lat: r.lat, isEstimated: true }));
    }

    if (matchedPoints.length < 2) return empty;

    // 4. Calculate Actual Stats
    const actualLine = turf.lineString(matchedPoints.map(p => [p.lng, p.lat]));
    const actualKm = turf.length(actualLine, { units: 'kilometers' });

    // --- NEW: Match Quality Metrics ---
    // Fraction Matched: approximate by comparing time window covered or points count? 
    // Since map box can return multiple points for one raw point, or drop raw points, 
    // let's use a simpler proxy: distance ratio.

    // Distance Ratio: Map Matched Distance / Raw GPS Distance
    let rawDistKm = 0;
    for (let i = 0; i < rawTrack.length - 1; i++) {
        const d = turf.distance([rawTrack[i].lng, rawTrack[i].lat], [rawTrack[i + 1].lng, rawTrack[i + 1].lat], { units: 'kilometers' });
        rawDistKm += d;
    }

    const distanceRatio = rawDistKm > 0 ? (actualKm / rawDistKm) : 1;

    // FractionMatched: (Matched Points that are NOT estimated) / Total Matched Points
    // This isn't perfect but tells us how much we fell back to raw
    const matchedCount = matchedPoints.filter(p => !p.isEstimated).length;
    const fractionMatched = matchedPoints.length > 0 ? (matchedCount / matchedPoints.length) : 0;

    const isGoodMatch = (avgConfidence > 0.8 && fractionMatched > 0.9 && distanceRatio > 0.8 && distanceRatio < 1.2);

    // 5. Compute Sinuosity (Terrain Proxy)
    // Sinuosity = Actual Length / Crow Flight Length
    const crowDist = turf.distance(
        turf.point(startCoords),
        turf.point(endCoords),
        { units: 'kilometers' }
    );
    // Use proposed route sinuosity as baseline for "Expected Terrain"
    const routeSinuosity = (crowDist > 0.1) ? (proposedKm / crowDist) : 1;

    // --- NEW: Determine Terrain Type ---
    let terrainType: 'FLAT' | 'WINDING' | 'HILLY' = 'FLAT';
    if (routeSinuosity > 1.4) terrainType = 'WINDING';

    // --- NEW: Build Speed Limit Segments & Points ---
    const speedSegments: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const speedPoints: GeoJSON.Feature<GeoJSON.Point>[] = []; // For Sign Icons

    let currentSpeedSegment: number[][] = [];

    // Helper to get broader speed for segmentation (prevent noisy segments if typicalSpeed varies slightly)
    const getSegSpeed = (p: MatchedPoint) => {
        if (p.maxspeed && p.maxspeed > 0) return p.maxspeed;
        if (p.typicalSpeed && p.typicalSpeed > 0) return Math.round(p.typicalSpeed / 5) * 5;
        return 0;
    };

    let currentSegSpeed = getSegSpeed(matchedPoints[0]);
    let currentMaxSpeed = matchedPoints[0].maxspeed || 0;
    let currentTypical = matchedPoints[0].typicalSpeed || 0;

    const flushSegment = () => {
        if (currentSpeedSegment.length < 2) return;

        // 1. Line Segment
        const lineGeom: GeoJSON.LineString = { type: 'LineString', coordinates: currentSpeedSegment };
        speedSegments.push({
            type: 'Feature',
            properties: {
                maxspeed: currentMaxSpeed,
                typicalSpeed: currentTypical,
                displaySpeed: currentSegSpeed
            },
            geometry: lineGeom
        });

        // 2. Point Marker (Midpoint for Sign)
        // Find rough middle coordinate
        const midIdx = Math.floor(currentSpeedSegment.length / 2);
        const midCoord = currentSpeedSegment[midIdx];

        speedPoints.push({
            type: 'Feature',
            properties: {
                maxspeed: currentMaxSpeed,
                displaySpeed: currentSegSpeed,
                isTypical: currentMaxSpeed === 0 // Flag to style differently
            },
            geometry: { type: 'Point', coordinates: midCoord }
        });
    };

    for (const pt of matchedPoints) {
        const ptSegSpeed = getSegSpeed(pt);

        // If effective speed tier changes
        if (ptSegSpeed !== currentSegSpeed && currentSpeedSegment.length > 0) {
            currentSpeedSegment.push([pt.lng, pt.lat]); // Close gap
            flushSegment(); // Push Line & Point

            // Reset
            currentSpeedSegment = [[pt.lng, pt.lat]];
            currentSegSpeed = ptSegSpeed;
            currentMaxSpeed = pt.maxspeed || 0;
            currentTypical = pt.typicalSpeed || 0;
        } else {
            currentSpeedSegment.push([pt.lng, pt.lat]);
        }
    }
    // Final flush
    flushSegment();

    // 6. Deviation Analysis (Adaptive)
    const deviationFeatures = computeDeviations(
        matchedPoints,
        rawTrack,
        optimalRoute.geometry,
        minSegmentKm,
        routeSinuosity
    );

    let deviationKm = 0;
    for (const f of deviationFeatures) {
        deviationKm += turf.length(f, { units: 'kilometers' });
    }

    // 7. Detect Stops on Deviations
    const stopEvents = detectUnauthorizedStops(
        deviationFeatures,
        rawTrack,
        stationaryMins,
        safeZones
    );
    if (stopEvents.length > 0) {
        console.log(`[Analyze] Found ${stopEvents.length} stops!`);
    }

    // 8. RISK SCORING ENGINE (Blueprint Implementation)
    let riskScore = 0;
    const riskReasons: string[] = [];
    const R = SCORING_THRESHOLDS.RISK_SCORING.WEIGHTS;

    // A. Unauthorized Stops
    // Filter out Authorized stops from penalty calculation
    const unauthorizedCount = stopEvents.filter(s => !s.isAuthorized).length;

    if (unauthorizedCount > 0) {
        const stopPenalty = Math.min(unauthorizedCount * R.UNAUTHORIZED_STOP, 60); // Cap stack
        riskScore += stopPenalty;
        riskReasons.push(`UNAUTHORIZED_STOP_X${unauthorizedCount} `);
    }

    // B. Sustained Deviation
    // If we have deviations that passed the Time/Dist filters
    if (deviationFeatures.length > 0) {
        riskScore += R.SUSTAINED_DEVIATION;
        riskReasons.push('SUSTAINED_DEVIATION');
    }

    // NEW: REMOTE HIGHWAY STOP (Specialized Cartel Logic)
    // We check if any of our unauthorized stops occurred in a high-speed corridor
    if (stopEvents.some(s => !s.isAuthorized)) {
        // This is tricky because we need the avgSpeed for each stop's location.
        // For now, let's look at the average speed of the actual trip as a proxy, 
        // OR we'll expect the caller to have enriched the stops if possible.
        // Actually, the best place is evaluate_stop_risk which is called in batch-security-analysis.
    }

    // C. Night Driving (Check if any point is in 22:00-05:00 window)
    // P1.4: Use getUTCHours() for consistent timezone handling
    const nightPoints = rawTrack.filter(p => {
        const h = new Date(p.time * 1000).getUTCHours();
        return h >= 22 || h < 5;
    }).length;

    if (nightPoints / rawTrack.length > 0.1) {
        riskScore += R.NIGHT_DRIVING;
        riskReasons.push('NIGHT_DRIVING');
    }

    // D. Known Hotspot Stop (P2.8 — injected by batch pipeline)
    if (params.hotspotStopScore && params.hotspotStopScore > 0) {
        riskScore += Math.min(params.hotspotStopScore, R.KNOWN_HOTSPOT_STOP);
        riskReasons.push('KNOWN_HOTSPOT_STOP');
    }

    // E. Repeat Offender (P2.8 — injected by batch pipeline)
    if (params.repeatOffenderCount && params.repeatOffenderCount > 2) {
        riskScore += R.REPEAT_OFFENDER;
        riskReasons.push(`REPEAT_OFFENDER_(${params.repeatOffenderCount}_PRIOR)`);
    }

    // Cap score at 100
    riskScore = Math.min(riskScore, 100);

    return {
        proposedKm,
        actualKm,
        deviationKm,
        // Enriched Data
        sinuosity: parseFloat(routeSinuosity.toFixed(2)),
        terrainType,
        speedLimitSegments: { type: 'FeatureCollection', features: speedSegments },
        speedLimitPoints: { type: 'FeatureCollection', features: speedPoints }, // NEW

        // Scoring
        riskScore,
        riskReasons,

        unauthorizedStops: stopEvents.filter(s => !s.isAuthorized).length,
        routeBreaches: deviationFeatures.length,
        deviationSegments: deviationFeatures.length > 0
            ? { type: 'FeatureCollection', features: deviationFeatures }
            : null,
        stopEvents,

        // Quality Metrics
        matchConfidence: parseFloat(avgConfidence.toFixed(2)),
        fractionMatched: parseFloat(fractionMatched.toFixed(2)),
        distanceRatio: parseFloat(distanceRatio.toFixed(2)),
        isGoodMatch
    };
}
