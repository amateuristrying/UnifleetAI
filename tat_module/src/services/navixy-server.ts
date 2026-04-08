export const NavixyServerService = {
    /**
     * Helper to get the correct API Base URL.
     * On the server, we cannot use relative paths (like /api/navixy) which are meant for the client proxy.
     */
    _getApiBase: () => {
        const envUrl = process.env.NEXT_PUBLIC_NAVIXY_API_URL;
        // If env is missing, OR it's a relative path (starts with /), use the direct upstream URL.
        if (!envUrl || envUrl.startsWith('/')) {
            return 'https://api.navixy.com/v2';
        }
        return envUrl;
    },

    /**
     * Fetch granular track points (breadcrumbs) for a specific time range.
     * Server-side version: Uses direct API URL from env or default, bypassing Next.js proxy.
     */
    getTrack: async (trackerId: number, from: string, to: string, sessionKey: string): Promise<any[]> => {
        const API_BASE = NavixyServerService._getApiBase();

        const formatNavixyDate = (dateStr: string) => {
            const date = new Date(dateStr);
            return date.toISOString().replace('T', ' ').split('.')[0];
        };

        const fromStr = formatNavixyDate(from);
        const toStr = formatNavixyDate(to);

        const url = `${API_BASE}/track/read?tracker_id=${trackerId}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&hash=${sessionKey}`;

        try {
            console.log(`[NavixyServer] Fetching track: ${trackerId}`);
            const res = await fetch(url);

            if (!res.ok) {
                console.error(`[NavixyServer] HTTP Error ${res.status}`);
                return [];
            }

            const data = await res.json();
            if (data && data.success) {
                return data.list;
            } else {
                console.warn('[NavixyServer] API returned success=false', data);
                return [];
            }
        } catch (error) {
            console.error('[NavixyServer] Fetch error:', error);
            return [];
        }
    },

    /**
     * Fetch all geofences
     */
    /**
     * Fetch all geofences with pagination
     */
    listZones: async (sessionKey: string): Promise<any[]> => {
        const API_BASE = NavixyServerService._getApiBase();
        const LIMIT = 100;
        let offset = 0;
        let allZones: any[] = [];
        let fetchMore = true;

        try {
            while (fetchMore) {
                // Navixy API typically uses 'limit' and 'offset' for pagination
                // Added with_points=true and flags=1 to get polygon points in the list response
                const url = `${API_BASE}/zone/list?hash=${sessionKey}&limit=${LIMIT}&offset=${offset}&with_points=true&flags=1`;
                const res = await fetch(url);
                if (!res.ok) {
                    console.error(`[NavixyServer] listZones HTTP Error ${res.status}`);
                    break;
                }
                const data = await res.json();

                if (data && data.success) {
                    const zones = data.list || [];
                    allZones = [...allZones, ...zones];

                    if (zones.length < LIMIT) {
                        fetchMore = false;
                    } else {
                        offset += LIMIT;
                    }
                } else {
                    console.error('[NavixyServer] listZones API error:', data);
                    break;
                }
            }
            console.log(`[NavixyServer] Fetched total ${allZones.length} zones.`);
            return allZones;
        } catch (e) {
            console.error('[NavixyServer] listZones error:', e);
            return [];
        }
    },

    /**
     * Fetch points for a polygon zone
     */
    listZonePoints: async (zoneId: number, sessionKey: string): Promise<any[]> => {
        const API_BASE = NavixyServerService._getApiBase();
        const url = `${API_BASE}/zone/get_points?zone_id=${zoneId}&hash=${sessionKey}`;
        try {
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            return (data && data.success) ? data.value : []; // Navixy returns points in 'value'
        } catch (e) {
            console.error('[NavixyServer] listZonePoints error:', e);
            return [];
        }
    }
};
