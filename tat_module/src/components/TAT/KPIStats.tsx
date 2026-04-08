import { Clock, AlertTriangle, CheckCircle, MapPin } from 'lucide-react';

interface KPIStatsProps {
    stats: {
        avg_waiting_hrs: number;
        avg_transit_to_load_hrs: number;
        avg_loading_hrs: number;
        avg_border_hrs: number;
        avg_offloading_hrs: number;
        trip_completion_rate: number;
        trips_departed: number;
        trips_completed: number;
    } | null;
    loading: boolean;
    onTripCompletionClick?: () => void;
}

export function KPIStats({ stats, loading, onTripCompletionClick }: KPIStatsProps) {
    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-32 bg-gray-900/50 animate-pulse rounded-xl" />
                ))}
            </div>
        );
    }

    if (!stats) return null;

    const dwellCards = [
        { label: 'Waiting for Orders', val: stats.avg_waiting_hrs, icon: Clock, color: 'text-gray-400', bg: 'bg-gray-500/10', sub: 'Dar Geofence Dwell' },
        { label: 'Transit to Load', val: stats.avg_transit_to_load_hrs, icon: MapPin, color: 'text-blue-400', bg: 'bg-blue-500/10', sub: 'Dar Exit → Tanga/Mtwara' },
        { label: 'Loading Ops', val: stats.avg_loading_hrs, icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-500/10', sub: 'Kurasini In → Out' },
        { label: 'Avg Border Dwell', val: stats.avg_border_hrs, icon: MapPin, color: 'text-yellow-500', bg: 'bg-yellow-500/10', sub: 'All Borders Combined' },
        { label: 'Offloading Dwell', val: stats.avg_offloading_hrs, icon: CheckCircle, color: 'text-purple-500', bg: 'bg-purple-500/10', sub: 'At Destination Yard' },
    ];

    return (
        <div className="space-y-6 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {dwellCards.map((c, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 p-5 rounded-xl flex items-center space-x-4">
                        <div className={`p-3 ${c.bg} rounded-lg`}>
                            <c.icon className={`w-6 h-6 ${c.color}`} />
                        </div>
                        <div>
                            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{c.label}</p>
                            <div className="flex items-baseline space-x-2">
                                <h3 className="text-xl font-bold text-white">{c.val} h</h3>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">{c.sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                    onClick={onTripCompletionClick}
                    className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center space-x-4 hover:border-emerald-500/50 transition-colors text-left w-full group overflow-hidden relative"
                >
                    <div className="p-3 bg-emerald-500/10 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
                        <CheckCircle className="w-8 h-8 text-emerald-500" />
                    </div>
                    <div>
                        <p className="text-gray-400 text-sm font-medium">Trip Completion Rate</p>
                        <div className="flex items-baseline space-x-2">
                            <h3 className="text-2xl font-bold text-white">{stats.trip_completion_rate}%</h3>
                            <span className="text-xs text-gray-500">
                                {stats.trips_completed}/{stats.trips_departed} trips
                            </span>
                        </div>
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] text-emerald-400 font-bold px-2 py-1 bg-emerald-500/10 rounded">VIEW DETAILS &rarr;</span>
                    </div>
                </button>
            </div>
        </div>
    );
}
