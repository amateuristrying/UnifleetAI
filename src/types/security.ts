// ============================================================
// Route Security Analysis Types
// ============================================================

export type SeverityLevel = 'CRITICAL' | 'WARNING' | 'MINOR';

export interface StopEvent {
    lat: number;
    lng: number;
    duration_mins: number;
    // Timestamps (ISO) for accurate risk analysis (Night detection)
    startTime?: string;
    endTime?: string;
    isAuthorized?: boolean;
    zoneId?: number;
    zoneLabel?: string;
}

/**
 * Expanded analysis result from RouteAnomaliesMap.
 * Includes geometry data for persistence alongside the summary metrics.
 */
export interface RouteAnalysisResult {
    proposedKm: number;
    actualKm: number;
    deviationKm: number;
    unauthorizedStops: number;
    routeBreaches: number;
    deviationSegments: GeoJSON.FeatureCollection | null;
    stopEvents: StopEvent[];
    // New Visualization Fields
    terrainType?: 'FLAT' | 'HILLY' | 'WINDING';
    sinuosity?: number;
    avgSpeedCurrent?: number;
    speedLimitSegments?: GeoJSON.FeatureCollection<GeoJSON.LineString>;
    speedLimitPoints?: GeoJSON.FeatureCollection<GeoJSON.Point>;
    // New Risk Scoring
    riskScore?: number; // 0-100
    riskReasons?: string[]; // ["STOP_IN_RISK_ZONE", "NIGHT_DRIVING"]
}

/**
 * Payload sent from client to POST /api/security/analysis.
 */
export interface SecurityAnalysisPayload {
    trip_id: string;
    tracker_id: number;
    tracker_name: string;
    proposed_km: number;
    actual_km: number;
    deviation_km: number;
    deviation_severity_ratio: number;
    severity_level: SeverityLevel;
    route_breaches: number;
    unauthorized_stops: number;
    deviation_segments: GeoJSON.FeatureCollection | null;
    stop_events: StopEvent[];
    risk_score?: number;
    risk_reasons?: string[];
}

/**
 * A row from the route_security_events table.
 */
export interface SecurityEventRecord extends SecurityAnalysisPayload {
    id: number;
    analyzed_at: string;
    created_at: string;
    updated_at: string;
}

/**
 * A point returned by the get_security_hotspots RPC.
 */
export interface SecurityHotspot {
    trip_id: string;
    tracker_id: number;
    tracker_name: string;
    severity_level: SeverityLevel;
    point_type: 'deviation_centroid' | 'unauthorized_stop';
    lat: number;
    lng: number;
    deviation_km: number;
    duration_mins: number | null;
    analyzed_at: string;
}

// ============================================================
// Stop-Level Security Analysis Types (Between-Trip)
// ============================================================

/** Row from the Supabase `stops` table */
export interface StopRecord {
    id: string;
    tracker_id: number;
    tracker_name: string | null;
    start_time: string;
    end_time: string | null;
    duration_seconds: number | null;
    lat: number | null;
    lng: number | null;
    address: string | null;
    trip_date: string | null;
    ignition_on_seconds: number | null;
    ignition_on_percent: number | null;
}

/** Behavioural profile for a single vehicle, computed from historical stops */
export interface VehicleStopProfile {
    trackerId: number;
    medianDurationSeconds: number;
    nightMedianDurationSeconds: number;
    frequentLocations: Array<{
        lat: number;
        lng: number;
        count: number;
    }>;
}

/** Adjacent trip context for position-mismatch / short-trip detection */
export interface AdjacentTrips {
    prevTrip?: {
        trip_id: string;
        end_time: string;
        end_lat: number;
        end_lng: number;
        distance_km: number;
        duration_hours: number;
    };
    nextTrip?: {
        trip_id: string;
        start_time: string;
        start_lat: number;
        start_lng: number;
    };
}

/** Result of scoring a single stop */
export interface StopRiskResult {
    stopId: string;
    trackerId: number;
    trackerName: string | null;
    riskScore: number;               // 0-100
    severityLevel: SeverityLevel;
    riskReasons: string[];           // Explainable reason codes

    // Location & time context
    stopLat: number;
    stopLng: number;
    stopStart: string;
    stopEnd: string | null;
    stopDurationHours: number;
    h3Index: string;

    // Signal flags (every flag is persisted for explainability)
    isNightStop: boolean;
    isInRiskZone: boolean;
    riskZoneH3: string | null;
    isInSafeZone: boolean;
    safeZoneName: string | null;
    isIgnitionAnomaly: boolean;
    ignitionOnPercent: number;
    isLongDuration: boolean;
    isPositionMismatch: boolean;
    positionMismatchKm: number | null;
    isRepeatLocation: boolean;
    repeatCount: number;
    isUnusualLocation: boolean;
    nearestHistoricalKm: number | null;
    isShortPrecedingTrip: boolean;
    isRemoteHighway: boolean;
    corridorAvgSpeed: number | null;
    prevTripId?: string;
    nextTripId?: string;
}

/** H3 hex with aggregated risk score (from multiple scored stops) */
export interface RiskZoneHex {
    h3Index: string;
    h3Resolution: number;
    riskScore: number;
    incidentCount: number;
    criticalCount: number;
    warningCount: number;
    nightIncidentCount: number;
    dayIncidentCount: number;
    reasonDistribution: Record<string, number>;
    centerLat: number;
    centerLng: number;
    boundaryGeojson: GeoJSON.Polygon;
}

/** DBSCAN cluster of adjacent high-risk hexes → actionable risk polygon */
export interface RiskZoneCluster {
    clusterId: number;
    riskScore: number;
    hexCount: number;
    incidentCount: number;
    polygonGeojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    centerLat: number;
    centerLng: number;
    isNightDominant: boolean;
    primaryReason: string;
    reasonDistribution: Record<string, number>;
}
