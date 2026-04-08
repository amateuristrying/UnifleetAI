/**
 * Route Learning & Corridor Intelligence Service
 *
 * Learns "safe" fleet corridors from historical trip data using H3 hexagonal
 * grids and checks new points against learned corridors + known risk zones.
 *
 * Improvements:
 *   P1.1  Exponential decay — old corridors lose trust over time
 *   P1.2  Maturity threshold — min visits before a cell is trusted
 *   P1.3  1-ring neighbor tolerance — compensates for GPS drift
 *   P1.4  UTC-standardized night detection
 *   P2.5  Per-vehicle corridor scoping
 *   P2.6  Temporal corridor profiles (day-of-week, hour-bucket)
 *   P3.9  Corridor directionality (bearing bucket)
 */

import { getSupabaseAdmin } from '@/lib/supabase-server';
import { latLngToCell, gridDisk } from 'h3-js';
import { SCORING_THRESHOLDS } from '@/lib/telematics-config';

const CORRIDOR = SCORING_THRESHOLDS.CORRIDOR;
const CORRIDOR_RES = CORRIDOR.H3_RESOLUTION; // 9 ≈ 174 m edge

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface RiskCheckResult {
    h3Index: string;
    isInCorridor: boolean;
    corridorVisits: number;
    effectiveVisits: number;    // P1.1: decay-adjusted visit count
    avgSpeedKmh: number;        // NEW: highway data
    riskZoneScore: number;
    riskZoneType: string | null;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** P2.6: Convert hour (0-23) to bucket (0-5) using configurable window size */
function hourToBucket(hour: number): number {
    return Math.floor(hour / CORRIDOR.HOUR_BUCKET_SIZE);
}

/** P3.9: Convert bearing degrees (0-360) to bucket (0-7 for N/NE/E/SE/S/SW/W/NW) */
function bearingToBucket(bearingDeg: number): number {
    return Math.floor(((bearingDeg + 22.5) % 360) / 45);
}

/** P3.9: Compute geodesic bearing from point A to point B (degrees 0-360) */
function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = Math.PI / 180;
    const dLng = (lng2 - lng1) * toRad;
    const lat1r = lat1 * toRad;
    const lat2r = lat2 * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2r);
    const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────

export class RouteLearningService {

    /**
     * Converts a track (array of points) into a set of H3 indices
     * and persists them to `fleet_corridors`.
     *
     * Supports per-vehicle scoping (P2.5), temporal profiles (P2.6),
     * directionality (P3.9), and UTC-based night detection (P1.4).
     */
    static async learnCorridorsFromTrack(
        trackPoints: { lat: number; lng: number; time: number; speed?: number }[],
        trackerId?: number   // P2.5: optional tracker ID for per-vehicle corridors
    ): Promise<number> {
        if (trackPoints.length < 2) return 0;

        // 1. Convert points to H3, collect bearings AND speeds per cell
        const indices = new Set<string>();
        const h3Bearings = new Map<string, number[]>();
        const h3Speeds = new Map<string, number[]>();
        let nightCount = 0;

        for (let i = 0; i < trackPoints.length; i++) {
            const pt = trackPoints[i];
            try {
                const h3 = latLngToCell(pt.lat, pt.lng, CORRIDOR_RES);
                indices.add(h3);

                // P1.4: Night check using UTC (22:00-05:00)
                const hour = new Date(pt.time * 1000).getUTCHours();
                if (hour >= 22 || hour < 5) nightCount++;

                // P3.9: Compute bearing to next point and associate with this cell
                // ONLY if the distance is significant (> 10m) to avoid "0" bearing noise from stationary points.
                // Collect speed if available
                if (pt.speed !== undefined && pt.speed >= 0) {
                    if (!h3Speeds.has(h3)) h3Speeds.set(h3, []);
                    h3Speeds.get(h3)!.push(pt.speed);
                }

                if (i < trackPoints.length - 1) {
                    const next = trackPoints[i + 1];

                    // Simple distance check (Haversine approx or just Euclidean for filtering)
                    // We need to ignore tiny movements (< 10 meters) which cause bearing 0 or erratic noise.
                    const R = 6371e3; // metres
                    const φ1 = pt.lat * Math.PI / 180;
                    const φ2 = next.lat * Math.PI / 180;
                    const Δφ = (next.lat - pt.lat) * Math.PI / 180;
                    const Δλ = (next.lng - pt.lng) * Math.PI / 180;

                    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                        Math.cos(φ1) * Math.cos(φ2) *
                        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const dist = R * c;

                    if (dist > 10) {
                        const bearing = computeBearing(pt.lat, pt.lng, next.lat, next.lng);
                        if (!h3Bearings.has(h3)) h3Bearings.set(h3, []);
                        h3Bearings.get(h3)!.push(bearing);
                    }
                }
            } catch {
                // ignore invalid points (e.g. out-of-range lat/lng)
            }
        }

        if (indices.size === 0) return 0;

        const isNight = (nightCount / trackPoints.length) > 0.5;

        // P2.6: Temporal profile from the track midpoint
        const midTimestamp = new Date(trackPoints[Math.floor(trackPoints.length / 2)].time * 1000);
        const dayOfWeek = midTimestamp.getUTCDay() as number;      // 0=Sun..6=Sat
        const hourBucket = hourToBucket(midTimestamp.getUTCHours());

        // P3.9: Compute median bearing bucket per H3 cell
        const h3Array = Array.from(indices);
        const bearingBuckets: number[] = h3Array.map(h3 => {
            const bearings = h3Bearings.get(h3);
            if (!bearings || bearings.length === 0) return 0;
            // Use median bearing
            const sorted = [...bearings].sort((a, b) => a - b);
            const medianBearing = sorted[Math.floor(sorted.length / 2)];
            return bearingToBucket(medianBearing);
        });

        // Calculate average speed per bucket (rounded to int)
        const avgSpeeds: number[] = h3Array.map(h3 => {
            const speeds = h3Speeds.get(h3);
            if (!speeds || speeds.length === 0) return 0; // Or null? RPC treats 0 as 0 km/h which is fine or maybe null is better.
            // Let's use 0 if no speed, but wait, usually speed is > 0
            const sum = speeds.reduce((a, b) => a + b, 0);
            return Math.round(sum / speeds.length);
        });

        // 2. Persist via RPC
        const supabase = getSupabaseAdmin();
        const { error } = await supabase.rpc('upsert_fleet_corridors', {
            p_h3_indices: h3Array,
            p_is_night: isNight,
            p_tracker_id: trackerId ?? null,           // P2.5
            p_day_of_week: dayOfWeek,                  // P2.6
            p_hour_bucket: hourBucket,                 // P2.6
            p_bearing_buckets: bearingBuckets,         // P3.9
            p_avg_speeds: avgSpeeds                    // Speed & Congestion
        });

        if (error) {
            console.error('Failed to learn corridors:', error);
            throw error;
        }

        return indices.size;
    }

    /**
     * Checks a set of points against learned corridors and risk zones.
     *
     * Supports decay (P1.1), maturity threshold (P1.2), 1-ring neighbor
     * tolerance (P1.3), and per-vehicle filtering (P2.5).
     */
    static async checkRiskForPoints(
        points: { lat: number; lng: number }[],
        trackerId?: number   // P2.5: optional vehicle filter
    ): Promise<RiskCheckResult[]> {
        if (points.length === 0) return [];

        // 1. Unique H3 indices for the queried points
        const uniqueH3 = new Set<string>();

        for (const p of points) {
            const h3 = latLngToCell(p.lat, p.lng, CORRIDOR_RES);
            uniqueH3.add(h3);
        }

        const h3Array = Array.from(uniqueH3);

        // P1.3: Compute 1-ring neighbors for GPS-drift tolerance
        const neighborSet = new Set<string>();
        for (const h3 of h3Array) {
            const ring = gridDisk(h3, CORRIDOR.NEIGHBOR_TOLERANCE_RING);
            for (const n of ring) {
                if (!uniqueH3.has(n)) neighborSet.add(n);
            }
        }

        // 2. Query DB with enhanced RPC
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.rpc('check_security_risks', {
            p_h3_indices: h3Array,
            p_neighbor_indices: Array.from(neighborSet),       // P1.3
            p_maturity_threshold: CORRIDOR.MATURITY_THRESHOLD, // P1.2
            p_decay_lambda: CORRIDOR.DECAY_LAMBDA,             // P1.1
            p_tracker_id: trackerId ?? null,                   // P2.5
        });

        if (error || !data) {
            console.error('Risk check failed:', error);
            return []; // Fail open (don't block analysis)
        }

        // 3. Map back results
        return data.map((row: any) => ({
            h3Index: row.h3_index,
            isInCorridor: row.is_in_corridor,
            corridorVisits: row.corridor_visits,
            effectiveVisits: row.effective_visits ?? 0,  // P1.1
            avgSpeedKmh: row.avg_speed_kmh ?? 0,         // NEW: highway data
            riskZoneScore: row.risk_zone_score,
            riskZoneType: row.risk_zone_type,
        }));
    }

    /**
     * Identifies immediate risk for a specific stop location.
     * Returns a score (0-100) and explainable reason codes.
     */
    static async evaluateStopRisk(lat: number, lng: number, trackerId?: number): Promise<{
        score: number;
        reasons: string[];
    }> {
        const h3 = latLngToCell(lat, lng, CORRIDOR_RES);
        const results = await this.checkRiskForPoints([{ lat, lng }], trackerId);
        const match = results.find(r => r.h3Index === h3);

        if (!match) return { score: 0, reasons: [] };

        const reasons: string[] = [];
        let score = 0;

        // 1. Risk zone hit takes priority
        if (match.riskZoneScore > 0) {
            reasons.push(`RISK_ZONE_HIT (${match.riskZoneType})`);
            return { score: match.riskZoneScore, reasons };
        }

        // 2. REMOTE HIGHWAY STOP (Specialized Cartel Logic)
        const T = SCORING_THRESHOLDS.RISK_SCORING.THRESHOLDS;
        const W = SCORING_THRESHOLDS.RISK_SCORING.WEIGHTS;

        if (!match.isInCorridor && match.avgSpeedKmh >= T.REMOTE_HIGHWAY_SPEED_THRESHOLD) {
            reasons.push('REMOTE_HIGHWAY_STOP');
            score = W.REMOTE_HIGHWAY_STOP;
        }
        // 3. Generic Off-corridor: mild warning for unknown stop location
        else if (!match.isInCorridor) {
            reasons.push('UNKNOWN_LOCATION_STOP');
            score = 10;
        }

        return { score, reasons };
    }
}
