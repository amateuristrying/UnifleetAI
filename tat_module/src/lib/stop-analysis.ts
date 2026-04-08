/**
 * Stop-Level Security Analysis Engine
 *
 * Analyses BETWEEN-TRIP stops from the dedicated `stops` table — not
 * in-trip GPS noise. Trips represent movement; the gaps between trips
 * (stops / parks) are where theft, towing, fuel siphoning, and
 * unauthorized activity actually happen.
 *
 * Signals detected:
 *   NIGHT_STOP_OUTSIDE_SAFE_ZONE   — parked 22:00-05:00 outside known zones
 *   STOP_IN_RISK_ZONE              — parked inside a high-risk H3 hex
 *   ABNORMAL_LONG_STOP             — duration > threshold or > N× vehicle median
 *   IGNITION_ANOMALY               — engine running >30 % of a long stop
 *   POSITION_MISMATCH_TOW_RISK     — vehicle moved during stop (next trip starts far away)
 *   REPEAT_SUSPICIOUS_LOCATION     — recurring non-safe location (3+ visits)
 *   UNUSUAL_LOCATION_NIGHT         — first-time location at night
 *   SHORT_PRECEDING_TRIP           — very short trip before this stop (side trip)
 */

import * as turf from '@turf/turf';
import { latLngToCell } from 'h3-js';
import { SCORING_THRESHOLDS } from './telematics-config';
import type {
    StopRecord,
    StopRiskResult,
    VehicleStopProfile,
    AdjacentTrips,
    SeverityLevel,
} from '../types/security';

// ────────────────────────────────────────────────────────────
// Safe-zone shape used by the scoring engine (pre-converted)
// ────────────────────────────────────────────────────────────
export interface SafeZoneGeo {
    id: number;
    name: string;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

// ────────────────────────────────────────────────────────────
// Minimal risk-zone hex lookup (loaded from DB before scoring)
// ────────────────────────────────────────────────────────────
export interface RiskHexLookup {
    h3Index: string;
    riskScore: number;
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

export function analyzeStop(params: {
    stop: StopRecord;
    safeZones: SafeZoneGeo[];
    riskHexes: RiskHexLookup[];
    vehicleProfile: VehicleStopProfile;
    adjacentTrips?: AdjacentTrips;
    corridorAvgSpeed?: number; // NEW: context from corridors
}): StopRiskResult | null {
    const { stop, safeZones, riskHexes, vehicleProfile, adjacentTrips, corridorAvgSpeed } = params;
    const W = SCORING_THRESHOLDS.STOP_RISK.WEIGHTS;
    const T = SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS;
    const H3_RES = SCORING_THRESHOLDS.STOP_RISK.H3.RESOLUTION;

    // ── Guard: skip stops without coordinates or below minimum duration ──
    if (stop.lat == null || stop.lng == null) return null;

    const durationSec = stop.duration_seconds ??
        (stop.end_time
            ? (new Date(stop.end_time).getTime() - new Date(stop.start_time).getTime()) / 1000
            : 0);
    const durationHours = durationSec / 3600;
    const durationMins = durationSec / 60;
    const minThreshold = corridorAvgSpeed !== undefined ? T.REMOTE_STOP_MIN_DURATION_MINUTES : T.MIN_STOP_DURATION_MINUTES;

    if (durationMins < minThreshold) return null;

    // ── Prepare spatial primitives ──
    const stopPoint = turf.point([stop.lng, stop.lat]);
    const h3Index = latLngToCell(stop.lat, stop.lng, H3_RES);

    let riskScore = 0;
    const riskReasons: string[] = [];

    // ────────────────────────────────────────────────────────
    // Signal 1: Night stop
    // ────────────────────────────────────────────────────────
    const startHour = new Date(stop.start_time).getUTCHours();
    const isNightStop = startHour >= 22 || startHour < 5;

    // ────────────────────────────────────────────────────────
    // Signal 2: Safe zone check
    // ────────────────────────────────────────────────────────
    let isInSafeZone = false;
    let safeZoneName: string | null = null;

    for (const zone of safeZones) {
        try {
            if (turf.booleanPointInPolygon(stopPoint, zone.geometry)) {
                isInSafeZone = true;
                safeZoneName = zone.name;
                break;
            }
        } catch {
            // Geometry error — skip zone
        }
    }

    // ────────────────────────────────────────────────────────
    // Signal 3: Risk zone check (H3 hex match)
    // ────────────────────────────────────────────────────────
    let isInRiskZone = false;
    let riskZoneH3: string | null = null;

    for (const hex of riskHexes) {
        if (hex.h3Index === h3Index) {
            isInRiskZone = true;
            riskZoneH3 = hex.h3Index;
            break;
        }
    }

    // ────────────────────────────────────────────────────────
    // Signal 4: Duration analysis
    // ────────────────────────────────────────────────────────
    const isLongDuration =
        durationHours > T.LONG_DURATION_HOURS ||
        (vehicleProfile.medianDurationSeconds > 0 &&
            durationSec > vehicleProfile.medianDurationSeconds * T.ABNORMAL_DURATION_MULTIPLIER);

    // ────────────────────────────────────────────────────────
    // Signal 5: Ignition anomaly
    // Engine running for a large fraction of an extended stop
    // indicates unauthorized vehicle use or fuel siphoning idle
    // ────────────────────────────────────────────────────────
    const ignitionOnPct = stop.ignition_on_percent ?? 0;
    const isIgnitionAnomaly =
        durationHours >= 0.5 && ignitionOnPct > T.IGNITION_ANOMALY_PERCENT;

    // ────────────────────────────────────────────────────────
    // Signal 6: Position mismatch (tow detection)
    // The stop is at (lat, lng). If the NEXT trip starts from
    // a significantly different location the vehicle was moved
    // during the stop without generating a trip record.
    // ────────────────────────────────────────────────────────
    let isPositionMismatch = false;
    let positionMismatchKm: number | null = null;

    if (adjacentTrips?.nextTrip && adjacentTrips?.prevTrip) {
        // PREFERRED: Distance between Last Trip End and Next Trip Start
        const prevEnd = turf.point([
            adjacentTrips.prevTrip.end_lng,
            adjacentTrips.prevTrip.end_lat,
        ]);
        const nextStart = turf.point([
            adjacentTrips.nextTrip.start_lng,
            adjacentTrips.nextTrip.start_lat,
        ]);
        const dist = turf.distance(prevEnd, nextStart, { units: 'kilometers' });

        if (dist > T.POSITION_MISMATCH_KM) {
            isPositionMismatch = true;
            positionMismatchKm = parseFloat(dist.toFixed(2));
        }
    } else if (adjacentTrips?.nextTrip) {
        // FALLBACK: Stop Location vs Next Trip Start (if prev trip missing)
        const nextStart = turf.point([
            adjacentTrips.nextTrip.start_lng,
            adjacentTrips.nextTrip.start_lat,
        ]);
        const dist = turf.distance(stopPoint, nextStart, { units: 'kilometers' });
        
        // Use a slightly stricter threshold for fallback to avoid false positives?
        // Keeping same threshold for now but ideally we trust trip-to-trip more.
        if (dist > T.POSITION_MISMATCH_KM) {
            isPositionMismatch = true;
            positionMismatchKm = parseFloat(dist.toFixed(2));
        }
    }

    // ────────────────────────────────────────────────────────
    // Signal 7: Repeat suspicious location
    // ────────────────────────────────────────────────────────
    let isRepeatLocation = false;
    let repeatCount = 0;

    if (!isInSafeZone && vehicleProfile.frequentLocations.length > 0) {
        for (const loc of vehicleProfile.frequentLocations) {
            const dist = turf.distance(stopPoint, turf.point([loc.lng, loc.lat]), { units: 'kilometers' });
            if (dist < 0.5) { // within 500 m
                repeatCount = loc.count;
                if (loc.count >= T.REPEAT_LOCATION_MIN_COUNT) {
                    isRepeatLocation = true;
                }
                break;
            }
        }
    }

    // ────────────────────────────────────────────────────────
    // Signal 8: Unusual location
    // ────────────────────────────────────────────────────────
    let isUnusualLocation = false;
    let nearestHistoricalKm: number | null = null;

    if (vehicleProfile.frequentLocations.length > 0) {
        let minDist = Infinity;
        for (const loc of vehicleProfile.frequentLocations) {
            const d = turf.distance(stopPoint, turf.point([loc.lng, loc.lat]), { units: 'kilometers' });
            if (d < minDist) minDist = d;
        }
        nearestHistoricalKm = parseFloat(minDist.toFixed(2));
        isUnusualLocation = minDist > T.UNUSUAL_LOCATION_KM;
    }

    // ────────────────────────────────────────────────────────
    // Signal 9: Short preceding trip
    // ────────────────────────────────────────────────────────
    let isShortPrecedingTrip = false;

    if (adjacentTrips?.prevTrip) {
        const prev = adjacentTrips.prevTrip;
        isShortPrecedingTrip =
            prev.distance_km < T.SHORT_TRIP_KM &&
            prev.duration_hours * 60 < T.SHORT_TRIP_MINUTES;
    }

    // ────────────────────────────────────────────────────────
    // Signal 10: Remote highway stop
    // ────────────────────────────────────────────────────────
    const corridorSpeed = params.corridorAvgSpeed ?? 0;
    const isRemoteHighway = !isInSafeZone && corridorSpeed >= T.REMOTE_HIGHWAY_SPEED_THRESHOLD;
    const isRemoteHighwayAnomaly =
        isRemoteHighway &&
        durationHours * 60 >= T.REMOTE_STOP_MIN_DURATION_MINUTES &&
        durationHours * 60 <= T.REMOTE_STOP_MAX_DURATION_MINUTES;

    // ════════════════════════════════════════════════════════
    // SCORING — additive, capped at 100
    // ════════════════════════════════════════════════════════

    if (isNightStop && !isInSafeZone) {
        riskScore += W.NIGHT_OUTSIDE_SAFE;
        riskReasons.push('NIGHT_STOP_OUTSIDE_SAFE_ZONE');
    }

    if (isInRiskZone && !isInSafeZone) {
        riskScore += W.IN_RISK_ZONE;
        riskReasons.push('STOP_IN_RISK_ZONE');
    }

    if (isLongDuration && !isInSafeZone) {
        riskScore += W.LONG_DURATION;
        riskReasons.push('ABNORMAL_LONG_STOP');
    }

    if (isIgnitionAnomaly) {
        riskScore += W.IGNITION_ANOMALY;
        riskReasons.push('IGNITION_ANOMALY');
    }

    if (isPositionMismatch) {
        riskScore += W.POSITION_MISMATCH;
        riskReasons.push('POSITION_MISMATCH_TOW_RISK');
    }

    if (isRepeatLocation && !isInSafeZone) {
        riskScore += W.REPEAT_SUSPICIOUS;
        riskReasons.push(`REPEAT_SUSPICIOUS_LOCATION_X${repeatCount}`);
    }

    if (isUnusualLocation && isNightStop && !isInSafeZone) {
        riskScore += W.UNUSUAL_LOCATION_NIGHT;
        riskReasons.push('UNUSUAL_LOCATION_NIGHT');
    }

    if (isShortPrecedingTrip && !isInSafeZone) {
        riskScore += W.SHORT_PRECEDING_TRIP;
        riskReasons.push('SHORT_PRECEDING_TRIP');
    }

    if (isRemoteHighwayAnomaly) {
        riskScore += W.REMOTE_HIGHWAY_STOP;
        riskReasons.push('REMOTE_HIGHWAY_STOP');
    }

    riskScore = Math.min(riskScore, 100);

    const severityLevel: SeverityLevel =
        riskScore >= SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS.CRITICAL ? 'CRITICAL' :
            riskScore >= SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS.WARNING ? 'WARNING' :
                'MINOR';

    return {
        stopId: stop.id,
        trackerId: stop.tracker_id,
        trackerName: stop.tracker_name,
        riskScore,
        severityLevel,
        riskReasons,

        stopLat: stop.lat,
        stopLng: stop.lng,
        stopStart: stop.start_time,
        stopEnd: stop.end_time,
        stopDurationHours: parseFloat(durationHours.toFixed(2)),
        h3Index,

        isNightStop,
        isInRiskZone,
        riskZoneH3,
        isInSafeZone,
        safeZoneName,
        isIgnitionAnomaly,
        ignitionOnPercent: ignitionOnPct,
        isLongDuration,
        isPositionMismatch,
        positionMismatchKm,
        isRepeatLocation,
        repeatCount,
        isUnusualLocation,
        nearestHistoricalKm,
        isShortPrecedingTrip,
        isRemoteHighway,
        corridorAvgSpeed: corridorSpeed,
        prevTripId: adjacentTrips?.prevTrip?.trip_id,
        nextTripId: adjacentTrips?.nextTrip?.trip_id
    };
}
