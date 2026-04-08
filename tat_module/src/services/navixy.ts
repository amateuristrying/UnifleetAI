export interface NavixyTrackerState {
    source_id: number;
    gps: {
        location: {
            lat: number;
            lng: number;
        };
        heading: number;
        speed: number;
        updated?: string; // Corrected from update_time
    };
    inputs: boolean[];
    last_update: string;
    // New fields from Navixy 2025 update (Corrected Names)
    movement_status?: 'moving' | 'stopped' | 'parked';
    movement_status_update?: string;
    ignition?: boolean;
    ignition_update?: string;
    connection_status?: 'active' | 'idle' | 'offline';
}

export interface NavixyEvent {
    id: number;
    tracker_id: number;
    type: string;
    message: string;
    location: {
        lat: number;
        lng: number;
    };
    time: string; // ISO timestamp
}

// Use local proxy by default to avoid CORS, unless explicitly overridden by a non-standard env var?
// Actually, for this fix, we simply want to force the proxy usage if we are in the browser.
// If process.env.NEXT_PUBLIC_NAVIXY_API_URL is set, it overrides, so we need to change precedence or ignore it if it matches the default remote.
const BASE_URL = '/api/navixy';

async function fetchJson(endpoint: string, options?: RequestInit) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    console.log(`[fetchJson] Fetching: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        console.log(`[fetchJson] Response status: ${response.status} ${response.statusText}`);

        // Handle common HTTP errors
        if (!response.ok) {
            console.error(`[fetchJson] ✗ HTTP Error ${response.status}: ${response.statusText}`);
            console.error(`[fetchJson] URL: ${url}`);
            // Attempt to read body for more info
            const text = await response.text();
            console.error('[fetchJson] Response body:', text);
            return null;
        }

        const text = await response.text();
        console.log(`[fetchJson] Response text length: ${text?.length || 0}`);

        if (!text) {
            console.warn('[fetchJson] Empty response received');
            return null;
        }

        try {
            const json = JSON.parse(text);
            console.log(`[fetchJson] ✓ Successfully parsed JSON:`, json.success ? 'success=true' : 'success=false');
            return json;
        } catch (e) {
            console.error('[fetchJson] ✗ Failed to parse JSON:', e);
            console.error('[fetchJson] Raw text:', text.substring(0, 500));
            return null;
        }
    } catch (networkError: any) {
        clearTimeout(timeoutId);
        if (networkError.name === 'AbortError') {
            console.error(`[fetchJson] ✗ Request timed out: ${url}`);
        } else {
            console.error('[fetchJson] ✗ Network error:', networkError);
            console.error('[fetchJson] URL:', url);
        }
        return null;
    }
}

export const NavixyService = {
    /**
     * Fetch the current state of a tracker, including location and inputs.
     * @param trackerId The ID of the tracker.
     * @param sessionKey The valid session key (hash).
     */
    getTrackerState: async (trackerId: number, sessionKey: string): Promise<NavixyTrackerState | null> => {
        const data = await fetchJson(`/tracker/get_state?tracker_id=${trackerId}&hash=${sessionKey}`);
        if (data && data.success) {
            return data.state as NavixyTrackerState;
        }
        return null;
    },

    /**
     * Get list of all trackers to initialize the dashboard.
     */
    listTrackers: async (sessionKey: string) => {
        const data = await fetchJson(`/tracker/list?hash=${sessionKey}`);
        return (data && data.success) ? data.list : [];
    },

    /**
     * Fetch recent events for a tracker to determine status duration.
     * Searches for trip/parking/idling start/end events in the last 24 hours.
     */
    getTrackerEvents: async (trackerId: number, sessionKey: string, hours = 24): Promise<NavixyEvent[]> => {
        // Calculate time range
        const to = new Date();
        const from = new Date(to.getTime() - (hours * 60 * 60 * 1000));
        const fromStr = from.toISOString().replace('T', ' ').split('.')[0];
        const toStr = to.toISOString().replace('T', ' ').split('.')[0];

        const data = await fetchJson(
            `/event/list?tracker_id=${trackerId}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&hash=${sessionKey}`
        );
        return (data && data.success) ? data.list as NavixyEvent[] : [];
    },

    /**
     * Fetch granular track points (breadcrumbs) for a specific time range.
     * Used for detailed route analysis and deviation detection.
     */
    getTrack: async (trackerId: number, from: string, to: string, sessionKey: string): Promise<any[]> => {
        // Navixy API expects dates in "YYYY-MM-DD HH:mm:ss" format
        // We handle ISO strings with or without milliseconds/timezones
        const formatNavixyDate = (dateStr: string) => {
            const date = new Date(dateStr);
            // Format to YYYY-MM-DD HH:mm:ss manually to avoid timezone issues or library deps if not needed
            // But simplify: ISO string usually is UTC. Navixy often expects server time or UTC.
            // Let's stick to the simple string manipulation but robus:
            // 1. Remove timezone info (+00:00 or Z)
            // 2. Replace T with space
            // 3. Remove milliseconds
            return date.toISOString().replace('T', ' ').split('.')[0];
        };

        const fromStr = formatNavixyDate(from);
        const toStr = formatNavixyDate(to);

        const data = await fetchJson(
            `/track/read?tracker_id=${trackerId}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&hash=${sessionKey}`
        );
        return (data && data.success) ? data.list : [];
    },

    // =========================================================
    // GEOFENCE (ZONE) API
    // =========================================================

    /**
     * List all geofence zones.
     */
    listZones: async (sessionKey: string): Promise<any[]> => {
        const data = await fetchJson(`/zone/list?hash=${sessionKey}&with_points=true`);
        return (data && data.success) ? data.list : [];
    },

    /**
     * Create a new geofence zone.
     */
    createZone: async (payload: any, sessionKey: string): Promise<{ id: number } | null> => {
        const params = new URLSearchParams({
            hash: sessionKey,
            label: payload.label,
            type: payload.type === 'corridor' ? 'sausage' : payload.type,
            color: payload.color || '#3b82f6',
            visible: 'true'
        });

        if (payload.type === 'circle') {
            params.append('radius', payload.radius.toString());
            params.append('center_lat', payload.center.lat.toString());
            params.append('center_lng', payload.center.lng.toString());
        } else if (payload.type === 'sausage' || payload.type === 'corridor') {
            params.append('radius', payload.radius.toString());
        }

        const data = await fetchJson(`/zone/create?${params.toString()}`, { method: 'POST' });

        if (data && data.success) {
            return { id: data.id };
        }
        console.error('Create Zone Error:', data);
        return null;
    },

    /**
     * Update an existing zone (metadata like name, color, radius).
     */
    updateZone: async (payload: any, sessionKey: string): Promise<boolean> => {
        const params = new URLSearchParams({ hash: sessionKey, zone_id: payload.id.toString() });
        if (payload.label) params.append('label', payload.label);
        if (payload.color) params.append('color', payload.color);
        if (payload.radius) params.append('radius', payload.radius.toString());
        if (payload.visible !== undefined) params.append('visible', payload.visible.toString());

        const data = await fetchJson(`/zone/update?${params.toString()}`, { method: 'POST' });
        return !!(data && data.success);
    },

    /**
     * Delete a zone.
     */
    deleteZone: async (zoneId: number, sessionKey: string): Promise<boolean> => {
        const data = await fetchJson(`/zone/delete?zone_id=${zoneId}&hash=${sessionKey}`, { method: 'POST' });
        return !!(data && data.success);
    },



    /**
     * Update points for a polygon or corridor zone.
     * Note: Navixy expects points as a JSON array string.
     */
    updateZonePoints: async (zoneId: number, points: { lat: number, lng: number }[], sessionKey: string): Promise<boolean> => {
        const pointsJson = JSON.stringify(points);
        const params = new URLSearchParams({
            hash: sessionKey,
            zone_id: zoneId.toString(),
            points: pointsJson
        });

        const data = await fetchJson(`/zone/update_points?${params.toString()}`, { method: 'POST' });
        return !!(data && data.success);
    },



};
