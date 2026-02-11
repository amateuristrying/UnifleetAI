import { useState, useEffect, useRef, useCallback } from 'react';
import * as turf from '@turf/turf';
import { parseNavixyDate } from '../lib/utils';
import { NavixyService, type NavixyTrackerState } from '../services/navixy';
import type {
    Geofence, GeofenceCategory,
    NavixyZone, NavixyZonePoint, CreateZonePayload, UpdateZonePayload,
} from '../types/geofence';

// ============================================================
// Category inference from zone label
// ============================================================
function inferCategory(zone: NavixyZone): GeofenceCategory {
    const label = zone.label.toLowerCase();
    if (label.includes('port') || label.includes('terminal')) return 'port';
    if (label.includes('border') || label.includes('customs')) return 'border';
    if (label.includes('warehouse') || label.includes('depot') || label.includes('hub')) return 'warehouse';
    if (label.includes('mine') || label.includes('mining')) return 'mining';
    return 'custom';
}

function normalizeColor(color: string | undefined): string {
    if (!color) return '#3b82f6';
    if (color.startsWith('#')) return color;
    if (/^[0-9A-Fa-f]{6}$/.test(color) || /^[0-9A-Fa-f]{3}$/.test(color)) {
        return `#${color}`;
    }
    return color;
}

// ============================================================
// Status helper
// ============================================================
function getTrackerStatus(tracker: NavixyTrackerState): string {
    if (!tracker) return 'Unknown';

    let status = tracker.movement_status
        ? (tracker.movement_status.charAt(0).toUpperCase() + tracker.movement_status.slice(1))
        : 'Unknown';

    if (tracker.movement_status === 'stopped' && tracker.ignition) {
        status = 'Idle';
    }

    if (tracker.connection_status === 'offline') {
        status += ' (Offline)';
    }

    return status;
}

// ============================================================
// Main hook
// ============================================================
export function useGeofences(
    trackers: Record<number, NavixyTrackerState>,
    sessionKey: string | undefined,
    _navixyTrackerIds?: number[]
) {
    const [zones, setZones] = useState<Geofence[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);

    const zonesLoadedRef = useRef(false);

    // ---------------------------------------------------------
    // 1. Load zones from Navixy on mount
    // ---------------------------------------------------------
    const loadZones = useCallback(async (signal?: { isCurrent: boolean }) => {
        if (!sessionKey) {
            setZones([]);
            setSelectedZoneId(null);
            setLoading(false);
            zonesLoadedRef.current = false;
            return;
        }

        setLoading(true);
        setError(null);

        // Reset state so we don't show old zones from previous region
        setZones([]);
        setSelectedZoneId(null);
        zonesLoadedRef.current = false;

        try {
            const navixyZones = await NavixyService.listZones(sessionKey);
            if (signal && !signal.isCurrent) return;

            const enriched: Geofence[] = [];
            const BATCH_SIZE = 5;

            for (let i = 0; i < navixyZones.length; i += BATCH_SIZE) {
                const batch = navixyZones.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                    batch.map(async (z: any) => {
                        let points: NavixyZonePoint[] | undefined;
                        let center: { lat: number; lng: number } | undefined;

                        if (z.type === 'polygon' || z.type === 'sausage') {
                            points = z.points;
                            if (points && points.length > 0) {
                                const avgLat = points.reduce((s: number, p: any) => s + p.lat, 0) / points.length;
                                const avgLng = points.reduce((s: number, p: any) => s + p.lng, 0) / points.length;
                                center = { lat: avgLat, lng: avgLng };
                            }
                        } else if (z.type === 'circle') {
                            center = z.center;
                        }

                        return {
                            id: z.id,
                            name: z.label,
                            type: z.type,
                            category: inferCategory(z),
                            color: normalizeColor(z.color),
                            center,
                            radius: z.radius,
                            points,
                            vehicleCount: 0,
                            vehicleIds: [],
                            occupants: {},
                        } as Geofence;
                    })
                );
                enriched.push(...batchResults);

                if (signal && !signal.isCurrent) return;

                if (i + BATCH_SIZE < navixyZones.length) {
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            if (!signal || signal.isCurrent) {
                setZones(enriched);
                setLoading(false);
                zonesLoadedRef.current = true;
            }
        } catch (err) {
            if (!signal || signal.isCurrent) {
                setError('Failed to load geofence zones');
                console.error(err);
                setLoading(false);
            }
        }
    }, [sessionKey]);

    useEffect(() => {
        zonesLoadedRef.current = false;
        const signal = { isCurrent: true };
        loadZones(signal);
        return () => { signal.isCurrent = false; };
    }, [loadZones]);

    // ---------------------------------------------------------
    // 2. Real-time zone occupancy via Turf.js (Client-side)
    //    Uses a ref so WebSocket updates don't reset the timer.
    // ---------------------------------------------------------
    const trackersRef = useRef(trackers);
    trackersRef.current = trackers;

    // Pre-compute zone geometries so Turf.js doesn't rebuild them every tick
    const zoneGeomRef = useRef<Map<number, any>>(new Map());
    useEffect(() => {
        const geoms = new Map<number, any>();
        zones.forEach(zone => {
            if (zone.type === 'circle' && zone.center && zone.radius) {
                geoms.set(zone.id, { type: 'circle', center: turf.point([zone.center.lng, zone.center.lat]), radius: zone.radius });
            } else if (zone.type === 'polygon' && zone.points && zone.points.length >= 3) {
                const coords = zone.points.map(p => [p.lng, p.lat]);
                coords.push(coords[0]);
                try { geoms.set(zone.id, { type: 'polygon', poly: turf.polygon([coords]) }); } catch { /* skip bad geom */ }
            } else if (zone.type === 'sausage' && zone.points && zone.points.length >= 2 && zone.radius) {
                const coords = zone.points.map(p => [p.lng, p.lat]);
                try { geoms.set(zone.id, { type: 'sausage', line: turf.lineString(coords), radius: zone.radius }); } catch { /* skip */ }
            }
        });
        zoneGeomRef.current = geoms;
    }, [zones]);

    useEffect(() => {
        if (!zonesLoadedRef.current || zones.length === 0) return;

        // Fixed interval that reads the latest tracker data from the ref
        const interval = setInterval(() => {
            const currentTrackers = trackersRef.current;
            if (Object.keys(currentTrackers).length === 0) return;

            const trackerEntries = Object.entries(currentTrackers);
            const zoneVehicles: Record<number, Set<number>> = {};
            zones.forEach(z => { zoneVehicles[z.id] = new Set(); });
            const geoms = zoneGeomRef.current;

            trackerEntries.forEach(([idStr, state]) => {
                const trackerId = Number(idStr);
                const { lat, lng } = state.gps.location;
                if (!lat || !lng) return;

                const pt = turf.point([lng, lat]);

                try {
                    zones.forEach(zone => {
                        const geom = geoms.get(zone.id);
                        if (!geom) return;

                        let isInside = false;
                        if (geom.type === 'circle') {
                            isInside = turf.distance(pt, geom.center, { units: 'meters' }) <= geom.radius;
                        } else if (geom.type === 'polygon') {
                            // @ts-ignore
                            isInside = turf.booleanPointInPolygon(pt, geom.poly);
                        } else if (geom.type === 'sausage') {
                            isInside = turf.pointToLineDistance(pt, geom.line, { units: 'meters' }) <= geom.radius;
                        }

                        if (isInside) {
                            zoneVehicles[zone.id].add(trackerId);
                        }
                    });
                } catch {
                    // Ignore invalid geometry processing
                }
            });

            setZones(prev => {
                let changed = false;
                const next = prev.map(z => {
                    const currentIds = zoneVehicles[z.id] || new Set();
                    const nextOccupants: Record<number, any> = { ...z.occupants };
                    let occupantsChanged = false;

                    // Handle entries and updates
                    currentIds.forEach(tid => {
                        if (!nextOccupants[tid]) {
                            let entryTime = Date.now();
                            let status = 'Unknown';

                            const tracker = currentTrackers[tid];
                            if (tracker) {
                                const { movement_status, movement_status_update } = tracker;
                                status = getTrackerStatus(tracker);
                                const isStopped = movement_status === 'parked' || movement_status === 'stopped';

                                if (isStopped && movement_status_update) {
                                    const updateTime = parseNavixyDate(movement_status_update).getTime();
                                    if (updateTime < entryTime && updateTime > entryTime - (10 * 365 * 24 * 60 * 60 * 1000)) {
                                        entryTime = updateTime;
                                    }
                                } else if (tracker.connection_status === 'offline' && tracker.last_update) {
                                    const updateTime = parseNavixyDate(tracker.last_update).getTime();
                                    if (updateTime < entryTime && updateTime > entryTime - (10 * 365 * 24 * 60 * 60 * 1000)) {
                                        entryTime = updateTime;
                                    }
                                }
                            }

                            nextOccupants[tid] = {
                                trackerId: tid,
                                entryTime: entryTime,
                                lastSeen: Date.now(),
                                status
                            };
                            occupantsChanged = true;
                        } else {
                            const tracker = currentTrackers[tid];
                            const status = tracker ? getTrackerStatus(tracker) : (nextOccupants[tid].status || 'Unknown');
                            nextOccupants[tid] = {
                                ...nextOccupants[tid],
                                lastSeen: Date.now(),
                                status
                            };
                        }
                    });

                    // Handle exits
                    Object.keys(nextOccupants).forEach(tidStr => {
                        const tid = Number(tidStr);
                        if (!currentIds.has(tid)) {
                            delete nextOccupants[tid];
                            occupantsChanged = true;
                        }
                    });

                    const newCount = currentIds.size;
                    const newIds = Array.from(currentIds);

                    if (
                        occupantsChanged ||
                        z.vehicleCount !== newCount ||
                        z.vehicleIds.length !== newIds.length
                    ) {
                        changed = true;
                        return {
                            ...z,
                            vehicleCount: newCount,
                            vehicleIds: newIds,
                            occupants: nextOccupants
                        };
                    }
                    return z;
                });
                return changed ? next : prev;
            });

        }, 3000); // Fixed 3s interval – not affected by tracker state updates

        return () => clearInterval(interval);
    }, [zones]);

    // ---------------------------------------------------------
    // CRUD operations
    // ---------------------------------------------------------
    const createZone = useCallback(async (payload: CreateZonePayload): Promise<number | null> => {
        if (!sessionKey) return null;
        const result = await NavixyService.createZone(payload, sessionKey);
        if (!result) return null;

        if ((payload.type === 'polygon' || payload.type === 'sausage') && payload.points) {
            await new Promise(r => setTimeout(r, 500));
            await NavixyService.updateZonePoints(result.id, payload.points, sessionKey);
        }

        await loadZones();
        return result.id;
    }, [sessionKey, loadZones]);

    const updateZone = useCallback(async (payload: UpdateZonePayload, newPoints?: Array<{ lat: number; lng: number }>): Promise<boolean> => {
        if (!sessionKey) return false;
        const ok = await NavixyService.updateZone(payload, sessionKey);
        if (!ok) return false;

        if (newPoints) {
            await NavixyService.updateZonePoints(payload.id, newPoints, sessionKey);
        }

        await loadZones();
        return true;
    }, [sessionKey, loadZones]);

    const deleteZone = useCallback(async (zoneId: number): Promise<boolean> => {
        if (!sessionKey) return false;
        const ok = await NavixyService.deleteZone(zoneId, sessionKey);
        if (ok) {
            setZones(prev => prev.filter(z => z.id !== zoneId));
            if (selectedZoneId === zoneId) setSelectedZoneId(null);
        }
        return ok;
    }, [sessionKey, selectedZoneId]);

    // Derived: zoneOccupancy map
    const zoneOccupancy: Record<string, number> = {};
    zones.forEach(z => { zoneOccupancy[z.name] = z.vehicleCount; });

    return {
        zones,
        loading,
        error,
        selectedZoneId,
        zoneOccupancy,

        setSelectedZoneId,
        createZone,
        updateZone,
        deleteZone,
        refreshZones: loadZones,
    };
}
