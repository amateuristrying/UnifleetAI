'use client';

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
    // Basic hex check (3 or 6 chars) - Navixy often returns 'RRGGBB'
    if (/^[0-9A-Fa-f]{6}$/.test(color) || /^[0-9A-Fa-f]{3}$/.test(color)) {
        return `#${color}`;
    }
    return color; // Return as-is if it might be a named color or invalid (Mapbox handles valid names)
}

// ============================================================
// Status helper
// ============================================================
function getTrackerStatus(tracker: NavixyTrackerState): string {
    if (!tracker) return 'Unknown';

    let status = tracker.movement_status
        ? (tracker.movement_status.charAt(0).toUpperCase() + tracker.movement_status.slice(1))
        : 'Unknown';

    // Check for Engine Idle (Stopped + Ignition On)
    if (tracker.movement_status === 'stopped' && tracker.ignition) {
        status = 'Idle';
    }

    // Check for Connection Status
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
    sessionKey: string | undefined
) {
    const [zones, setZones] = useState<Geofence[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);

    const zonesLoadedRef = useRef(false);

    // ---------------------------------------------------------
    // 1. Load zones from Navixy on mount (batched to avoid rate limits)
    // ---------------------------------------------------------
    const loadZones = useCallback(async () => {
        if (!sessionKey) return;
        setLoading(true);
        setError(null);
        try {
            const navixyZones = await NavixyService.listZones(sessionKey);

            // Enrich each zone — batch getZonePoints calls to avoid rate limits
            const enriched: Geofence[] = [];
            const BATCH_SIZE = 5;

            for (let i = 0; i < navixyZones.length; i += BATCH_SIZE) {
                const batch = navixyZones.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                    batch.map(async (z: any) => {
                        let points: NavixyZonePoint[] | undefined;
                        let center: { lat: number; lng: number } | undefined;

                        if (z.type === 'polygon' || z.type === 'sausage') {
                            // Points are usually returned in the list response
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

                // Delay between batches to yield to UI
                if (i + BATCH_SIZE < navixyZones.length) {
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            setZones(enriched);
            zonesLoadedRef.current = true;
        } catch (err) {
            setError('Failed to load geofence zones');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [sessionKey]);

    useEffect(() => { loadZones(); }, [loadZones]);

    // ---------------------------------------------------------
    // 2. Real-time zone occupancy via Turf.js (Client-side)
    // ---------------------------------------------------------
    useEffect(() => {
        // Debounce calculation to avoid UI jank
        const timer = setTimeout(() => {
            if (!zonesLoadedRef.current || zones.length === 0) return;
            // Early exit if no trackers
            if (Object.keys(trackers).length === 0) return;

            const trackerEntries = Object.entries(trackers);
            const zoneVehicles: Record<number, Set<number>> = {};
            zones.forEach(z => { zoneVehicles[z.id] = new Set(); });

            trackerEntries.forEach(([idStr, state]) => {
                const trackerId = Number(idStr);
                const { lat, lng } = state.gps.location;
                if (!lat || !lng) return;

                try {
                    zones.forEach(zone => {
                        let isInside = false;
                        if (zone.type === 'circle' && zone.center && zone.radius) {
                            const distance = turf.distance(
                                turf.point([lng, lat]),
                                turf.point([zone.center!.lng, zone.center!.lat]),
                                { units: 'meters' }
                            );
                            if (distance <= zone.radius) isInside = true;
                        } else if (zone.type === 'polygon' && zone.points && zone.points.length >= 3) {
                            const coords = zone.points.map(p => [p.lng, p.lat]);
                            coords.push(coords[0]); // close ring
                            const poly = turf.polygon([coords]);
                            // @ts-ignore
                            if (turf.booleanPointInPolygon(turf.point([lng, lat]), poly)) isInside = true;
                        } else if (zone.type === 'sausage' && zone.points && zone.points.length >= 2 && zone.radius) {
                            const coords = zone.points.map(p => [p.lng, p.lat]);
                            const line = turf.lineString(coords);
                            const pointOnLine = turf.point([lng, lat]);
                            const distance = turf.pointToLineDistance(pointOnLine, line, { units: 'meters' });
                            if (distance <= zone.radius) isInside = true;
                        }

                        if (isInside) {
                            zoneVehicles[zone.id].add(trackerId);
                        }
                    });
                } catch (e) {
                    // Ignore invalid geometry processing
                }
            });

            setZones(prev => {
                let changed = false;
                const next = prev.map(z => {
                    const currentIds = zoneVehicles[z.id] || new Set();
                    const nextOccupants: Record<number, any> = { ...z.occupants };
                    let occupantsChanged = false;

                    // 1. Handle entries and updates
                    currentIds.forEach(tid => {
                        if (!nextOccupants[tid]) {
                            // New entry
                            // SMART BACKFILL: If vehicle is already stopped/parked, usage 'movement_status_update' 
                            // as the entry time (approximate, but better than "now").
                            let entryTime = Date.now();
                            let status = 'Unknown';

                            const tracker = trackers[tid];
                            if (tracker) {
                                const { movement_status, movement_status_update } = tracker;
                                // Calculate status
                                status = getTrackerStatus(tracker);

                                // User requested status-based only
                                const isStopped = movement_status === 'parked' || movement_status === 'stopped';

                                if (isStopped && movement_status_update) {
                                    const updateTime = parseNavixyDate(movement_status_update).getTime();
                                    // Sanity check: updateTime should be in the past. 
                                    // INCREASED LIMIT: Allow up to 10 years (was 365 days) to cover long-term offline vehicles.
                                    if (updateTime < entryTime && updateTime > entryTime - (10 * 365 * 24 * 60 * 60 * 1000)) {
                                        entryTime = updateTime;
                                    }
                                } else if (tracker.connection_status === 'offline' && tracker.last_update) {
                                    // Fallback for "Moving (Offline)" or other states where vehicle is disconnected.
                                    // If offline, it has been in this position since at least 'last_update'.
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
                            // Existing - update lastSeen and status to reflect real-time changes
                            const tracker = trackers[tid];
                            const status = tracker ? getTrackerStatus(tracker) : (nextOccupants[tid].status || 'Unknown');

                            nextOccupants[tid] = {
                                ...nextOccupants[tid],
                                lastSeen: Date.now(),
                                status
                            };
                        }
                    });

                    // 2. Handle exits
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

        }, 500);

        return () => clearTimeout(timer);
    }, [trackers, zones.length]); // Intentionally omitting deep dependency check on zones content, using length + loaded ref

    // ---------------------------------------------------------
    // 4. CRUD operations
    // ---------------------------------------------------------
    const createZone = useCallback(async (payload: CreateZonePayload): Promise<number | null> => {
        if (!sessionKey) return null;
        const result = await NavixyService.createZone(payload, sessionKey);
        if (!result) return null;

        if ((payload.type === 'polygon' || payload.type === 'sausage') && payload.points) {
            // Wait a bit for zone creation to propagate
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

    // ---------------------------------------------------------
    // 5. Derived: zoneOccupancy map (backward compat)
    // ---------------------------------------------------------
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
