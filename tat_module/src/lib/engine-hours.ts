import { NavixyTrackerState } from '../services/navixy';
import { parseNavixyDate } from './utils';
import { getVehicleStatus } from '@/hooks/useTrackerStatusDuration';

export interface EngineMetrics {
    totalEngineHours: number;  // Total time ignition has been ON (includes driving + idling)
    idleTime: number;          // Time stopped with engine ON (fuel waste)
    movingTime: number;        // Time spent driving
    isExcessiveIdle: boolean;  // Alert if idle > 15 minutes
}

/**
 * Calculate comprehensive engine usage metrics
 *
 * Industry standards:
 * - Idle Time = Time stopped with engine running (fuel waste metric)
 * - Engine Hours = Total ignition-on time (maintenance scheduling)
 * - Excessive Idle = > 15 minutes (fleet efficiency alert)
 */
export function calculateEngineMetrics(state: NavixyTrackerState): EngineMetrics | null {
    const now = Date.now();
    const status = getVehicleStatus(state);

    // Only calculate for vehicles with engine on
    const isIgnitionOn = state.ignition !== undefined ? state.ignition : (state.inputs?.[0] || false);

    if (!isIgnitionOn || status === 'offline') {
        return null;
    }

    try {
        // Total engine hours (from ignition_update)
        let totalEngineHours = 0;
        if (state.ignition_update) {
            const ignitionStart = parseNavixyDate(state.ignition_update).getTime();
            totalEngineHours = now - ignitionStart;
        }

        // Idle time (from movement_status_update if stopped)
        let idleTime = 0;
        if ((status === 'idle-stopped' || status === 'idle-parked') && state.movement_status_update) {
            const stoppedAt = parseNavixyDate(state.movement_status_update).getTime();
            idleTime = now - stoppedAt;
        }

        // Moving time (total - idle)
        const movingTime = Math.max(0, totalEngineHours - idleTime);

        // Alert threshold: 15 minutes of idle
        const isExcessiveIdle = idleTime > 15 * 60 * 1000;

        return {
            totalEngineHours,
            idleTime,
            movingTime,
            isExcessiveIdle
        };
    } catch (e) {
        console.warn('Failed to calculate engine metrics:', e);
        return null;
    }
}

/**
 * Format milliseconds to human-readable duration
 */
export function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Estimate fuel consumption during idle
 * Average diesel truck: ~1 liter per hour idle
 */
export function estimateIdleFuelWaste(idleMs: number): number {
    const hours = idleMs / (1000 * 60 * 60);
    return hours * 1.0; // liters (conservative estimate)
}

/**
 * Calculate cost of idle fuel waste
 */
export function estimateIdleCost(idleMs: number, fuelPricePerLiter: number = 1.5): number {
    const liters = estimateIdleFuelWaste(idleMs);
    return liters * fuelPricePerLiter; // USD
}
