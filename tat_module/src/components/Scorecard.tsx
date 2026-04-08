import { TripDetail } from '@/types/telemetry';
import type { RouteAnalysisResult } from '@/types/security';
import { AlertTriangle, CheckCircle, Clock, Moon, Gauge, ShieldAlert, Info, Leaf, Map } from 'lucide-react';
import { SCORING_THRESHOLDS } from '@/lib/telematics-config';

export default function Scorecard({
  data,
  analysisResults
}: {
  data: TripDetail,
  analysisResults: RouteAnalysisResult | null
}) {
  const { trip } = data;

  // --- 1. THE SCORING ALGORITHM ---
  // Prefer server-side grade if available, otherwise calculate it
  let score = trip.trip_grade ?? 100; // Default to DB score if present
  const penalties = [];

  // If DB score is missing (legacy), calculating basic penalties for display
  // We'll still generate the "Penalties List" for UI feedback regardless of where the score number comes from.

  // A. HARD SPEEDING
  if (trip.max_speed_kmh > SCORING_THRESHOLDS.SPEED.HARD_LIMIT_KMH) {
    const penalty = Math.min(
      SCORING_THRESHOLDS.SPEED.MAX_PENALTY,
      (trip.max_speed_kmh - SCORING_THRESHOLDS.SPEED.HARD_LIMIT_KMH) * SCORING_THRESHOLDS.SPEED.PENALTY_PER_KMH
    );
    // score -= penalty; // Already in DB score
    penalties.push({
      title: 'High Speed Event',
      points: -Math.floor(penalty),
      msg: `Max speed reached ${trip.max_speed_kmh} km/h (Limit: ${SCORING_THRESHOLDS.SPEED.HARD_LIMIT_KMH})`,
      icon: <Gauge className="text-red-500" size={16} />
    });
  }

  // B. NIGHT DRIVING
  if (trip.distance_km > SCORING_THRESHOLDS.NIGHT_DRIVING.MIN_TRIP_DISTANCE_KM && trip.night_distance_km > 0) {
    const nightRatio = trip.night_distance_km / trip.distance_km;
    if (nightRatio > SCORING_THRESHOLDS.NIGHT_DRIVING.RISK_RATIO) {
      penalties.push({
        title: 'High Night Risk',
        points: -SCORING_THRESHOLDS.NIGHT_DRIVING.PENALTY_POINTS,
        msg: `${(nightRatio * 100).toFixed(0)}% of travel occurred during risk hours (22:00-05:00)`,
        icon: <Moon className="text-indigo-500" size={16} />
      });
    }
  }

  // C. FATIGUE
  // Use server-side fatigue score if available
  if ((trip.fatigue_score && trip.fatigue_score > SCORING_THRESHOLDS.FATIGUE.SCORE_THRESHOLD) || trip.duration_hours > SCORING_THRESHOLDS.FATIGUE.MAX_DURATION_HOURS) {
    const pts = trip.fatigue_score
      ? Math.floor(trip.fatigue_score * SCORING_THRESHOLDS.FATIGUE.FACTOR)
      : SCORING_THRESHOLDS.FATIGUE.BASE_PENALTY;

    penalties.push({
      title: 'Fatigue Violation',
      points: -pts,
      msg: `Continuous operation for ${trip.duration_hours.toFixed(1)}h. Fatigue Score: ${trip.fatigue_score ?? 'High'}`,
      icon: <Clock className="text-orange-500" size={16} />
    });
  }

  // D. VOLATILITY (Aggressive Pacing)
  if (trip.volatility_factor > SCORING_THRESHOLDS.VOLATILITY.FACTOR_LIMIT ||
    (trip.avg_speed_kmh > 0 && trip.max_speed_kmh / trip.avg_speed_kmh > SCORING_THRESHOLDS.VOLATILITY.SPEED_RATIO_LIMIT)) {
    penalties.push({
      title: 'High Volatility',
      points: -SCORING_THRESHOLDS.VOLATILITY.PENALTY_POINTS,
      msg: `Erratic driving detected. Max speed is ${trip.volatility_factor}x higher than average speed.`,
      icon: <ShieldAlert className="text-amber-500" size={16} />
    });
  }

  // E. ROUTE EFFICIENCY (DEVIATION)
  const efficiencyRatio = analysisResults
    ? analysisResults.actualKm / analysisResults.proposedKm
    : (trip.crow_flight_ratio || 1.0);

  const limit = analysisResults
    ? SCORING_THRESHOLDS.EFFICIENCY.PROPOSED_RATIO_LIMIT
    : 1.4; // Legacy crow flight fallback

  if (efficiencyRatio > limit) {
    const penaltyValue = SCORING_THRESHOLDS.EFFICIENCY.PENALTY_POINTS;
    penalties.push({
      title: 'Route Deviation',
      points: -penaltyValue,
      msg: analysisResults
        ? `Trip was ${(efficiencyRatio * 100 - 100).toFixed(0)}% longer than the proposed optimal route.`
        : `Significant deviation detected. Actual distance is ${efficiencyRatio.toFixed(2)}x the direct path.`,
      icon: <Map className="text-purple-500" size={16} />
    });
  }

  // E1. ROUTE BREACH (Persistent Tracking)
  if (analysisResults && analysisResults.routeBreaches > 0) {
    penalties.push({
      title: 'Route Integrity Breach',
      points: 0, // Advisory, but counted
      msg: `${analysisResults.routeBreaches} path integrity infraction(s) detected. Vehicle exited the 10m buffer throughout the trip.`,
      icon: <Map className="text-orange-500" size={16} />
    });
  }

  // E2. UNAUTHORIZED STOP (THEFT RISK)
  if (analysisResults && analysisResults.unauthorizedStops > 0) {
    const isRemote = analysisResults.riskReasons?.some(r => r.includes('REMOTE_HIGHWAY_STOP'));
    const stopPenalty = 25; // Severe penalty for suspicious stop

    const siteMsg = isRemote
      ? 'High-risk stop on remote highway corridor. Suspected fuel theft or cartel blockade.'
      : 'Stationary event(s) detected in unauthorized areas (>5 mins off-route). Possible fuel theft site.';

    penalties.push({
      title: isRemote ? 'Remote Highway Stop' : 'Unauthorized Stop (High Risk)',
      points: -stopPenalty,
      msg: `${analysisResults.unauthorizedStops} event(s): ${siteMsg}`,
      icon: <AlertTriangle className={`${isRemote ? 'text-red-700' : 'text-red-600'}`} size={16} />
    });
  }

  // F. SHORT TRIP (Legacy check)
  if (trip.distance_km < SCORING_THRESHOLDS.SHORT_TRIP.MAX_DISTANCE_KM && trip.distance_km > SCORING_THRESHOLDS.SHORT_TRIP.MIN_DISTANCE_KM) {
    // Advisory warning only - does not affect score
    penalties.push({
      title: 'Short Trip Strain',
      points: 0, // Advisory
      msg: 'Micro-trip (< 2km) increases engine wear and fuel waste.',
      icon: <Info className="text-blue-500" size={16} />
    });
  }

  score = Math.max(0, Math.floor(score));

  // Visuals
  let scoreColor = 'text-green-600';
  let grade = 'A';
  if (score < 90) { scoreColor = 'text-blue-600'; grade = 'B'; }
  if (score < 80) { scoreColor = 'text-yellow-600'; grade = 'C'; }
  if (score < 60) { scoreColor = 'text-red-600'; grade = 'D'; }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* LEFT: THE SCORECARD */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col items-center justify-start text-center">
        <h3 className="text-gray-400 uppercase text-xs font-bold tracking-wider mb-6">Trip Performance Grade</h3>

        <div className="relative flex items-center justify-center mb-4">
          <div className={`w-32 h-32 rounded-full border-8 opacity-20 ${score >= 90 ? 'border-green-500' : score >= 60 ? 'border-yellow-500' : 'border-red-500'}`}></div>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-5xl font-black ${scoreColor}`}>{score}</span>
            <span className="text-sm font-bold text-gray-400 mt-1">/ 100</span>
          </div>
        </div>

        <div className={`text-xl font-bold ${scoreColor} mb-2`}>Grade {grade}</div>

        {/* Environmental Stats */}
        <div className="mt-4 w-full grid grid-cols-2 gap-2 text-xs border-t border-gray-100 pt-4">
          <div className="flex flex-col items-center">
            <Leaf className="text-green-500 mb-1" size={16} />
            <span className="font-bold text-gray-700">{trip.co2_emissions_kg ?? '-'} kg</span>
            <span className="text-gray-400">CO2 Emit</span>
          </div>
          <div className="flex flex-col items-center">
            <Map className="text-blue-500 mb-1" size={16} />
            <span className="font-bold text-gray-700">{efficiencyRatio.toFixed(2)}x</span>
            <span className="text-gray-400">{analysisResults ? 'Route Integrity' : 'Crow Eff.'}</span>
          </div>
        </div>
      </div>

      {/* CENTER & RIGHT: ANALYSIS */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm h-full">
          <h3 className="text-gray-900 font-bold mb-4 flex items-center gap-2">
            <div className="w-1 h-6 bg-blue-600 rounded-full"></div>
            Performance Analysis
          </h3>

          {penalties.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-green-700 bg-green-50 rounded-lg border border-green-100">
              <CheckCircle size={32} className="mb-2" />
              <p className="font-semibold">Excellent Driving!</p>
              <p className="text-sm opacity-80">This trip meets all industry safety standards.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {penalties.map((p, i) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100 transition-all hover:bg-white hover:shadow-md hover:border-gray-200">
                  <div className="mt-1 bg-white p-2 rounded-full shadow-sm border border-gray-100">
                    {p.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <h4 className="font-bold text-gray-800 text-sm">{p.title}</h4>
                      <span className="text-red-600 text-xs font-mono font-bold bg-red-50 px-2 py-1 rounded">{p.points} pts</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{p.msg}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
