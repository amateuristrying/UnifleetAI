import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SecurityMap from '@/components/maps/SecurityMap';
import HubMap from '@/components/maps/HubMap';
import EfficiencyMap from '@/components/maps/EfficiencyMap';
import TripTable from '@/components/TripTable';
import type { Vehicle, TripLog } from '@/types/telemetry';
import { NavixyService } from '@/services/navixy';
import { useOps } from '@/context/OpsContext';
import { supabase } from '@/lib/supabase';
import { List, Activity, ShieldAlert, Zap, ArrowLeft } from 'lucide-react';

export default function CorridorAnalytics() {
    const navigate = useNavigate();
    const { ops, setOps } = useOps();
    const sessionKey = ops === 'zambia'
        ? import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM
        : import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ;

    const [viewMode, setViewMode] = useState<'list' | 'heat' | 'security' | 'efficiency'>('security');

    const [dateRange] = useState({
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString()
    });
    const [filters] = useState({ brands: [], vehicles: [] });
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);

    const [trips, setTrips] = useState<TripLog[]>([]);
    const [hubData, setHubData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!sessionKey) return;
        const fetchVehicles = async () => {
            try {
                const list = await NavixyService.listTrackers(sessionKey);
                if (list && Array.isArray(list)) {
                    const mapped: Vehicle[] = list.map((t: any) => ({
                        tracker_id: t.id,
                        tracker_name: t.label || t.name || `Vehicle ${t.id}`,
                        tracker_brand: t.source?.vehicle_type_id || 'Unknown'
                    }));
                    setVehicles(mapped);
                }
            } catch (err) {
                console.error("Failed to fetch vehicles for analytics", err);
            }
        };
        fetchVehicles();
    }, [sessionKey]);

    const fetchViewData = useCallback(async (mode: 'list' | 'heat') => {
        setLoading(true);
        try {
            if (mode === 'list') {
                const { data, error } = await supabase
                    .from('v_ai_trip_logs')
                    .select('*')
                    .order('start_time', { ascending: false })
                    .range(0, 50);

                if (!error && data) {
                    setTrips(data as TripLog[]);
                }
            } else if (mode === 'heat') {
                const { data, error } = await supabase.rpc('get_hub_analysis', {
                    start_date_input: dateRange.start || null,
                    end_date_input: dateRange.end || null,
                    brand_filter: null,
                    vehicle_filter: null
                });
                if (!error && data) {
                    setHubData(data as any[]);
                }
            }
        } catch (err) {
            console.error("View Fetch Error:", err);
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        if (viewMode === 'list' || viewMode === 'heat') {
            fetchViewData(viewMode);
        }
    }, [viewMode, fetchViewData]);

    return (
        <div className="flex flex-col flex-1 min-h-0 bg-surface-main p-8 gap-6 overflow-hidden">
            <div className="flex-1 flex flex-col bg-surface-card border border-border rounded-3xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-card shrink-0 z-10">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/analytics')}
                            className="p-2 rounded-xl bg-muted hover:bg-surface-raised border border-transparent hover:border-border text-muted-foreground hover:text-foreground transition-all flex items-center justify-center shrink-0"
                            title="Back to Analytics"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <h2 className="text-xl font-black text-foreground flex items-center gap-2 uppercase tracking-wide">
                            {viewMode === 'list' && <List size={22} className="text-primary" />}
                            {viewMode === 'heat' && <Activity size={22} className="text-red-500" />}
                            {viewMode === 'security' && <ShieldAlert size={22} className="text-red-600" />}
                            {viewMode === 'efficiency' && <Zap size={22} className="text-amber-500" />}

                            {viewMode === 'list' && 'Recent Logs'}
                            {viewMode === 'heat' && 'Heatmap'}
                            {viewMode === 'security' && 'Security'}
                            {viewMode === 'efficiency' && 'Efficiency'}
                        </h2>

                        <div className="h-5 w-px bg-border mx-2"></div>

                        <div className="flex items-center gap-1 bg-muted rounded-full p-1 border border-border overflow-hidden">
                            <button
                                onClick={() => setOps('tanzania')}
                                className={`px-4 py-1 text-[10px] font-black uppercase rounded-full transition-all tracking-wider ${ops === 'tanzania'
                                    ? 'bg-surface-raised text-primary shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                TZ OPS
                            </button>
                            <button
                                onClick={() => setOps('zambia')}
                                className={`px-4 py-1 text-[10px] font-black uppercase rounded-full transition-all tracking-wider ${ops === 'zambia'
                                    ? 'bg-surface-raised text-emerald-600 shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                ZM OPS
                            </button>
                        </div>
                    </div>

                    <div className="flex bg-muted p-1 rounded-xl border border-border shadow-inner">
                        <button
                            onClick={() => setViewMode('list')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'list' ? 'bg-surface-raised text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            List
                        </button>
                        <button
                            onClick={() => setViewMode('heat')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'heat' ? 'bg-surface-raised text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Heatmap
                        </button>
                        <button
                            onClick={() => setViewMode('security')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'security' ? 'bg-surface-raised text-red-600 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Security
                        </button>
                        <button
                            onClick={() => setViewMode('efficiency')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'efficiency' ? 'bg-surface-raised text-amber-500 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Efficiency
                        </button>
                    </div>
                </div>

                {/* Map/List Content Area */}
                <div className="flex-1 p-4 bg-surface-card overflow-hidden">
                    <div className="h-full w-full relative rounded-2xl overflow-hidden shadow-sm border border-border bg-surface-main">
                        {viewMode === 'security' && (
                            <SecurityMap
                                dateRange={dateRange}
                                filters={filters}
                                vehicles={vehicles}
                                sessionKey={sessionKey}
                            />
                        )}
                        {viewMode === 'efficiency' && (
                            <EfficiencyMap
                                dateRange={dateRange}
                                filters={filters}
                                vehicles={vehicles}
                                sessionKey={sessionKey}
                            />
                        )}
                        {viewMode === 'heat' && (
                            <div className="h-full w-full bg-background">
                                {loading && hubData.length === 0 ? (
                                    <div className="flex h-full items-center justify-center bg-background/50">
                                        <span className="text-muted-foreground">Loading Heatmap...</span>
                                    </div>
                                ) : (
                                    <HubMap data={hubData} />
                                )}
                            </div>
                        )}
                        {viewMode === 'list' && (
                            <div className="h-full w-full overflow-y-auto p-4 max-w-7xl mx-auto bg-surface-main">
                                {loading && trips.length === 0 ? (
                                    <div className="flex h-64 items-center justify-center">
                                        <span className="text-muted-foreground">Loading Trips...</span>
                                    </div>
                                ) : (
                                    <TripTable trips={trips} />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
