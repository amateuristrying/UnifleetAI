import { useState, useEffect, useRef } from 'react';
import type { NavixyTrackerState } from '../services/navixy';
import { parseNavixyDate } from '@/lib/utils';

export type VehicleStatus = 'moving' | 'stopped' | 'parked' | 'idle-stopped' | 'idle-parked' | 'offline';

interface StatusRecord {
    status: VehicleStatus;
    startTime: number; // Timestamp in ms
    isRealtime?: boolean; // True if calculated from live update, False if from API
}

// Helper: Determine status from live state
export function getVehicleStatus(state: NavixyTrackerState): VehicleStatus {
    // 1. Check connection first - offline takes priority
    if (state.connection_status === 'offline') return 'offline';

    const speed = state.gps.speed;
    const isIgnitionOn = state.ignition !== undefined ? state.ignition : (state.inputs?.[0] || false);

    // 2. Trust Navixy's movement detection
    if (state.movement_status) {
        switch (state.movement_status) {
            case 'moving':
                return 'moving';
            case 'parked':
                return isIgnitionOn ? 'idle-parked' : 'parked';
            case 'stopped':
                return isIgnitionOn ? 'idle-stopped' : 'stopped';
        }
    }

    // 3. Fallback
    if (speed > 5) return 'moving';
    if (isIgnitionOn) return 'idle-stopped';

    return 'stopped';
}

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

export function useTrackerStatusDuration(trackerStates: Record<number, NavixyTrackerState>, _sessionKey?: string) {
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

                const isStatusChanged = prevStatus !== undefined && prevStatus !== currentStatus;

                let startTime: number | null = null;

                if (isStatusChanged) {
                    startTime = now;
                } else if (!prevRecord) {
                    startTime = getAPIStatusStartTime(state, currentStatus);
                    if (!startTime) {
                        startTime = now;
                    }
                } else {
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
