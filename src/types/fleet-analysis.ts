export type ZoneType = 'port' | 'border' | 'warehouse' | 'mining' | 'road';

export interface ActionItem {
    id: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    location: string;
    lat: number;
    lng: number;
    count: number;
    action: string;
    type: ZoneType;
}

export interface OperationalZone {
    name: string;
    type: ZoneType;
    lat: number;
    lng: number;
    radiusKm: number;
    threshold_mins?: number;
}

export interface FleetAnalysis {
    total: number;
    moving: number;
    movingPct: number;      // The "X% Active" headline percentage
    stopped: number;
    parked: number;
    idleStopped: number;
    idleParked: number;
    offline: number;
    avgSpeed: number;       // Average speed of moving vehicles in km/h
    aboveAvgSpeed: number;  // Count of vehicles speed > avg
    belowAvgSpeed: number;  // Count of vehicles speed < avg
    totalIdlingTime: number; // Total idling time (mocked for now)
    avgDrivingHours: number; // Avg driving hours/day
    nightDrivingHrs: number; // Night driving hours
    actions: ActionItem[];   // Ops actions from zone analysis
    zoneOccupancy?: Record<string, number>;
}

// Status configuration for the UI
export interface StatusConfig {
    key: keyof Omit<FleetAnalysis, 'total' | 'movingPct' | 'avgSpeed'>;
    label: string;
    shortLabel: string;
    colorVar: string;
    tailwindBg: string;
}

export const STATUS_CONFIGS: StatusConfig[] = [
    { key: 'moving', label: 'Moving', shortLabel: 'Moving', colorVar: '--status-green', tailwindBg: 'bg-green-500' },
    { key: 'stopped', label: 'Stopped', shortLabel: 'Stop', colorVar: '--status-red', tailwindBg: 'bg-red-400' },
    { key: 'parked', label: 'Parked', shortLabel: 'Park', colorVar: '--kpi-blue', tailwindBg: 'bg-blue-500' },
    { key: 'idleStopped', label: 'Idle-Stopped', shortLabel: 'I-Stop', colorVar: '--status-orange', tailwindBg: 'bg-orange-400' },
    { key: 'idleParked', label: 'Idle-Parked', shortLabel: 'I-Park', colorVar: '--status-purple', tailwindBg: 'bg-purple-400' },
    { key: 'offline', label: 'Offline', shortLabel: 'Off', colorVar: '--text-muted', tailwindBg: 'bg-slate-400' },
];
