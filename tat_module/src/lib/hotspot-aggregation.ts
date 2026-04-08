/**
 * H3 Hexagonal Hotspot Aggregation + DBSCAN Clustering
 *
 * Takes scored stop results and produces two outputs:
 *   1. Risk-scored H3 hex grid (resolution 7, ~5 km² cells)
 *   2. DBSCAN-clustered risk zone polygons (actionable regions)
 *
 * Industry standard: Uber-style H3 indexing + Turf DBSCAN.
 */

import * as turf from '@turf/turf';
import { cellToBoundary, cellToLatLng, gridDisk } from 'h3-js';
import { SCORING_THRESHOLDS } from './telematics-config';
import type {
    StopRiskResult,
    RiskZoneHex,
    RiskZoneCluster,
} from '../types/security';

// ────────────────────────────────────────────────────────────
// 1. Aggregate scored stops into H3 hex grid
// ────────────────────────────────────────────────────────────

export function aggregateStopsToHexGrid(
    scoredStops: StopRiskResult[],
    resolution?: number,
): RiskZoneHex[] {
    const H3 = SCORING_THRESHOLDS.STOP_RISK.H3;
    const res = resolution ?? H3.RESOLUTION;
    const minIncidents = H3.MIN_INCIDENTS_FOR_HOTSPOT;

    // Bucket stops by their H3 hex (skip safe-zone stops and score-0)
    const hexMap = new Map<string, {
        stops: StopRiskResult[];
        totalScore: number;
        criticalCount: number;
        warningCount: number;
        nightCount: number;
        dayCount: number;
        reasons: Record<string, number>;
    }>();

    for (const stop of scoredStops) {
        // Only aggregate stops with meaningful risk
        if (stop.riskScore < 20 || stop.isInSafeZone) continue;

        const h3 = stop.h3Index;
        if (!hexMap.has(h3)) {
            hexMap.set(h3, {
                stops: [],
                totalScore: 0,
                criticalCount: 0,
                warningCount: 0,
                nightCount: 0,
                dayCount: 0,
                reasons: {},
            });
        }

        const hex = hexMap.get(h3)!;
        hex.stops.push(stop);
        hex.totalScore += stop.riskScore;
        if (stop.severityLevel === 'CRITICAL') hex.criticalCount++;
        if (stop.severityLevel === 'WARNING') hex.warningCount++;
        if (stop.isNightStop) hex.nightCount++;
        else hex.dayCount++;

        for (const reason of stop.riskReasons) {
            const base = reason.replace(/_X\d+$/, ''); // REPEAT_SUSPICIOUS_LOCATION_X5 → REPEAT_SUSPICIOUS_LOCATION
            hex.reasons[base] = (hex.reasons[base] || 0) + 1;
        }
    }

    // Convert to output array, applying minimum-incident filter
    const results: RiskZoneHex[] = [];

    hexMap.forEach((hex, h3Index) => {
        if (hex.stops.length < minIncidents) return;

        // Risk formula: avg_score × log₂(incident_count + 1)
        // Rewards both severity AND frequency
        const avgRisk = hex.totalScore / hex.stops.length;
        const frequencyBoost = Math.log2(hex.stops.length + 1);
        const normalizedScore = Math.min(Math.round(avgRisk * frequencyBoost), 100);

        const [centerLat, centerLng] = cellToLatLng(h3Index);
        const boundary = cellToBoundary(h3Index);

        // h3-js returns [[lat, lng], ...] — GeoJSON needs [lng, lat]
        const ring = boundary.map(([lat, lng]) => [lng, lat]);
        ring.push(ring[0]); // close ring

        results.push({
            h3Index,
            h3Resolution: res,
            riskScore: normalizedScore,
            incidentCount: hex.stops.length,
            criticalCount: hex.criticalCount,
            warningCount: hex.warningCount,
            nightIncidentCount: hex.nightCount,
            dayIncidentCount: hex.dayCount,
            reasonDistribution: hex.reasons,
            centerLat,
            centerLng,
            boundaryGeojson: {
                type: 'Polygon',
                coordinates: [ring],
            },
        });
    });

    return results.sort((a, b) => b.riskScore - a.riskScore);
}

// ────────────────────────────────────────────────────────────
// 2. DBSCAN cluster high-risk hexes into actionable polygons
// ────────────────────────────────────────────────────────────

export function clusterRiskHexes(
    hexes: RiskZoneHex[],
    minScore?: number,
): RiskZoneCluster[] {
    const H3 = SCORING_THRESHOLDS.STOP_RISK.H3;
    const threshold = minScore ?? SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS.WARNING;
    const radiusKm = H3.DBSCAN_RADIUS_KM;
    const minPts = H3.DBSCAN_MIN_POINTS;

    // Filter to qualifying hexes
    const hotHexes = hexes.filter(h => h.riskScore >= threshold);
    if (hotHexes.length < minPts) return [];

    // Build Turf point collection from hex centers
    const points = turf.featureCollection(
        hotHexes.map(h =>
            turf.point([h.centerLng, h.centerLat], {
                h3Index: h.h3Index,
                riskScore: h.riskScore,
            }),
        ),
    );

    const clustered = turf.clustersDbscan(points, radiusKm, { minPoints: minPts });

    // Group features by cluster ID
    const clusterMap = new Map<number, RiskZoneHex[]>();

    for (const feat of clustered.features) {
        const cid = feat.properties?.cluster;
        if (cid === undefined || cid === null || cid < 0) continue; // noise

        if (!clusterMap.has(cid)) clusterMap.set(cid, []);

        const h3Idx = feat.properties?.h3Index as string;
        const hex = hotHexes.find(h => h.h3Index === h3Idx);
        if (hex) clusterMap.get(cid)!.push(hex);
    }

    // Build cluster polygons
    const clusters: RiskZoneCluster[] = [];

    clusterMap.forEach((clusterHexes, clusterId) => {
        if (clusterHexes.length < minPts) return;

        // Strategy: merge hex boundaries into one polygon via convex hull + buffer
        const allPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
        for (const hex of clusterHexes) {
            const ring = hex.boundaryGeojson.coordinates[0];
            for (const coord of ring) {
                allPoints.push(turf.point(coord));
            }
        }

        const collection = turf.featureCollection(allPoints);
        const hull = turf.convex(collection);
        if (!hull) return;

        // Buffer by 1 km to encompass hex edges fully
        const buffered = turf.buffer(hull, 1, { units: 'kilometers' });
        if (!buffered) return;

        // Aggregate metrics
        const avgScore = Math.round(
            clusterHexes.reduce((s: number, h) => s + h.riskScore, 0) / clusterHexes.length,
        );
        const totalIncidents = clusterHexes.reduce((s: number, h) => s + h.incidentCount, 0);
        const nightCount = clusterHexes.reduce((s: number, h) => s + h.nightIncidentCount, 0);
        const dayCount = clusterHexes.reduce((s: number, h) => s + h.dayIncidentCount, 0);

        // Merge reason distributions
        const reasons: Record<string, number> = {};
        for (const hex of clusterHexes) {
            for (const [r, c] of Object.entries(hex.reasonDistribution)) {
                reasons[r] = (reasons[r] || 0) + (c as number);
            }
        }
        const primaryReason = Object.entries(reasons)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';

        const center = turf.center(buffered);

        clusters.push({
            clusterId,
            riskScore: avgScore,
            hexCount: clusterHexes.length,
            incidentCount: totalIncidents,
            polygonGeojson: buffered.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
            centerLat: center.geometry.coordinates[1],
            centerLng: center.geometry.coordinates[0],
            isNightDominant: nightCount > dayCount,
            primaryReason,
            reasonDistribution: reasons,
        });
    });

    return clusters.sort((a, b) => b.riskScore - a.riskScore);
}

// ────────────────────────────────────────────────────────────
// 3. Ring-neighbour risk propagation (optional, enriches grid)
//    If a hex has no incidents but is surrounded by hot hexes,
//    it gets a dampened risk score.
// ────────────────────────────────────────────────────────────

export function propagateRisk(hexes: RiskZoneHex[], kRing: number = 1): RiskZoneHex[] {
    const hexLookup = new Map(hexes.map(h => [h.h3Index, h]));
    const propagated: RiskZoneHex[] = [...hexes];

    for (const hex of hexes) {
        if (hex.riskScore < 50) continue; // only propagate from hot hexes

        const neighbours = gridDisk(hex.h3Index, kRing);
        for (const nIdx of neighbours) {
            if (nIdx === hex.h3Index) continue;
            if (hexLookup.has(nIdx)) continue; // already has own data

            // Create dampened neighbour entry
            const [nLat, nLng] = cellToLatLng(nIdx);
            const boundary = cellToBoundary(nIdx);
            const ring = boundary.map(([lat, lng]) => [lng, lat]);
            ring.push(ring[0]);

            const dampenedScore = Math.round(hex.riskScore * 0.3); // 30% propagation
            if (dampenedScore < 10) continue;

            const neighbour: RiskZoneHex = {
                h3Index: nIdx,
                h3Resolution: hex.h3Resolution,
                riskScore: dampenedScore,
                incidentCount: 0,
                criticalCount: 0,
                warningCount: 0,
                nightIncidentCount: 0,
                dayIncidentCount: 0,
                reasonDistribution: { PROPAGATED_FROM_NEIGHBOUR: 1 },
                centerLat: nLat,
                centerLng: nLng,
                boundaryGeojson: { type: 'Polygon', coordinates: [ring] },
            };

            propagated.push(neighbour);
            hexLookup.set(nIdx, neighbour); // prevent duplicate propagation
        }
    }

    return propagated;
}
