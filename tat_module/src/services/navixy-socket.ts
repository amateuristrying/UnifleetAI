
import { NavixyTrackerState } from './navixy';

type WebSocketAction = 'subscribe' | 'unsubscribe';

type WebSocketEventType = 'iot_monitor' | 'state_batch';

interface WebSocketRequest {
    type: WebSocketEventType;
    target: {
        type: 'selected' | 'all';
        tracker_ids?: number[];
    };
    rate_limit?: string;
    format?: 'full' | 'compact';
}

interface WebSocketPayload {
    action: WebSocketAction;
    hash: string;
    requests: WebSocketRequest[];
}

export class NavixySocket {
    private socket: WebSocket | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private trackerIds: number[] = [];
    private sessionKey: string | null = null;
    private onUpdate: ((states: Record<number, NavixyTrackerState>) => void) | null = null;

    private isConnected = false;
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_DELAY = 30000;

    private url: string;

    constructor(
        private readonly apiBaseUrl: string = '/api/navixy'
    ) {
        if (typeof window === 'undefined') {
            this.url = ''; // Server-side safety
            return;
        }

        // Handle relative URLs (e.g., '/api/navixy') by resolving against current origin
        let distinctUrl = this.apiBaseUrl;
        if (this.apiBaseUrl.startsWith('/')) {
            distinctUrl = `${window.location.protocol}//${window.location.host}${this.apiBaseUrl}`;
        } else if (!this.apiBaseUrl.startsWith('http')) {
            // Assume it's just a hostname
            distinctUrl = `https://${this.apiBaseUrl}`;
        }

        // Convert HTTP/HTTPS to WS/WSS
        const isSecure = distinctUrl.startsWith('https');
        const protocol = isSecure ? 'wss://' : 'ws://';

        // Remove protocol and trailing slash
        const host = distinctUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        this.url = `${protocol}${host}/event/subscription`;
    }

    connect(sessionKey: string, trackerIds: number[], onUpdate: (states: Record<number, NavixyTrackerState>) => void) {
        this.sessionKey = sessionKey;
        this.trackerIds = trackerIds;
        this.onUpdate = onUpdate;

        this.initSocket();
    }

    private initSocket() {
        if (this.socket) {
            this.socket.close();
        }

        try {
            console.log('Connecting to Navixy WebSocket:', this.url);
            this.socket = new WebSocket(this.url);

            this.socket.onopen = () => {
                console.log('Navixy WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.subscribe();
            };

            this.socket.onmessage = (event) => {
                try {
                    // Ignore Atmosphere heartbeat/padding
                    if (event.data === 'X') {
                        return;
                    }

                    // Check if message is a pipe-separated atmosphere frame
                    if (typeof event.data === 'string' && event.data.includes('|')) {
                        const parts = event.data.split('|');
                        // Usually format is length|json
                        if (parts.length > 1 && parts[1].startsWith('{')) {
                            try {
                                const data = JSON.parse(parts[1]);
                                this.handleMessage(data);
                                return;
                            } catch (e) {
                                // ignore parse error for frames
                            }
                        }
                        // Ignore other atmosphere protocol frames (heartbeats etc)
                        return;
                    }

                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (err) {
                    console.warn('Failed to parse WebSocket message:', event.data);
                }
            };

            this.socket.onclose = (event) => {
                console.log('Navixy WebSocket closed', event.code, event.reason);
                this.isConnected = false;
                this.scheduleReconnect();
            };

            this.socket.onerror = (error) => {
                // Browser WebSocket errors are often empty objects, so we log what we can
                console.error('Navixy WebSocket error. Check network tab for details.');
                this.socket?.close();
            };

        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    private subscribe() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionKey) {
            return;
        }

        // Use state_batch for efficient updates of all trackers
        // Request 'full' format to ensure we receive complete tracker state objects
        const payload: WebSocketPayload = {
            action: 'subscribe',
            hash: this.sessionKey,
            requests: [{
                type: 'state_batch',
                target: {
                    type: 'all'
                },
                rate_limit: '1s',
                format: 'full'
            }]
        };

        this.socket.send(JSON.stringify(payload));
    }

    private handleMessage(data: any) {
        // Handle subscription response
        if (data.type === 'response' && data.action === 'subscription/subscribe') {
            // Check for success OR presence of value map (which implies success)
            if (data.data?.state_batch?.success || data.data?.state_batch?.value) {
                console.log('Successfully subscribed to state_batch');
            } else {
                console.warn('Subscription to state_batch failed', data);
            }
            return;
        }

        // Handle real-time updates
        if (data.type === 'event' && data.event === 'state_batch') {
            const updates: Record<number, NavixyTrackerState> = {};

            // data.data is an array of tracker states
            const items = Array.isArray(data.data) ? data.data : [data.data];

            items.forEach((item: any) => {
                // state_batch items are often wrapped in a "state" property: { state: { ... } }
                // or just the state object directly.
                const stateData = item.state || item;

                // Prioritize tracker_id (internal unique ID) over source_id (shared hardware ID)
                // to prevent aliasing multiple trackers to the same ID.
                const id = stateData.tracker_id || stateData.source_id;

                if (stateData && id) {
                    updates[id] = stateData as NavixyTrackerState;
                }
            });

            if (Object.keys(updates).length > 0 && this.onUpdate) {
                this.onUpdate(updates);
            }
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) {
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.MAX_RECONNECT_DELAY);
        console.log(`Scheduling reconnect in ${delay}ms`);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.reconnectAttempts++;
            this.initSocket();
        }, delay);
    }

    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.socket) {
            // successful close should not trigger reconnect
            this.socket.onclose = null;
            this.socket.close();
            this.socket = null;
        }

        this.isConnected = false;
        this.onUpdate = null;
    }
}
