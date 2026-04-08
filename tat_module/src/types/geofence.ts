export type GeofenceCategory = 'port' | 'border' | 'warehouse' | 'mining' | 'depot' | 'custom';

export interface Geofence {
    id: number;
    name: string;
    type: 'polygon' | 'corridor' | 'circle' | 'sausage';
    category: GeofenceCategory;
    color: string;

    // Geometry
    points?: { lat: number; lng: number }[];
    center?: { lat: number; lng: number };
    radius?: number; // meters

    // State
    vehicleCount: number;
    vehicleIds: number[];
    occupants: Record<number, GeofenceOccupant>; // map of trackerId -> occupant data
}

export interface GeofenceOccupant {
    trackerId: number;
    custom_name?: string; // Cache the name to avoid constant lookups if needed
    entryTime: number; // Timestamp (ms)
    lastSeen: number; // Timestamp (ms)
    status: string; // e.g. 'parked', 'moving', 'stopped'
}

export interface GeofenceEvent {
    zoneId: number;
    zoneName: string;
    trackerId: number;
    type: 'inzone' | 'outzone';
    time: string; // ISO
    durationStr?: string; // "12m 30s"
}

export interface NavixyZonePoint {
    lat: number;
    lng: number;
}

export interface NavixyZone {
    id: number;
    label: string;
    address?: string;
    color?: string;
    type: 'polygon' | 'circle' | 'sausage'; // Navixy types
    // Available fields depend on type
    radius?: number; // for circle/sausage
    center?: { lat: number; lng: number }; // for circle
}

export interface CreateZonePayload {
    label: string;
    type: 'polygon' | 'circle' | 'sausage' | 'corridor';
    category?: GeofenceCategory;
    color?: string;
    points?: { lat: number; lng: number }[];
    radius?: number;
    center?: { lat: number; lng: number };
}

export interface UpdateZonePayload {
    id: number;
    label?: string;
    color?: string;
    type?: string;
    radius?: number;
}
