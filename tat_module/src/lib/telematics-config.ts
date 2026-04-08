export const SCORING_THRESHOLDS = {
    SPEED: {
        HARD_LIMIT_KMH: 85,
        PENALTY_PER_KMH: 2,
        MAX_PENALTY: 30,
    },
    NIGHT_DRIVING: {
        MIN_TRIP_DISTANCE_KM: 50,
        RISK_RATIO: 0.4,
        PENALTY_POINTS: 15,
    },
    FATIGUE: {
        MAX_DURATION_HOURS: 4.5,
        SCORE_THRESHOLD: 50,
        BASE_PENALTY: 20,
        FACTOR: 0.2, // multiplier for fatigue score
    },
    VOLATILITY: {
        FACTOR_LIMIT: 2.0,
        SPEED_RATIO_LIMIT: 2.0,
        PENALTY_POINTS: 10,
    },
    EFFICIENCY: {
        PROPOSED_RATIO_LIMIT: 1.15, // Ratio of Actual vs Proposed (Mapbox)
        PENALTY_POINTS: 10,
    },
    SHORT_TRIP: {
        MAX_DISTANCE_KM: 2,
        MIN_DISTANCE_KM: 0.1,
    },
    ROUTE_DEVIATION: {
        // Base Tolerances (Adaptive Engine)
        TOLERANCE: {
            HIGHWAY_METERS: 25,   // Speed >= 80km/h
            ARTERIAL_METERS: 40,  // 50 <= Speed < 80km/h
            CITY_METERS: 60,      // Speed < 50km/h
            DEFAULT_METERS: 50,    // Fallback
        },
        // Multipliers
        MULTIPLIERS: {
            POOR_SIGNAL: 1.5,     // Satellites < 4
            DIFFICULT_TERRAIN: 1.5, // Sinuosity > 1.4 or Grade > 6%
            HIGH_SPEED_GOOD_GPS: 0.8, // Speed > 100km/h + Good Signal
        },
        MIN_DEVIATION_LENGTH_METERS: 100, // Minimum segment to count as deviation
        TIME_THRESHOLD_SECONDS: 120, // Blueprint: Must be off-road for > 120s to count
        DISCOVERY_THRESHOLD: 1.15, // Flag trips > 15% longer than proposed route
        STATIONARY_THRESHOLD_MINUTES: 5, // Dwell time off-route to trigger theft alert
        STATIONARY_MAX_SPEED_KMH: 5, // Speed below which vehicle is considered stationary
    },
    RISK_SCORING: {
        // Point system (0-100)
        WEIGHTS: {
            KNOWN_HOTSPOT_STOP: 30,
            UNAUTHORIZED_STOP: 20, // > 15 mins
            SUSTAINED_DEVIATION: 30, // > 5km OR > 10 mins
            NIGHT_DRIVING: 20,
            REPEAT_OFFENDER: 15,
            REMOTE_HIGHWAY_STOP: 40,
        },
        THRESHOLDS: {
            CRITICAL: 70,
            WARNING: 40,
            REMOTE_HIGHWAY_SPEED_THRESHOLD: 60, // km/h (avg corridor speed)
            REMOTE_STOP_MIN_DURATION_MINUTES: 5,
            REMOTE_STOP_MAX_DURATION_MINUTES: 60,
        }
    },

    // ──────────────────────────────────────────────────────────
    // STOP-LEVEL RISK SCORING (Between-Trip Analysis)
    // Analyses stops from the dedicated `stops` table, not in-trip GPS noise.
    // ──────────────────────────────────────────────────────────
    STOP_RISK: {
        WEIGHTS: {
            NIGHT_OUTSIDE_SAFE: 25,       // Night stop (22:00-05:00) outside any safe zone
            IN_RISK_ZONE: 30,             // Stop inside a known high-risk H3 hex
            LONG_DURATION: 20,            // Abnormally long stop (> threshold or > Nx vehicle median)
            IGNITION_ANOMALY: 25,         // Engine running >30% of a long stop (fuel theft / unauthorized use)
            POSITION_MISMATCH: 40,        // Vehicle moved between stop end & next trip start (tow risk)
            REPEAT_SUSPICIOUS: 15,        // Recurring stop at non-standard, non-safe location
            UNUSUAL_LOCATION_NIGHT: 20,   // First-time location + night = elevated risk
            SHORT_PRECEDING_TRIP: 15,     // Very short trip before this stop (unauthorized side trip)
            REMOTE_HIGHWAY_STOP: 40,      // Suspected fuel theft in remote terrain
        },
        THRESHOLDS: {
            CRITICAL: 70,
            WARNING: 40,
            MIN_STOP_DURATION_MINUTES: 15,       // Don't analyse stops < 15 min
            LONG_DURATION_HOURS: 4,              // Stops > 4 h during working hours flagged
            ABNORMAL_DURATION_MULTIPLIER: 3,     // > 3× vehicle median = abnormal
            IGNITION_ANOMALY_PERCENT: 30,        // Engine on > 30% of stop → anomaly
            POSITION_MISMATCH_KM: 0.5,           // > 500 m gap = potential tow
            REPEAT_LOCATION_MIN_COUNT: 3,        // 3+ visits to same non-safe location
            UNUSUAL_LOCATION_KM: 50,             // > 50 km from any historical stop cluster
            SHORT_TRIP_KM: 2,                    // Preceding trip < 2 km = suspicious
            SHORT_TRIP_MINUTES: 5,               // Preceding trip < 5 min = suspicious
            REMOTE_HIGHWAY_SPEED_THRESHOLD: 60, // km/h (avg corridor speed)
            REMOTE_STOP_MIN_DURATION_MINUTES: 5,
            REMOTE_STOP_MAX_DURATION_MINUTES: 60,
        },
        H3: {
            RESOLUTION: 7,                       // ~5.16 km² cells (~1.2 km edge)
            MIN_INCIDENTS_FOR_HOTSPOT: 3,        // Min scored events in cell to qualify
            ROLLING_WINDOW_DAYS: 90,             // Aggregate over 90-day window
            DBSCAN_RADIUS_KM: 5,                 // Cluster search radius
            DBSCAN_MIN_POINTS: 2,                // Min hexes per cluster
        }
    },

    // ──────────────────────────────────────────────────────────
    // CORRIDOR INTELLIGENCE (Route Learning & Baseline)
    // ──────────────────────────────────────────────────────────
    CORRIDOR: {
        DECAY_LAMBDA: 0.01,                // Exponential decay rate; e^(-0.01 * days) ≈ 69-day half-life
        MATURITY_THRESHOLD: 3,             // Min effective_visits before a cell is trusted as corridor
        NEIGHBOR_TOLERANCE_RING: 1,        // gridDisk radius for GPS-drift compensation (1-ring = 6 neighbors)
        H3_RESOLUTION: 9,                  // ~174 m edge length — corridor cell size
        HOUR_BUCKET_SIZE: 4,               // 4-hour windows (0-3, 4-7, 8-11, 12-15, 16-19, 20-23)
        TEMPORAL_MISMATCH_PENALTY: 15,     // Penalty when spatially valid corridor used at unusual time
        BEARING_BUCKETS: 8,                // N/NE/E/SE/S/SW/W/NW — 45° sectors
        BEARING_MISMATCH_PENALTY: 10,      // Penalty for wrong direction on a corridor
    },

    // ──────────────────────────────────────────────────────────
    // CIRCLE GEOFENCE CONVERSION
    // ──────────────────────────────────────────────────────────
    CIRCLE_GEOFENCE: {
        POLYGON_STEPS: 64,                 // Vertices for circle → polygon approximation
    },
};
