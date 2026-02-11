import { useMemo } from 'react';
import type { NavixyTrackerState } from '@/services/navixy';
import { getVehicleStatus } from './useTrackerStatusDuration';
import * as turf from '@turf/turf';
import type { FleetAnalysis, OperationalZone, ActionItem } from '@/types/fleet-analysis';

// Configuration
export const CRITICAL_ZONES: OperationalZone[] = [
    { name: 'Dar es Salaam Port', type: 'port', lat: -6.8, lng: 39.28, radiusKm: 3 },
    { name: 'Tunduma Border (Zambia/Tanzania)', type: 'border', lat: -9.30, lng: 32.76, radiusKm: 2 },
    { name: 'Kasumbalesa Border', type: 'border', lat: -12.23, lng: 27.80, radiusKm: 2 },
    { name: 'Central Distribution Hub', type: 'warehouse', lat: -12.9, lng: 28.6, radiusKm: 5 },
    { name: 'Kansanshi Mine Access', type: 'mining', lat: -11.6, lng: 27.5, radiusKm: 3 }
];



export function useFleetAnalysis(trackers: Record<number, NavixyTrackerState>) {
    return useMemo((): FleetAnalysis | null => {
        const list = Object.values(trackers);
        const total = list.length;
        if (total === 0) return null;

        // 1. Basic Pulse - Use consistent status determination
        let moving = 0, stopped = 0, parked = 0, idleStopped = 0, idleParked = 0, offline = 0;
        let movingSpeeds: number[] = [];
        const slowMovingPoints: any[] = [];

        // 2. Zone Counters
        const zoneOccupancy: Record<string, number> = {};
        CRITICAL_ZONES.forEach(z => zoneOccupancy[z.name] = 0);

        list.forEach(t => {
            const speed = t.gps.speed;
            const status = getVehicleStatus(t);

            // Count by status using single source of truth
            switch (status) {
                case 'moving':
                    moving++;
                    movingSpeeds.push(speed);
                    // Slow moving detection (< 15km/h) for Traffic Analysis
                    if (speed < 15) {
                        slowMovingPoints.push(turf.point([t.gps.location.lng, t.gps.location.lat]));
                    }
                    break;
                case 'stopped':
                    stopped++;
                    break;
                case 'parked':
                    parked++;
                    break;
                case 'idle-stopped':
                    idleStopped++;
                    break;
                case 'idle-parked':
                    idleParked++;
                    break;
                case 'offline':
                    offline++;
                    break;
            }

            // Zone Check
            const pt = turf.point([t.gps.location.lng, t.gps.location.lat]);
            CRITICAL_ZONES.forEach(geo => {
                const center = turf.point([geo.lng, geo.lat]);
                const dist = turf.distance(pt, center, { units: 'kilometers' });
                if (dist <= geo.radiusKm) {
                    zoneOccupancy[geo.name]++;
                }
            });
        });

        // Avg Fleet Speed
        const avgSpeed = movingSpeeds.length > 0
            ? Math.round(movingSpeeds.reduce((a, b) => a + b, 0) / movingSpeeds.length)
            : 0;

        // Above/Below Avg
        const aboveAvgSpeed = movingSpeeds.filter(s => s > avgSpeed).length;
        const belowAvgSpeed = movingSpeeds.filter(s => s <= avgSpeed && s > 0).length;

        // 3. Cluster & Delay Analysis
        const actions: ActionItem[] = [];

        // A. Known Zones Logic
        CRITICAL_ZONES.forEach(zone => {
            const count = zoneOccupancy[zone.name];
            if (count >= 3) {
                let title = 'Zone Activity';
                let action = 'Monitor status.';
                let severity: 'high' | 'medium' | 'low' = 'low';

                if (zone.type === 'port') {
                    title = 'Port Loading Congestion';
                    action = 'Contact Terminal Operations for slot availability.';
                    severity = count > 10 ? 'high' : 'medium';
                } else if (zone.type === 'border') {
                    title = 'Border Crossing Queue';
                    action = 'Verify clearing agent documents for queued trucks.';
                    severity = count > 5 ? 'high' : 'medium';
                } else if (zone.type === 'warehouse') {
                    title = 'Offloading Bottleneck';
                    action = 'Alert Warehouse Manager to open extra bays.';
                    severity = 'medium';
                }

                actions.push({
                    id: `zone-${zone.name}`,
                    severity,
                    title,
                    location: zone.name,
                    lat: zone.lat,
                    lng: zone.lng,
                    count,
                    action,
                    type: zone.type
                });
            }
        });

        // B. Unknown Road Clusters (DBSCAN)
        if (slowMovingPoints.length >= 3) {
            const collection = turf.featureCollection(slowMovingPoints);
            // @ts-ignore
            const clustered = turf.clustersDbscan(collection, 2.0, { minPoints: 3, units: 'kilometers' });

            const clusterMap: Record<number, any[]> = {};
            turf.featureEach(clustered, (feature) => {
                const clusterId = feature.properties?.cluster;
                if (clusterId !== undefined) {
                    if (!clusterMap[clusterId]) clusterMap[clusterId] = [];
                    // @ts-ignore
                    clusterMap[clusterId].push(feature.geometry.coordinates);
                }
            });

            Object.entries(clusterMap).forEach(([id, coords]) => {
                // Centroid of the jam
                const clusterPoints = turf.featureCollection(coords.map(c => turf.point(c)));
                const center = turf.center(clusterPoints);
                const [lng, lat] = center.geometry.coordinates;

                // Check if inside known zone (to avoid double reporting)
                let isKnownZone = false;
                CRITICAL_ZONES.forEach(z => {
                    const zCenter = turf.point([z.lng, z.lat]);
                    if (turf.distance(center, zCenter) < z.radiusKm) isKnownZone = true;
                });

                if (!isKnownZone) {
                    actions.push({
                        id: `traffic-${id}`,
                        severity: 'medium',
                        title: 'Road Congestion Detected',
                        location: `Lat: ${lat.toFixed(2)}, Lng: ${lng.toFixed(2)}`,
                        lat,
                        lng,
                        count: coords.length,
                        action: 'Check Google Traffic & suggest alternate route.',
                        type: 'road'
                    });
                }
            });
        }

        const movingPct = Math.round((moving / total) * 100);

        return {
            total,
            moving,
            movingPct,
            stopped,
            parked,
            idleStopped,
            idleParked,
            offline,
            avgSpeed,
            aboveAvgSpeed,
            belowAvgSpeed,
            totalIdlingTime: 124, // Mocked
            avgDrivingHours: 8.5, // Mocked
            nightDrivingHrs: 42,  // Mocked
            actions: actions.sort((a) => (a.severity === 'high' ? -1 : 1)),
            zoneOccupancy
        };
    }, [trackers]);
}
