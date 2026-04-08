export interface TripLog {
  trip_id: string;
  tracker_id: number;

  // Naming & Brand
  tracker_name: string;
  tracker_brand: string;
  original_name_at_time: string;

  // Timing
  trip_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number;

  // Distances (Day/Night Split)
  distance_km: number;
  night_distance_km: number;
  day_distance_km: number;

  // Durations (Day/Night Split)
  night_duration_hours: number;
  day_duration_hours: number;

  // Safety
  max_speed_kmh: number;
  avg_speed_kmh: number;

  // Location
  start_geom: any;
  end_geom: any;
  route_geom?: any; // Added for route path
  start_address: string | null;
  end_address: string | null;

  // New Calculated Insights
  fatigue_score: number;
  volatility_factor: number;
  crow_flight_ratio: number;
  co2_emissions_kg: number;
  trip_grade: number;
}

export interface TripDetail {
  trip: TripLog;
}

export interface Vehicle {
  tracker_id: number;
  tracker_name: string;
  tracker_brand: string;
}
