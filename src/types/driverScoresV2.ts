export interface DriverScoreVehicleSummary {
  tracker_id: string;
  tracker_name: string;
  ops_region: string;
  latest_score_date: string;
  latest_score: number | null;
  latest_risk_bucket: string;
  latest_top_issues: string[] | null;
  speed_score: number | null;
  idle_score: number | null;
  night_score: number | null;
  fatigue_score: number | null;
  score_components: Record<string, any> | null;
  avg_score_7d: number | null;
  active_days_7d: number;
  total_violations_7d: number;
  avg_score_30d: number | null;
  active_days_30d: number;
  total_violations_30d: number;
  avg_idle_pct_30d: number | null;
  total_night_trips_30d: number | null;
  total_distance_30d: number | null;
  critical_days_30d: number;
  high_days_30d: number;
  score_trend: 'up' | 'down' | 'stable' | null;
  latest_status: 'neutral' | 'green' | 'yellow' | 'red';
  ui_bucket: 'Critical' | 'Watchlist' | 'Stable' | 'Inactive';
}

export interface VehicleScoreCalendarDay {
  score_date: string;
  score: number | null;
  status: 'neutral' | 'green' | 'yellow' | 'red';
  risk_bucket: string;
  is_active_day: boolean;
  total_distance_km: number;
  total_trips: number;
  speeding_count: number;
  top_issues: string[] | null;
}

export interface VehicleScoreDayDetail {
  tracker_name: string;
  ops_region: string;
  score_date: string;
  score: number | null;
  status: 'neutral' | 'green' | 'yellow' | 'red';
  risk_bucket: string;
  is_active_day: boolean;
  top_issues: string[] | null;
  score_components: Record<string, number> | null;
  total_trips: number;
  total_distance_km: number;
  total_driving_seconds: number;
  speeding_count: number;
  speeding_duration_secs: number;
  max_speed_recorded: number;
  speed_score: number | null;
  idle_minutes: number;
  idle_percent: number;
  idle_score: number | null;
  night_trips: number;
  night_driving_km: number;
  night_score: number | null;
  fatigue_level: string;
  fatigue_score: number | null;
  route_score: number | null;
  total_engine_seconds: number;
}
