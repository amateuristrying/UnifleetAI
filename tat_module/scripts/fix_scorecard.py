import os

file_path = "src/components/Scorecard.tsx"

# The Clean React Code
content = r"""import { TripDetail } from '@/types/telemetry';
import { AlertTriangle, CheckCircle, Clock, Moon, Gauge, ShieldAlert, Info } from 'lucide-react';

export default function Scorecard({ data }: { data: TripDetail }) {
  const { trip } = data;

  // --- 1. THE SCORING ALGORITHM ---
  let score = 100;
  const penalties = [];

  // A. HARD SPEEDING
  if (trip.max_speed_kmh > 85) {
    const penalty = Math.min(30, (trip.max_speed_kmh - 85) * 2);
    score -= penalty;
    penalties.push({ 
      title: 'High Speed Event', 
      points: -Math.floor(penalty), 
      msg: `Max speed reached ${trip.max_speed_kmh} km/h (Limit: 85)`,
      icon: <Gauge className="text-red-500" size={16} />
    });
  }

  // B. NIGHT DRIVING
  if (trip.distance_km > 50 && trip.night_distance_km > 0) {
    const nightRatio = trip.night_distance_km / trip.distance_km;
    if (nightRatio > 0.4) {
      score -= 15;
      penalties.push({ 
        title: 'High Night Risk', 
        points: -15, 
        msg: `${(nightRatio * 100).toFixed(0)}% of travel occurred during risk hours (22:00-05:00)`,
        icon: <Moon className="text-indigo-500" size={16} />
      });
    }
  }

  // C. FATIGUE
  if (trip.duration_hours > 4.5) {
    score -= 20;
    penalties.push({ 
      title: 'Fatigue Violation', 
      points: -20, 
      msg: `Continuous operation for ${trip.duration_hours.toFixed(1)}h without detected engine-off break.`,
      icon: <Clock className="text-orange-500" size={16} />
    });
  }

  // D. SHORT TRIP
  if (trip.distance_km < 2 && trip.distance_km > 0.1) {
    score -= 10;
    penalties.push({ 
      title: 'Short Trip Strain', 
      points: -10, 
      msg: 'Micro-trip (< 2km) increases engine wear and fuel waste.',
      icon: <Info className="text-blue-500" size={16} />
    });
  }

  // E. AGGRESSIVE PACING
  if (trip.avg_speed_kmh > 0 && trip.max_speed_kmh > 0) {
    const consistency = trip.avg_speed_kmh / trip.max_speed_kmh;
    if (consistency > 0.9 && trip.max_speed_kmh > 60) {
        score -= 5;
        penalties.push({
            title: 'Aggressive Pacing',
            points: -5,
            msg: 'Average speed is very close to max speed, suggesting minimal caution.',
            icon: <ShieldAlert className="text-amber-500" size={16} />
        });
    }
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
        <p className="text-xs text-gray-400 px-4">
            Calculated based on speed, duration, and time of day.
        </p>
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
"""

try:
    with open(file_path, "w") as f:
        f.write(content)
    print(f"✅ Successfully Repaired: {file_path}")
except Exception as e:
    print(f"❌ Error: {e}")
