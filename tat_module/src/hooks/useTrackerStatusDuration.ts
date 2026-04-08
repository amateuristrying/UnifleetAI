import { useState, useEffect, useRef } from 'react';
import { NavixyTrackerState } from '../services/navixy';
import { parseNavixyDate } from '@/lib/utils';

export type VehicleStatus = 'moving' | 'stopped' | 'parked' | 'idle-stopped' | 'idle-parked' | 'offline';

interface StatusRecord {
    status: VehicleStatus;
    startTime: number; // Timestamp in ms
    isRealtime?: boolean; // True if calculated from live update, False if from API
}

export function useTrackerStatusDuration(trackerStates: Record<number, NavixyTrackerState>, sessionKey?: string) {
    const [durations, setDurations] = useState<Record<number, StatusRecord>>({});
    const lastStatusRef = useRef<Record<number, VehicleStatus>>({});

    useEffect(() => {
        setDurations(prevDurations => {
            const newDurations = { ...prevDurations };
            let hasChanges = false;
            const now = Date.now();

            Object.entries(trackerStates).forEach(([idStr, state]) => {
                const id = Number(idStr);
                const currentStatus = getVehicleStatus(state);
                const prevStatus = lastStatusRef.current[id];
                const prevRecord = newDurations[id];

                // 1. Check for Status Change
                const isStatusChanged = prevStatus !== undefined && prevStatus !== currentStatus;

                // 2. Determine Start Time
                // Priority 1: If status changed in real-time, it starts NOW.
                // Priority 2: Use API-provided 'updated' timestamps if they align with status.
                // Priority 3: Keep existing record if status hasn't changed.
                // Priority 4: Fallback to Date.now() for initial load if API fields are missing.

                let startTime: number | null = null;

                if (isStatusChanged) {
                    startTime = now;
                } else if (!prevRecord) {
                    // Initial load or new tracker
                    startTime = getAPIStatusStartTime(state, currentStatus);

                    // If API doesn't provide it, we have to fallback to "now" (page load) 
                    // but mark it as realtime so we know it's not verified history.
                    if (!startTime) {
                        startTime = now;
                    }
                } else {
                    // Status hasn't changed, keep previous start time
                    startTime = prevRecord.startTime;
                }

                if (startTime && (!prevRecord || prevRecord.startTime !== startTime || prevRecord.status !== currentStatus)) {
                    newDurations[id] = {
                        status: currentStatus,
                        startTime,
                        isRealtime: isStatusChanged || !getAPIStatusStartTime(state, currentStatus)
                    };
                    hasChanges = true;
                }

                lastStatusRef.current[id] = currentStatus;
            });

            return hasChanges ? newDurations : prevDurations;
        });
    }, [trackerStates]);

    return durations;
}

// Helper: Determine status from live state
// Priority: Trust Navixy's movement_status (handles GPS drift, sophisticated detection)
// Engine-aware: Show compound states when engine is running (ignition on) but vehicle is stationary
// Fallback: Use speed + ignition only if movement_status unavailable
export function getVehicleStatus(state: NavixyTrackerState): VehicleStatus {
    // 1. Check connection first - offline takes priority
    if (state.connection_status === 'offline') return 'offline';

    const speed = state.gps.speed;
    const isIgnitionOn = state.ignition !== undefined ? state.ignition : (state.inputs?.[0] || false);

    // 2. Trust Navixy's movement detection (includes slow-moving traffic, crawling in queues)
    if (state.movement_status) {
        switch (state.movement_status) {
            case 'moving':
                return 'moving'; // Trust Navixy even if speed < 5 km/h (traffic jams, queues)

            case 'parked':
                // Long-term parking - check if engine is running
                return isIgnitionOn ? 'idle-parked' : 'parked';

            case 'stopped':
                // Temporary halt - check if engine is running
                return isIgnitionOn ? 'idle-stopped' : 'stopped';
        }
    }

    // 3. Fallback: speed-based detection (only if movement_status unavailable)
    if (speed > 5) return 'moving';
    if (isIgnitionOn) return 'idle-stopped'; // Fallback: engine running, no movement info

    // No movement_status - fallback to stopped
    return 'stopped';
}

/**
 * Helper: Extract the most relevant start time from API state fields.
 * Navixy (as of Feb 2025) provides movement_status_update and ignition_update.
 * Handles compound states (idle-stopped, idle-parked) by using movement status time.
 */
function getAPIStatusStartTime(state: NavixyTrackerState, status: VehicleStatus): number | null {
    try {
        if (status === 'moving' && state.movement_status_update) {
            return parseNavixyDate(state.movement_status_update).getTime();
        }

        if (status === 'offline') {
            return parseNavixyDate(state.last_update).getTime();
        }

        if ((status === 'stopped' || status === 'idle-stopped') && state.movement_status_update) {
            return parseNavixyDate(state.movement_status_update).getTime();
        }

        if ((status === 'parked' || status === 'idle-parked') && state.movement_status_update) {
            return parseNavixyDate(state.movement_status_update).getTime();
        }
    } catch (e) {
        console.warn('Failed to parse API status time:', e);
    }
    return null;
}
