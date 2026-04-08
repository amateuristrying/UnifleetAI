import { useState, useEffect, useRef } from 'react';
import { NavixyTrackerState } from '../services/navixy';
import { NavixySocket } from '../services/navixy-socket';

export function useNavixyRealtime(trackerIds: number[], sessionKey: string | undefined) {
    const [trackerStates, setTrackerStates] = useState<Record<number, NavixyTrackerState>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Store socket instance in ref to persist across renders
    const socketRef = useRef<NavixySocket | null>(null);

    useEffect(() => {
        if (!sessionKey || trackerIds.length === 0) {
            setLoading(false);
            return;
        }

        // Initialize socket if not exists
        if (!socketRef.current) {
            socketRef.current = new NavixySocket(process.env.NEXT_PUBLIC_NAVIXY_API_URL);
        }

        const socket = socketRef.current;

        const handleUpdates = (newStates: Record<number, NavixyTrackerState>) => {
            setTrackerStates(prev => ({
                ...prev,
                ...newStates
            }));
            setLoading(false);
        };

        try {
            socket.connect(sessionKey, trackerIds, handleUpdates);
        } catch (err) {
            console.error('Socket connection error:', err);
            setError('Failed to connect to real-time service');
            setLoading(false);
        }

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [JSON.stringify(trackerIds), sessionKey]);

    return { trackerStates, loading, error };
}
