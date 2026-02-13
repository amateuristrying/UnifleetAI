import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { KPIStats } from './KPIStats';
import { BorderChart } from './BorderChart';
import { TripCompletionModal } from './TripCompletionModal';
import { subDays } from 'date-fns';
import { RefreshCcw, Filter } from 'lucide-react';

export function TATDashboard() {
    const [dateRange, setDateRange] = useState({
        start: subDays(new Date(), 30),
        end: new Date()
    });
    const [selectedDestination, setSelectedDestination] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Data States
    const [stats, setStats] = useState<any>(null);
    const [borderData, setBorderData] = useState<any[]>([]);
    const [destSummary, setDestSummary] = useState<any[]>([]);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalTrips, setModalTrips] = useState<any[]>([]);
    const [modalPage, setModalPage] = useState(0);
    const [modalLoading, setModalLoading] = useState(false);
    const [hasMoreTrips, setHasMoreTrips] = useState(true);

    const fetchDashboardData = async () => {
        setLoading(true);
        try {
            const [statsRes, borderRes, destRes] = await Promise.all([
                supabase.rpc('get_tat_fleet_stats', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_destination: selectedDestination || null
                }),
                supabase.rpc('get_border_wait_trend', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_border_tz: 'TUNDUMA BORDER TZ SIDE', // Defaulting to Tunduma for now as per example
                    p_border_foreign: 'NAKONDE BORDER ZMB SIDE'
                }),
                supabase.rpc('get_tat_summary_by_destination', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_destination: selectedDestination || null
                })
            ]);

            if (statsRes.error) console.error('Stats Error:', statsRes.error);
            if (borderRes.error) console.error('Border Error:', borderRes.error);
            if (destRes.error) console.error('Dest Error:', destRes.error);

            setStats(statsRes.data);
            setBorderData(borderRes.data || []);
            setDestSummary(destRes.data || []);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchModalTrips = async (page: number) => {
        setModalLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_tat_trip_details', {
                p_start_date: dateRange.start,
                p_end_date: dateRange.end,
                p_limit: 10,
                p_offset: page * 10,
                p_status: 'completed', // Showing completed trips for now in the modal
                p_destination: selectedDestination || null
            });

            if (error) throw error;

            if (data) {
                setModalTrips(data);
                setHasMoreTrips(data.length === 10);
            }
        } catch (error) {
            console.error('Error fetching trips:', error);
        } finally {
            setModalLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();
    }, [dateRange, selectedDestination]);

    useEffect(() => {
        if (isModalOpen) {
            fetchModalTrips(modalPage);
        }
    }, [isModalOpen, modalPage]);


    return (
        <div className="flex flex-col gap-6 p-6 min-h-full bg-surface-main text-foreground animate-in fade-in duration-500">
            {/* Header Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-2xl font-bold tracking-tight">Turnaround Time & Efficiency</h1>

                <div className="flex items-center gap-2">
                    {/* Simple Date Range Picker (Mock for now, could be replaced with a real component) */}
                    <select
                        className="bg-surface-card border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        onChange={(e) => {
                            const days = parseInt(e.target.value);
                            setDateRange({ start: subDays(new Date(), days), end: new Date() });
                        }}
                        defaultValue="30"
                    >
                        <option value="7">Last 7 Days</option>
                        <option value="30">Last 30 Days</option>
                        <option value="90">Last 90 Days</option>
                    </select>

                    {/* Destination Filter */}
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Filter Destination..."
                            className="bg-surface-card border border-border rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-40"
                            value={selectedDestination}
                            onChange={(e) => setSelectedDestination(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={fetchDashboardData}
                        className="p-2 bg-primary hover:bg-primary/90 text-white rounded transition-colors"
                    >
                        <RefreshCcw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* KPI Stats */}
            <KPIStats
                stats={stats}
                loading={loading}
                onOpenModal={() => {
                    setModalPage(0);
                    setIsModalOpen(true);
                }}
            />

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <BorderChart data={borderData} loading={loading} />
                </div>
                <div className="bg-surface-card p-4 rounded-lg border border-border shadow-sm">
                    <h3 className="text-sm font-semibold mb-4">Destination Summary</h3>
                    {loading ? (
                        <div className="space-y-2 animate-pulse">
                            {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-surface-raised rounded" />)}
                        </div>
                    ) : (
                        <div className="overflow-auto max-h-[280px]">
                            <table className="w-full text-sm">
                                <thead className="text-xs text-muted-foreground bg-surface-raised sticky top-0">
                                    <tr>
                                        <th className="p-2 text-left">Dest</th>
                                        <th className="p-2 text-right">Trips</th>
                                        <th className="p-2 text-right">TAT (Days)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {destSummary.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-surface-raised/50">
                                            <td className="p-2 font-medium">{item.destination}</td>
                                            <td className="p-2 text-right text-muted-foreground">{item.trip_count}</td>
                                            <td className="p-2 text-right">{item.avg_total_tat_days?.toFixed(1)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <TripCompletionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                trips={modalTrips}
                loading={modalLoading}
                page={modalPage}
                hasMore={hasMoreTrips}
                onPageChange={setModalPage}
            />
        </div>
    );
}
