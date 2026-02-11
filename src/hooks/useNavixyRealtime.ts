
import { useState, useEffect } from 'react';
import { NavixySocket } from '../services/navixy-socket';
import type { NavixyTrackerState } from '../services/navixy';

const socket = new NavixySocket();

export function useNavixyRealtime(trackerIds: number[] | 'all', sessionKey: string) {
    const [trackerStates, setTrackerStates] = useState<Record<number, NavixyTrackerState>>({});
    const [lastUpdate, setLastUpdate] = useState(Date.now());
    const [loading, setLoading] = useState(true);



    useEffect(() => {
        if (!sessionKey) return;

        // Clear previous state when switching regions
        setTrackerStates({});
        setLoading(true);

        const idsArray = trackerIds === 'all' ? [] : trackerIds;
        socket.connect(sessionKey, idsArray, (updates) => {
            setTrackerStates(prev => ({ ...prev, ...updates }));
            setLastUpdate(Date.now());
            setLoading(false);
        });

        // Cleanup on unmount or key/ids change
        return () => {
            // We usually don't disconnect the global socket on every unmount if we want persistence,
            // but for this hook's scope, we might. 
            // However, NavixySocket is a singleton-ish class here (const socket = new ...).
            // So multiple components using this hook might conflict if we disconnect blindly.
            // For now, let's keep it connected.
            // socket.disconnect(); 
        };
    }, [sessionKey, trackerIds === 'all' ? 'all' : trackerIds.join(',')]);

    return { trackerStates, lastUpdate, loading };
}
