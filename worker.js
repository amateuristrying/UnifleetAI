/**
 * Unifleet Live Telemetry ETL Worker
 * ===================================
 * Connects to Navixy WebSocket, captures all live vehicle state updates,
 * and persists them into Supabase continuously (24/7).
 *
 * Data Flow:
 *   Navixy WS → Buffer (5s) → Batch upsert to Supabase
 *
 * Tables written:
 *   - vehicle_latest_state  (upserted — always current)
 *   - vehicle_telemetry     (appended — time-series history)
 *   - tracker_registry      (upserted on first tracker list fetch)
 */

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
    navixy: {
        apiUrl: process.env.NAVIXY_API_URL || 'https://api.navixy.com/v2',
        sessions: {
            tanzania: process.env.NAVIXY_SESSION_KEY_TZ,
            zambia: process.env.NAVIXY_SESSION_KEY_ZM,
        },
    },
    supabase: {
        url: process.env.SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || '5000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate config
if (!CONFIG.supabase.url || !CONFIG.supabase.serviceKey || CONFIG.supabase.serviceKey === '<PASTE_YOUR_SERVICE_ROLE_KEY_HERE>') {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in your environment variables');
    console.error('   Get your service_role key from: Supabase Dashboard → Settings → API');
    process.exit(1);
}

if (!CONFIG.navixy.sessions.tanzania && !CONFIG.navixy.sessions.zambia) {
    console.error('❌ At least one Navixy session key must be set');
    process.exit(1);
}

// ─── Supabase Client ─────────────────────────────────────────────────────────

const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, {
    auth: { persistSession: false },
});

// ─── Logging ─────────────────────────────────────────────────────────────────

const log = {
    info: (...args) => console.log(`[${ts()}] ℹ️ `, ...args),
    warn: (...args) => console.warn(`[${ts()}] ⚠️ `, ...args),
    error: (...args) => console.error(`[${ts()}] ❌`, ...args),
    debug: (...args) => {
        if (CONFIG.logLevel === 'debug') console.log(`[${ts()}] 🔍`, ...args);
    },
    success: (...args) => console.log(`[${ts()}] ✅`, ...args),
};

function ts() {
    return new Date().toISOString().replace('T', ' ').split('.')[0];
}

// ─── Stats ───────────────────────────────────────────────────────────────────

const stats = {
    messagesReceived: 0,
    statesBuffered: 0,
    batchesWritten: 0,
    rowsWritten: 0,
    errors: 0,
    startTime: Date.now(),
};

function printStats() {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    log.info(`📊 Stats — Uptime: ${h}h${m}m${s}s | Messages: ${stats.messagesReceived} | Buffered: ${stats.statesBuffered} | Batches: ${stats.batchesWritten} | Rows: ${stats.rowsWritten} | Errors: ${stats.errors}`);
}

// Print stats every 60s
setInterval(printStats, 60_000);

// ─── Tracker List Fetcher ────────────────────────────────────────────────────

async function fetchTrackerList(sessionKey, opsRegion) {
    try {
        const url = `${CONFIG.navixy.apiUrl}/tracker/list?hash=${sessionKey}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.success || !data.list) {
            log.warn(`Failed to fetch tracker list for ${opsRegion}:`, data.status?.description || 'unknown error');
            return [];
        }

        const trackers = data.list;
        log.info(`📋 Fetched ${trackers.length} trackers for ${opsRegion}`);

        // Populate trackerNameMap for name resolution in flushBuffers
        trackers.forEach(t => trackerNameMap.set(t.id, t.label));

        // Upsert into tracker_registry
        const records = trackers.map(t => ({
            tracker_id: t.id,
            source_id: t.source?.id ?? null,
            label: t.label || `Vehicle ${t.id}`,
            group_id: t.group_id ?? 0,
            model: t.source?.model || '',
            phone: t.source?.phone || '',
            device_id: t.source?.device_id || '',
            ops_region: opsRegion,
            tariff_end_date: t.tariff_end_date || '',
            last_seen: new Date().toISOString(),
        }));

        // Batch upsert in chunks of 500
        for (let i = 0; i < records.length; i += 500) {
            const chunk = records.slice(i, i + 500);
            const { error } = await supabase
                .from('tracker_registry')
                .upsert(chunk, { onConflict: 'tracker_id' });

            if (error) {
                log.error(`Tracker registry upsert error (${opsRegion}):`, error.message);
            }
        }

        log.success(`Tracker registry updated for ${opsRegion}: ${records.length} vehicles`);
        return trackers;
    } catch (err) {
        log.error(`Tracker list fetch failed (${opsRegion}):`, err.message);
        return [];
    }
}

// ─── Tracker Name Map ────────────────────────────────────────────────────────
// Populated by fetchTrackerList(), used by flushBuffers() to resolve names
const trackerNameMap = new Map();

// ─── Initial State Fetcher (HTTP API) ─────────────────────────────────────────

async function fetchInitialStates(sessionKey, opsRegion) {
    try {
        const url = `${CONFIG.navixy.apiUrl}/tracker/list/batch_states?hash=${sessionKey}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.success || !data.states) {
            log.warn(`Could not fetch initial states for ${opsRegion}`);
            return;
        }
        let count = 0;
        for (const [trackerId, stateData] of Object.entries(data.states)) {
            if (stateData && typeof stateData === 'object') {
                bufferState(Number(trackerId), stateData, opsRegion);
                count++;
            }
        }
        log.info(`📥 Buffered initial states for ${count} trackers (${opsRegion})`);
    } catch (err) {
        log.error(`Initial state fetch failed (${opsRegion}):`, err.message);
    }
}

// ─── State Buffer & Flusher ──────────────────────────────────────────────────

/** @type {Map<string, Map<number, {state: any, opsRegion: string}>>} */
const buffers = new Map();

function getBuffer(opsRegion) {
    if (!buffers.has(opsRegion)) {
        buffers.set(opsRegion, new Map());
    }
    return buffers.get(opsRegion);
}

function bufferState(trackerId, stateData, opsRegion) {
    const buffer = getBuffer(opsRegion);
    buffer.set(trackerId, { state: stateData, opsRegion });
    stats.statesBuffered++;
}

async function flushBuffers() {
    for (const [opsRegion, buffer] of buffers.entries()) {
        if (buffer.size === 0) continue;

        // Snapshot and clear
        const snapshot = new Map(buffer);
        buffer.clear();

        const latestRows = [];
        const telemetryRows = [];
        const now = new Date().toISOString();

        for (const [trackerId, { state }] of snapshot) {
            const stateObj = state.state || state;
            const sourceId = stateObj.source_id ?? null;

            const row = {
                tracker_id: trackerId,
                source_id: sourceId,
                tracker_name: trackerNameMap.get(trackerId) ?? null,
                ops_region: opsRegion,
                lat: stateObj.gps?.location?.lat ?? stateObj.lat ?? null,
                lng: stateObj.gps?.location?.lng ?? stateObj.lng ?? null,
                speed: parseFloat(stateObj.gps?.speed ?? stateObj.speed ?? 0),
                heading: parseFloat(stateObj.gps?.heading ?? stateObj.heading ?? 0),
                connection_status: stateObj.connection_status ?? 'unknown',
                movement_status: stateObj.movement_status ?? 'unknown',
                ignition: stateObj.inputs?.[0] ?? stateObj.ignition ?? false,
                battery_level: parseFloat(stateObj.battery_level ?? 0),
                gps_updated: stateObj.gps?.updated ?? stateObj.gps_updated ?? null,
                last_update: stateObj.last_update ?? null,
            };

            // For latest_state: add ingested_at + raw_state
            latestRows.push({
                ...row,
                ingested_at: now,
                raw_state: stateObj,
            });

            // For telemetry: add ingested_at (no raw_state to save space)
            telemetryRows.push({
                ...row,
                ingested_at: now,
            });
        }

        try {
            // 1. Upsert latest state (bulk)
            const { error: latestErr } = await supabase
                .from('vehicle_latest_state')
                .upsert(latestRows, { onConflict: 'tracker_id' });

            if (latestErr) {
                log.error(`Latest state upsert error (${opsRegion}):`, latestErr.message);
                stats.errors++;
            }

            // 2. Insert telemetry history (bulk append)
            // Chunk to avoid payload size limits
            for (let i = 0; i < telemetryRows.length; i += 500) {
                const chunk = telemetryRows.slice(i, i + 500);
                const { error: telemetryErr } = await supabase
                    .from('vehicle_telemetry')
                    .insert(chunk);

                if (telemetryErr) {
                    log.error(`Telemetry insert error (${opsRegion}):`, telemetryErr.message);
                    stats.errors++;
                }
            }

            stats.batchesWritten++;
            stats.rowsWritten += latestRows.length;

            log.debug(`Flushed ${latestRows.length} states for ${opsRegion}`);
        } catch (err) {
            log.error(`Flush error (${opsRegion}):`, err.message);
            stats.errors++;

            // Re-buffer on failure
            for (const [k, v] of snapshot) {
                buffer.set(k, v);
            }
        }
    }
}

// ─── WebSocket Connection Manager ────────────────────────────────────────────

class NavixyETLSocket {
    constructor(sessionKey, opsRegion) {
        this.sessionKey = sessionKey;
        this.opsRegion = opsRegion;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 30000;
        this.reconnectTimeout = null;
        this.isRunning = false;
        this.heartbeatInterval = null;
    }

    start() {
        this.isRunning = true;
        this.connect();
    }

    stop() {
        this.isRunning = false;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    connect() {
        if (!this.isRunning) return;

        const url = `wss://api.navixy.com/v2/event/subscription`;
        log.info(`🔌 Connecting to Navixy WebSocket for ${this.opsRegion}...`);

        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            log.success(`WebSocket connected for ${this.opsRegion}`);
            this.reconnectAttempts = 0;
            this.subscribe();
            this.startHeartbeat();
        });

        this.ws.on('message', (raw) => {
            try {
                const msg = raw.toString();

                // Skip Atmosphere heartbeats
                if (msg === 'X' || msg === '') return;

                // Handle pipe-separated Atmosphere frames
                if (msg.includes('|')) {
                    const parts = msg.split('|');
                    if (parts.length > 1 && parts[1].startsWith('{')) {
                        try {
                            const data = JSON.parse(parts[1]);
                            this.handleMessage(data);
                        } catch (_) { /* ignore unparseable frames */ }
                    }
                    return;
                }

                const data = JSON.parse(msg);
                this.handleMessage(data);
            } catch (err) {
                log.debug(`Parse error (${this.opsRegion}):`, err.message);
            }
        });

        this.ws.on('close', (code, reason) => {
            log.warn(`WebSocket closed for ${this.opsRegion}: code=${code} reason=${reason}`);
            this.stopHeartbeat();
            this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            log.error(`WebSocket error (${this.opsRegion}):`, err.message);
            this.ws?.close();
        });
    }

    subscribe() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const payload = {
            action: 'subscribe',
            hash: this.sessionKey,
            requests: [{
                type: 'state_batch',
                target: { type: 'all' },
                rate_limit: '3s',    // 3s rate limit to balance freshness vs volume
                format: 'full',
            }],
        };

        this.ws.send(JSON.stringify(payload));
        log.info(`📡 Subscribed to state_batch for ${this.opsRegion} (rate_limit: 3s)`);
    }

    handleMessage(data) {
        stats.messagesReceived++;

        // Subscription response
        if (data.type === 'response' && data.action === 'subscription/subscribe') {
            if (data.data?.state_batch?.success || data.data?.state_batch?.value) {
                // Skip initial valueMap — keys may be source_ids not tracker_ids.
                // Live events will populate everything within seconds.
                log.info(`📥 Subscription confirmed, live updates starting for ${this.opsRegion}`);
            } else {
                log.warn(`Subscription failed for ${this.opsRegion}:`, JSON.stringify(data));
            }
            return;
        }

        // Real-time state_batch event
        if (data.type === 'event' && data.event === 'state_batch') {
            const items = Array.isArray(data.data) ? data.data : [data.data];

            for (const item of items) {
                const trackerId = item.tracker_id;
                const stateData = item.state || item;
                stateData.source_id = item.source_id ?? item.state?.source_id ?? null;
                if (stateData && trackerId) {
                    bufferState(trackerId, stateData, this.opsRegion);
                }
            }

            log.debug(`Buffered ${items.length} states for ${this.opsRegion}`);
        }

        // Also handle source_state_event format (what Navixy actually sends live)
        if (data.type === 'source_state_event') {
            const trackerId = data.tracker_id;
            const stateData = data.state || data;
            if (stateData && trackerId) {
                bufferState(trackerId, stateData, this.opsRegion);
            }
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        // Send a ping every 30s to keep connection alive
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30_000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    scheduleReconnect() {
        if (!this.isRunning || this.reconnectTimeout) return;

        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            this.maxReconnectDelay
        );

        log.info(`🔄 Reconnecting ${this.opsRegion} in ${delay / 1000}s (attempt ${this.reconnectAttempts + 1})...`);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.reconnectAttempts++;
            this.connect();
        }, delay);
    }
}

// ─── Session Key Refresh ─────────────────────────────────────────────────────

// Navixy session keys expire. Re-fetch tracker list periodically to verify.
// If the session is invalid, log an error (manual intervention needed).
async function verifySession(sessionKey, opsRegion) {
    try {
        const url = `${CONFIG.navixy.apiUrl}/user/get_info?hash=${sessionKey}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            log.info(`🔑 Session valid for ${opsRegion}: ${data.info?.login || 'OK'}`);
            return true;
        } else {
            log.error(`🔑 Session INVALID for ${opsRegion}: ${data.status?.description || 'unknown'}`);
            return false;
        }
    } catch (err) {
        log.error(`Session check failed (${opsRegion}):`, err.message);
        return false;
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║   🚛 Unifleet Live Telemetry ETL Worker       ║');
    console.log('║   Navixy WebSocket → Supabase (24/7)          ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');

    const sockets = [];

    // Start flush interval
    const flushInterval = setInterval(flushBuffers, CONFIG.batchIntervalMs);
    log.info(`Batch flush interval: ${CONFIG.batchIntervalMs}ms`);

    // Delete telemetry older than 48 hours — runs every hour
    setInterval(async () => {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { error } = await supabase
            .from('vehicle_telemetry')
            .delete()
            .lt('ingested_at', cutoff);
        if (error) log.error('Cleanup error:', error.message);
        else log.info('🧹 Telemetry cleanup complete');
    }, 60 * 60 * 1000);

    // Connect each ops region
    for (const [region, sessionKey] of Object.entries(CONFIG.navixy.sessions)) {
        if (!sessionKey) {
            log.warn(`No session key for ${region}, skipping`);
            continue;
        }

        // Verify session
        const valid = await verifySession(sessionKey, region);
        if (!valid) {
            log.error(`Skipping ${region} — session key is invalid. Update .env and restart.`);
            continue;
        }

        // Fetch and register trackers
        await fetchTrackerList(sessionKey, region);

        // Fetch initial states via HTTP API (reliable tracker_ids)
        await fetchInitialStates(sessionKey, region);

        // Start WebSocket
        const socket = new NavixyETLSocket(sessionKey, region);
        socket.start();
        sockets.push(socket);
    }

    if (sockets.length === 0) {
        log.error('No valid connections established. Exiting.');
        process.exit(1);
    }

    log.success(`ETL Worker running with ${sockets.length} region(s)`);
    log.info('Press Ctrl+C to stop\n');

    // Periodic tracker list refresh (every 6 hours)
    setInterval(async () => {
        for (const [region, sessionKey] of Object.entries(CONFIG.navixy.sessions)) {
            if (sessionKey) {
                await fetchTrackerList(sessionKey, region);
            }
        }
    }, 6 * 60 * 60 * 1000);

    // Graceful shutdown
    const shutdown = async () => {
        log.info('🛑 Shutting down...');
        clearInterval(flushInterval);

        // Final flush
        await flushBuffers();

        // Close sockets
        for (const socket of sockets) {
            socket.stop();
        }

        printStats();
        log.info('Goodbye!');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    log.error('Fatal error:', err);
    process.exit(1);
});
