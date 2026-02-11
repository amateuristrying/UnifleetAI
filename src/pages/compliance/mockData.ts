export type TimeRange = '30d' | 'all';

export type ComplianceCategory = 'driver' | 'operational' | 'sla';

export type ComplianceMetricType =
    // Driver
    | 'speed_violations' | 'harsh_driving' | 'night_driving' | 'route_deviation'
    // Operational
    | 'excess_idling' | 'long_dwell' | 'unauthorized_stops'
    // SLA
    | 'late_delivery' | 'geofence_overstay' | 'route_non_adherence';

export interface BreachInstance {
    id: string;
    startTime: string; // ISO date
    endTime: string;   // ISO date
    durationMinutes: number;
    details?: string; // e.g. "85 km/h in 60 zone" or "Deviation 5km"
}

export interface VehicleBreachSummary {
    vehicleId: string;
    vehicleName: string;
    breachCount: number;
    totalDurationMinutes: number; // aggregated
    severity: 'low' | 'medium' | 'high';
    instances: BreachInstance[];
}

export interface ComplianceSummaryStats {
    totalNonCompliantVehicles: number;
    mostFrequentBreachType: string;
    worstOffendingVehicle: {
        name: string;
        breachCount: number;
        breachType: string;
    } | null;
}

// Map metric keys to readable labels
export const METRIC_LABELS: Record<ComplianceMetricType, string> = {
    speed_violations: "Speed Violations",
    harsh_driving: "Harsh Driving",
    night_driving: "Night Driving Breach",
    route_deviation: "Route Deviation",
    excess_idling: "Excess Idling",
    long_dwell: "Long Dwell Time",
    unauthorized_stops: "Unauthorized Stops",
    late_delivery: "Late Delivery",
    geofence_overstay: "Geofence Overstay",
    route_non_adherence: "Route Non-Adherence"
};

// Generate Mock Data
const VEHICLE_NAMES = [
    "ACZ 9354 ZM HIACE TR", "CAA 95 ZM", "CAC 1566 ZM", "BBD 4524 ZM SHACMAN",
    "IT 1290", "T 892 DCL", "T 567 AAB", "Vehicle #102938", "Scania G460",
    "Volvo FH16", "Mercedes Actros", "DAF XF", "Review Unit 01"
];

function randomDate(start: Date, end: Date) {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateInstances(count: number, range: TimeRange): BreachInstance[] {
    const instances: BreachInstance[] = [];
    const now = new Date();
    const startDate = new Date();
    if (range === '30d') startDate.setDate(now.getDate() - 30);
    else startDate.setFullYear(now.getFullYear() - 1);

    for (let i = 0; i < count; i++) {
        const start = randomDate(startDate, now);
        const duration = Math.floor(Math.random() * 120) + 5; // 5 to 125 mins
        const end = new Date(start.getTime() + duration * 60000);

        instances.push({
            id: `evt-${Math.random().toString(36).substr(2, 9)}`,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            durationMinutes: duration,
        });
    }
    return instances.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

export function getMockComplianceData(timeRange: TimeRange) {
    // Generate random data for each metric
    const data: Record<ComplianceMetricType, VehicleBreachSummary[]> = {} as any;

    Object.keys(METRIC_LABELS).forEach((key) => {
        const metric = key as ComplianceMetricType;
        const vehicleCount = Math.floor(Math.random() * 8) + 1; // 1 to 9 vehicles per metric
        const vehicles = [];

        // Pick random unique vehicles
        const shuffled = [...VEHICLE_NAMES].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, vehicleCount);

        for (const vName of selected) {
            const breachCount = timeRange === '30d'
                ? Math.floor(Math.random() * 5) + 1
                : Math.floor(Math.random() * 20) + 5;

            const instances = generateInstances(breachCount, timeRange);
            const totalDuration = instances.reduce((acc, curr) => acc + curr.durationMinutes, 0);

            let severity: 'low' | 'medium' | 'high' = 'low';
            if (breachCount > 3 || totalDuration > 120) severity = 'medium';
            if (breachCount > 10 || totalDuration > 300) severity = 'high';

            vehicles.push({
                vehicleId: vName, // simpler for unique key
                vehicleName: vName,
                breachCount,
                totalDurationMinutes: totalDuration,
                severity,
                instances
            });
        }

        data[metric] = vehicles.sort((a, b) => b.breachCount - a.breachCount); // Sort by worst offender
    });

    // Calculate Summary Stats
    const allBreaches = Object.values(data).flat();
    const uniqueVehicles = new Set(allBreaches.map(v => v.vehicleName));

    // Most frequent metric type (by total count of breaches across all vehicles)
    let maxBreaches = 0;
    let mostFrequentType = 'Speed Violations';

    Object.entries(data).forEach(([type, vehicles]) => {
        const total = vehicles.reduce((sum, v) => sum + v.breachCount, 0);
        if (total > maxBreaches) {
            maxBreaches = total;
            mostFrequentType = METRIC_LABELS[type as ComplianceMetricType];
        }
    });

    // Worst offender overall (max total breaches across all categories)
    const vehicleTotals: Record<string, number> = {};
    allBreaches.forEach(v => {
        vehicleTotals[v.vehicleName] = (vehicleTotals[v.vehicleName] || 0) + v.breachCount;
    });

    let worstVehicleName = '';
    let worstCount = 0;
    Object.entries(vehicleTotals).forEach(([name, count]) => {
        if (count > worstCount) {
            worstCount = count;
            worstVehicleName = name;
        }
    });

    const summary: ComplianceSummaryStats = {
        totalNonCompliantVehicles: uniqueVehicles.size,
        mostFrequentBreachType: mostFrequentType,
        worstOffendingVehicle: {
            name: worstVehicleName,
            breachCount: worstCount,
            breachType: "Aggregate"
        }
    };

    return {
        data,
        summary
    };
}
