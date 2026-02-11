import { updateStates } from './database';
import type { NavixyTrackerState } from './navixy';

/**
 * SyncService: Buffers WebSocket updates and flushes to IndexedDB every 30s
 * 
 * Features:
 * - Deduplication: Only latest state per vehicle is kept
 * - Page-hide flush: Data saved when tab closes/hides
 * - 30s interval flush for regular persistence
 */
class SyncService {
    private pendingStates = new Map<number, NavixyTrackerState>();
    private flushIntervalMs = 30000; // 30 seconds
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private isStarted = false;

    /**
     * Queue a state update (dedup: overwrites previous for same tracker)
     */
    queueState(state: NavixyTrackerState): void {
        const id = state.source_id ?? (state as any).tracker_id;
        if (id) {
            this.pendingStates.set(id, state);
        }
    }

    /**
     * Queue multiple states at once
     */
    queueStates(states: Record<number, NavixyTrackerState>): void {
        for (const [idStr, state] of Object.entries(states)) {
            const id = Number(idStr);
            this.pendingStates.set(id, state);
        }
    }

    /**
     * Start the sync service
     */
    start(): void {
        if (this.isStarted) return;
        this.isStarted = true;

        // Regular flush interval
        this.intervalId = setInterval(() => this.flush(), this.flushIntervalMs);

        // Flush on tab hide/close
        if (typeof window !== 'undefined') {
            window.addEventListener('visibilitychange', this.handleVisibilityChange);
            window.addEventListener('beforeunload', this.handleBeforeUnload);
        }

        console.log('[SyncService] Started with 30s flush interval');
    }

    /**
     * Stop the sync service
     */
    stop(): void {
        if (!this.isStarted) return;
        this.isStarted = false;

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (typeof window !== 'undefined') {
            window.removeEventListener('visibilitychange', this.handleVisibilityChange);
            window.removeEventListener('beforeunload', this.handleBeforeUnload);
        }

        // Final flush
        this.flush();
        console.log('[SyncService] Stopped');
    }

    /**
     * Flush pending states to IndexedDB
     */
    private async flush(): Promise<void> {
        if (this.pendingStates.size === 0) return;

        const statesToFlush: Record<number, NavixyTrackerState> = {};
        this.pendingStates.forEach((state, id) => {
            statesToFlush[id] = state;
        });
        this.pendingStates.clear();

        try {
            await updateStates(statesToFlush);
            console.log(`[SyncService] Flushed ${Object.keys(statesToFlush).length} states to DB`);
        } catch (error) {
            console.error('[SyncService] Flush failed:', error);
            // Re-queue failed states
            for (const [id, state] of Object.entries(statesToFlush)) {
                this.pendingStates.set(Number(id), state);
            }
        }
    }

    private handleVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
            this.flush();
        }
    };

    private handleBeforeUnload = (): void => {
        this.flush();
    };
}

// Singleton instance
export const syncService = new SyncService();
