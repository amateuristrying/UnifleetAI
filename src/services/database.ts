import Dexie, { type Table } from 'dexie';

/**
 * Vehicle record combining static tracker info + dynamic state
 * Primary key: source_id (links API list to WebSocket stream)
 */
export interface VehicleRecord {
    // Identity & Config (from listTrackers → source)
    source_id: number;           // Primary Key
    label: string;               // Vehicle name
    group_id: number;            // Fleet grouping
    model: string;               // Device model
    phone: string;               // SIM/Driver number
    tariff_end_date: string;     // Subscription expiry
    device_id: string;           // Backend troubleshooting

    // Real-Time Telemetry (from state_batch WebSocket)
    state: {
        lat: number;
        lng: number;
        speed: number;
        heading: number;
        connection: string;      // 'active' | 'offline'
        movement: string;        // 'parked' | 'moving' | 'stopped'
        battery: number;
        ignition: boolean;
        last_updated: string;
    } | null;
}

class UnifleetDB extends Dexie {
    vehicles!: Table<VehicleRecord, number>;

    constructor() {
        super('unifleet');

        this.version(1).stores({
            // source_id is primary key, indexed fields for queries
            vehicles: 'source_id, label, group_id, state.connection, state.movement'
        });
    }
}

export const db = new UnifleetDB();

/**
 * Upsert tracker list from API (static data)
 */
export async function upsertTrackers(trackers: any[]): Promise<void> {
    const records: VehicleRecord[] = trackers.map(t => ({
        source_id: t.source?.id ?? t.id,
        label: t.label || t.source?.device_id || `Vehicle ${t.id}`,
        group_id: t.group_id ?? 0,
        model: t.source?.model || '',
        phone: t.source?.phone || '',
        tariff_end_date: t.tariff_end_date || '',
        device_id: t.source?.device_id || '',
        state: null  // Will be populated by WebSocket
    }));

    await db.vehicles.bulkPut(records);
    console.log(`[DB] Upserted ${records.length} trackers`);
}

/**
 * Update vehicle states from WebSocket (merge with existing)
 */
export async function updateStates(states: Record<number, any>): Promise<void> {
    const updates: Partial<VehicleRecord>[] = [];

    for (const [idStr, rawState] of Object.entries(states)) {
        const source_id = rawState.source_id ?? Number(idStr);

        updates.push({
            source_id,
            state: {
                lat: rawState.gps?.location?.lat ?? 0,
                lng: rawState.gps?.location?.lng ?? 0,
                speed: rawState.gps?.speed ?? 0,
                heading: rawState.gps?.heading ?? 0,
                connection: rawState.connection_status ?? 'unknown',
                movement: rawState.movement_status ?? 'unknown',
                battery: rawState.battery_level ?? 0,
                ignition: rawState.inputs?.[0] ?? false,
                last_updated: rawState.gps?.updated ?? rawState.last_update ?? ''
            }
        });
    }

    // Merge updates with existing records
    await db.transaction('rw', db.vehicles, async () => {
        for (const update of updates) {
            const existing = await db.vehicles.get(update.source_id!);
            if (existing) {
                await db.vehicles.update(update.source_id!, { state: update.state });
            }
            // If vehicle doesn't exist yet (state before list loaded), skip
        }
    });

    console.log(`[DB] Updated ${updates.length} vehicle states`);
}

/**
 * Get all vehicles from DB
 */
export async function getAllVehicles(): Promise<VehicleRecord[]> {
    return db.vehicles.toArray();
}

/**
 * Clear all data (for debugging/reset)
 */
export async function clearDatabase(): Promise<void> {
    await db.vehicles.clear();
    console.log('[DB] Database cleared');
}
