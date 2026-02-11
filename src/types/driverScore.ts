export interface Trip {
    id: number;
    tracker_id: number;
    tracker_name: string;
    start_time: string;
    end_time: string;
    trip_date: string;
    distance_km: number;
    duration_seconds: number;
    year: number;
    month: number;
}

export interface Stop {
    id: number;
    tracker_id: number;
    start_time: string;
    end_time: string;
    duration_seconds: number;
    trip_date: string;
    year: number;
    month: number;
}

export interface EngineHours {
    id: number;
    tracker_id: number;
    tracker_name: string;
    report_date: string;
    duration_seconds: number;
    in_movement_seconds: number;
    idle_seconds: number;
    mileage_km: number;
    year: number;
    month: number;
}

export interface SpeedViolation {
    id: number;
    tracker_id: number;
    tracker_name: string;
    start_time: string;
    duration_seconds: number;
    avg_speed: number;
    max_speed: number;
    trip_date: string;
    year: number;
    month: number;
}

export interface DailyScore {
    date: string;
    isNoTaskDay: boolean;
    speedTaskPassed: boolean;
    distanceTaskPassed: boolean; // > 50km
    idlingTaskPassed: boolean;   // < 30m idle
    speedViolationsCount: number;
    durationSeconds: number;
    distanceKm: number;
    idleSeconds: number;
    pointsDeducted: number;
    pointsAdded: number;
}

export interface VehicleScore {
    trackerId: number;
    vehicleName: string;
    rank: number;
    totalScore: number;
    tripCount: number;
    totalDistanceKm: number;
    totalDurationSeconds: number;
    totalIdleSeconds: number;
    violationCount: number;
    dailyScores: DailyScore[];
    baseScore: number;
}
