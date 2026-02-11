import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type VehicleRecord } from '../services/database';

/**
 * Hook to get all vehicles from IndexedDB with live updates
 */
export function useVehiclesDB() {
    const vehicles = useLiveQuery(() => db.vehicles.toArray());

    return {
        dbVehicles: vehicles ?? [],
        isLoading: vehicles === undefined
    };
}

/**
 * Hook to track online/offline status
 */
export function useOnlineStatus(): boolean {
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
}

/**
 * Transform VehicleRecord[] to the Vehicle UI model
 * Includes ALL vehicles - those without state data get default values
 */
export function transformDBToVehicles(records: VehicleRecord[]) {
    return records.map(r => {
        const state = r.state;

        // If no state data, use defaults (vehicle will show but with unknown status)
        if (!state) {
            return {
                id: String(r.source_id),
                name: r.label || `Vehicle #${r.source_id}`,
                driver: 'Assigned',
                timeAgo: 'Unknown',
                speed: 0,
                address: 'Location unknown',
                status: 'Not Working' as const,
                coordinates: [0, 0] as [number, number],
                hasValidCoordinates: false
            };
        }

        // Map movement status to UI status with 24h threshold for offline
        let uiStatus: 'Running' | 'Stopped' | 'Idle' | 'Not Working' | 'Not Online' = 'Stopped';
        if (state.movement === 'moving') {
            uiStatus = 'Running';
        } else if (state.connection === 'offline') {
            // Check how long since last update
            const lastUpdate = new Date(state.last_updated.replace(' ', 'T') + 'Z').getTime();
            const now = Date.now();
            const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

            if (hoursSinceUpdate >= 24) {
                uiStatus = 'Not Working'; // ≥24h offline
            } else {
                uiStatus = 'Not Online'; // <24h offline
            }
        } else if (state.ignition && state.movement !== 'moving') {
            uiStatus = 'Idle';
        }

        // Check if coordinates are valid (not 0,0 and within reasonable range)
        const hasValidCoords = state.lat !== 0 && state.lng !== 0 &&
            Math.abs(state.lat) <= 90 && Math.abs(state.lng) <= 180;

        return {
            id: String(r.source_id),
            name: r.label,
            driver: 'Assigned',
            timeAgo: formatTimeAgo(state.last_updated),
            speed: state.speed,
            address: 'Fetching address...',
            status: uiStatus,
            coordinates: [state.lat, state.lng] as [number, number],
            hasValidCoordinates: hasValidCoords
        };
    });
}

// Simple time ago formatter
function formatTimeAgo(dateStr: string): string {
    if (!dateStr) return 'Unknown';

    try {
        const isoLike = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
        const date = new Date(isoLike);
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        return `${Math.floor(diffInSeconds / 86400)}d ago`;
    } catch {
        return 'Unknown';
    }
}
