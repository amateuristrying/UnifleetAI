import { Truck, Activity, Moon, ShieldAlert } from 'lucide-react';

interface Stats {
  total_trips: number;
  total_distance_km: number;
  total_night_km: number;
  avg_speed_kmh: number;
  low_compliance_trips?: number;
}

export default function SummaryCards({ stats }: { stats: Stats }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm h-32 animate-pulse"></div>
        ))}
      </div>
    );
  }

  const {
    total_trips = 0,
    total_distance_km = 0,
    total_night_km = 0,
    avg_speed_kmh = 0
  } = stats;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Trips</p><h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.total_trips.toLocaleString()}</h3></div>
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Truck size={20} /></div>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Distance</p><h3 className="text-3xl font-bold text-gray-900 mt-2">{Math.round(stats.total_distance_km).toLocaleString()} <span className="text-base font-normal text-gray-400">km</span></h3></div>
        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Activity size={20} /></div>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Night Driving</p><h3 className="text-3xl font-bold text-indigo-900 mt-2">{Math.round(stats.total_night_km).toLocaleString()} <span className="text-base font-normal text-gray-400">km</span></h3></div>
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Moon size={20} /></div>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Route Integrity</p>
          <h3 className={`text-3xl font-bold mt-2 ${stats.low_compliance_trips && stats.low_compliance_trips > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {stats.low_compliance_trips || 0} <span className="text-base font-normal text-gray-400">Alerts</span>
          </h3>
        </div>
        <div className={`p-2 rounded-lg ${stats.low_compliance_trips && stats.low_compliance_trips > 0 ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-emerald-50 text-emerald-600'}`}>
          <ShieldAlert size={20} />
        </div>
      </div>
    </div>
  );
}
