'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
    Activity, 
    ArrowRight, 
    Clock3, 
    Database, 
    Gauge, 
    Layers3,
    MapPinned, 
    ShieldAlert, 
    TrendingUp, 
    TrendingDown,
    Search,
    ChevronLeft,
    ChevronRight,
    LoaderCircle,
    Truck,
    Sparkles,
    Target
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { 
    MetricCard, 
    SectionShell, 
    EmptyState, 
    Tone,
    safeNumber,
    formatHours,
    formatPercent,
    formatCompactNumber,
    formatDays,
    toneStyles,
    V2TripRow,
    DestinationSummaryRow,
    adaptV2TripRow,
    describeSupabaseError,
    toUtcDayStart,
    toUtcDayEndExclusive,
    normaliseFilter,
    isOperationallyActive,
    ModalStatus
} from './v2-common';

import { ActiveTripQueuesModule, type ActiveQueueCounts, type ActiveQueuePayload, type ActiveQueueStatus } from '../ActiveTripQueuesModule';
import { CompletedTripFactsModule, type CompletedFactsPayload } from '../CompletedTripFactsModule';
import { TripCompletionModal, type TripDetail } from '../TripCompletionModal';

interface PrimaryDashboardTabProps {
    dateRange: { start: string; end: string };
    selectedDestination: string;
}

interface TripDetailsPayloadShape {
    total_completed: number;
    total_returning: number;
    total_unfinished: number;
    total_missed_dest: number;
    total_for_active_tab?: number;
    limit: number;
    offset: number;
    data: TripDetail[];
}

export function PrimaryDashboardTab({ dateRange, selectedDestination }: PrimaryDashboardTabProps) {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [destinationSummary, setDestinationSummary] = useState<DestinationSummaryRow[]>([]);
    const [phases, setPhases] = useState<any[]>([]);
    
    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tripDetails, setTripDetails] = useState<TripDetailsPayloadShape | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [modalTab, setModalTab] = useState<ModalStatus>('completed_or_returning');
    
    // Active Queue states
    const [isActiveQueuesOpen, setIsActiveQueuesOpen] = useState(false);
    const [activeQueueDetails, setActiveQueueDetails] = useState<ActiveQueuePayload | null>(null);
    const [activeQueueLoading, setActiveQueueLoading] = useState(false);
    const [activeQueueError, setActiveQueueError] = useState<string | null>(null);

    // Completed Facts states
    const [isCompletedFactsOpen, setIsCompletedFactsOpen] = useState(false);
    const [completedFactsData, setCompletedFactsData] = useState<CompletedFactsPayload | null>(null);
    const [completedFactsLoading, setCompletedFactsLoading] = useState(false);
    const [completedFactsError, setCompletedFactsError] = useState<string | null>(null);
    const [completedFactsSearchTerm, setCompletedFactsSearchTerm] = useState('');
    const [completedFactsPage, setCompletedFactsPage] = useState(0);

    const fetchStats = useCallback(async () => {
        setLoading(true);
        try {
            const { data: statsData, error: statsError } = await supabase.rpc('get_tat_fleet_stats_v2', {
                p_start_date: toUtcDayStart(dateRange.start),
                p_end_date: toUtcDayEndExclusive(dateRange.end),
                p_destination: normaliseFilter(selectedDestination)
            });

            if (statsError) throw statsError;
            setStats(statsData);

            const { data: destData, error: destError } = await supabase.rpc('get_tat_summary_by_destination_v2', {
                p_start_date: toUtcDayStart(dateRange.start),
                p_end_date: toUtcDayEndExclusive(dateRange.end)
            });

            if (destError) throw destError;
            setDestinationSummary(destData || []);

            const { data: phaseData, error: phaseError } = await supabase.rpc('get_operational_phases_v2');
            if (phaseError) throw phaseError;
            setPhases(phaseData || []);
        } catch (err) {
            console.error('Error fetching dashboard stats:', describeSupabaseError(err, 'Combined fetch failed'));
        } finally {
            setLoading(false);
        }
    }, [dateRange, selectedDestination]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    const fetchTripDetails = useCallback(async (tab: ModalStatus, page = 0) => {
        setDetailsLoading(true);
        setDetailsError(null);
        try {
            const { data, error } = await supabase.rpc('get_tat_trip_details_v2', {
                p_start_date: toUtcDayStart(dateRange.start),
                p_end_date: toUtcDayEndExclusive(dateRange.end),
                p_limit: 50,
                p_offset: page * 50,
                p_trip_type: null,
                p_status: tab === 'completed_or_returning' ? null : tab === 'completed_missed_dest' ? 'completed' : tab,
                p_search: null,
                p_sort: 'loading_start_desc',
                p_origin: null,
                p_destination: normaliseFilter(selectedDestination),
                p_tracker_id: null
            });

            if (error) throw error;
            
            const rawData = data?.data || [];
            let filtered = rawData.map(adaptV2TripRow) as TripDetail[];
            
            if (tab === 'completed_or_returning') {
                filtered = filtered.filter((r: any) => r.trip_status === 'completed' || r.trip_status === 'returning');
            } else if (tab === 'completed_missed_dest') {
                filtered = filtered.filter((r: any) => r.missed_destination === true || r.trip_status === 'completed_missed_dest');
            }

            setTripDetails({
                ...data,
                data: filtered,
                total_for_active_tab: filtered.length
            });
        } catch (err) {
            setDetailsError(describeSupabaseError(err, 'Failed to fetch trip details'));
        } finally {
            setDetailsLoading(false);
        }
    }, [dateRange, selectedDestination]);

    const handleKPICompletionClick = (count: number, tab: ModalStatus) => {
        setModalTab(tab);
        setIsModalOpen(true);
        fetchTripDetails(tab, 0);
    };

    const fetchActiveQueueDetails = useCallback(async () => {
        setActiveQueueLoading(true);
        setActiveQueueError(null);
        try {
            // Try the new server-side RPC first (Phase 63)
            const { data: rpcData, error: rpcError } = await supabase.rpc('get_active_queues_v2');

            if (!rpcError && rpcData) {
                // The RPC returns { generated_at, active_queue_counts, data }
                const payload: ActiveQueuePayload = {
                    generated_at: rpcData.generated_at || new Date().toISOString(),
                    active_queue_counts: rpcData.active_queue_counts || {
                        active_all: 0,
                        active_just_delivered: 0,
                        active_loading_started: 0,
                        active_loading_completed: 0,
                        active_at_border: 0,
                        active_awaiting_unloading: 0,
                        active_waiting_next_load: 0,
                    },
                    data: rpcData.data || []
                };
                setActiveQueueDetails(payload);
                return;
            }

            // Fallback: client-side approach if RPC doesn't exist yet
            console.warn('get_active_queues_v2 RPC unavailable, falling back to client-side:', rpcError?.message);
            const start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const end = new Date().toISOString().split('T')[0];
            
            const { data, error } = await supabase.rpc('get_tat_trip_details_v2', {
                p_start_date: toUtcDayStart(start),
                p_end_date: toUtcDayEndExclusive(end),
                p_limit: 30000,
                p_offset: 0,
                p_trip_type: null,
                p_status: null,
                p_search: null,
                p_sort: 'loading_start_desc',
                p_origin: null,
                p_destination: null,
                p_tracker_id: null
            });

            if (error) throw error;

            const rows = (data?.data || []).map(adaptV2TripRow);
            // Include completed trucks for "Await Next Load" queue
            const queueRows = rows.filter((r: V2TripRow) => {
                const qs = r.active_queue_status;
                return qs != null;
            });

            const payload: ActiveQueuePayload = {
                generated_at: new Date().toISOString(),
                active_queue_counts: buildActiveQueueCounts(rows),
                data: queueRows as any[]
            };

            setActiveQueueDetails(payload);
        } catch (err) {
            setActiveQueueError(describeSupabaseError(err, 'Failed to fetch active queues'));
        } finally {
            setActiveQueueLoading(false);
        }
    }, []);

    const fetchCompletedFacts = useCallback(async (search = '', page = 0) => {
        setCompletedFactsLoading(true);
        setCompletedFactsError(null);
        try {
            const { data, error } = await supabase.rpc('get_tat_trip_details_v2', {
                p_start_date: toUtcDayStart(dateRange.start),
                p_end_date: toUtcDayEndExclusive(dateRange.end),
                p_limit: 20,
                p_offset: page * 20,
                p_trip_type: null,
                p_status: 'completed',
                p_search: search || null,
                p_sort: 'loading_start_desc',
                p_origin: null,
                p_destination: null,
                p_tracker_id: null
            });

            if (error) throw error;
            
            const payload: CompletedFactsPayload = {
                total_count: data?.total_completed || 0,
                limit: 20,
                offset: page * 20,
                data: data?.data || [],
                generated_at: new Date().toISOString()
            };
            
            setCompletedFactsData(payload);
        } catch (err) {
            setCompletedFactsError(describeSupabaseError(err, 'Failed to fetch historical facts'));
        } finally {
            setCompletedFactsLoading(false);
        }
    }, [dateRange]);

    const destinationTatAverage = useMemo(() => {
        if (destinationSummary.length === 0) return 0;
        return destinationSummary.reduce((acc, row) => acc + safeNumber(row.avg_tat_days), 0) / destinationSummary.length;
    }, [destinationSummary]);

    const spotlightDestinations = useMemo(() => {
        return [...destinationSummary]
            .sort((a, b) => b.trip_count - a.trip_count)
            .slice(0, 3);
    }, [destinationSummary]);

    const maxDestinationTrips = useMemo(() => Math.max(...destinationSummary.map(r => r.trip_count), 0), [destinationSummary]);

    return (
        <div className="space-y-8 pb-20">
            {/* Header / Engine Controls */}
            <section className="relative overflow-hidden rounded-[32px] border border-slate-800/90 bg-slate-950/60 p-8 shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent" />
                <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
                    <div className="flex-1 space-y-2">
                        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-400">
                            <Sparkles className="h-3.5 w-3.5" />
                            Control Tower v2.0
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Fleet Performance</h1>
                        <p className="max-w-2xl text-lg text-slate-400">
                            Real-time intelligence across the delivery lifecycle. Connecting metadata roles to floor results.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-w-[420px]">
                        <button
                            onClick={() => { setIsActiveQueuesOpen(true); fetchActiveQueueDetails(); }}
                            className="group flex items-center justify-between rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-5 py-4 text-left transition hover:border-emerald-500/30 hover:bg-emerald-500/10"
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400 group-hover:scale-110 transition-transform">
                                    <Gauge className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-emerald-300/60 font-bold">Live Engine</div>
                                    <div className="text-sm font-semibold text-white">Active Queues</div>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-emerald-500/40 group-hover:translate-x-1 transition-transform" />
                        </button>
                        
                        <button
                            onClick={() => { setIsCompletedFactsOpen(true); fetchCompletedFacts(); }}
                            className="group flex items-center justify-between rounded-2xl border border-blue-500/10 bg-blue-500/5 px-5 py-4 text-left transition hover:border-blue-500/30 hover:bg-blue-500/10"
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-blue-500/10 p-2 text-blue-400 group-hover:scale-110 transition-transform">
                                    <Database className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-blue-300/60 font-bold">Historical</div>
                                    <div className="text-sm font-semibold text-white">Fact Browser</div>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-blue-500/40 group-hover:translate-x-1 transition-transform" />
                        </button>

                        <button
                            onClick={() => handleKPICompletionClick(0, 'completed_missed_dest')}
                            className="group flex items-center justify-between rounded-2xl border border-amber-500/10 bg-amber-500/5 px-5 py-4 text-left transition hover:border-amber-500/30 hover:bg-amber-500/10"
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-amber-500/10 p-2 text-amber-400 group-hover:scale-110 transition-transform">
                                    <ShieldAlert className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-amber-300/60 font-bold">Exceptions</div>
                                    <div className="text-sm font-semibold text-white">Missed Dest</div>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-amber-500/40 group-hover:translate-x-1 transition-transform" />
                        </button>

                        <button
                            onClick={() => handleKPICompletionClick(0, 'completed_or_returning')}
                            className="group flex items-center justify-between rounded-2xl border border-cyan-500/10 bg-cyan-500/5 px-5 py-4 text-left transition hover:border-cyan-500/30 hover:bg-cyan-500/10"
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-400 group-hover:scale-110 transition-transform">
                                    <Activity className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-cyan-300/60 font-bold">Cycles</div>
                                    <div className="text-sm font-semibold text-white">Trip Review</div>
                                </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-cyan-500/40 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
            </section>

            {/* Core Stats Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Departures"
                    value={formatCompactNumber(stats?.trips_departed)}
                    helper="Trips that began loading in this window."
                    icon={TrendingUp}
                    tone="good"
                    loading={loading}
                />
                <MetricCard
                    label="Avg TAT"
                    value={formatDays(stats?.avg_total_tat_hours ? stats.avg_total_tat_hours / 24 : 0)}
                    helper="From loading start to cycle completion."
                    icon={Clock3}
                    tone="neutral"
                    loading={loading}
                />
                <MetricCard
                    label="Border Flow"
                    value={formatHours(stats?.avg_border_wait_hours)}
                    helper="Average cumulative dwell across all borders."
                    icon={Gauge}
                    tone={safeNumber(stats?.avg_border_wait_hours) > 18 ? 'critical' : 'warning'}
                    loading={loading}
                />
                <MetricCard
                    label="Completion Rate"
                    value={formatPercent(stats?.trip_completion_rate)}
                    helper="Percentage of trips reaching confirmed exits."
                    icon={Target}
                    tone={safeNumber(stats?.trip_completion_rate) > 85 ? 'good' : 'warning'}
                    loading={loading}
                />
            </div>

            {/* Destination Intelligence */}
            <SectionShell
                eyebrow="Destination Intelligence"
                title="Performance by Location"
                description="Comparative analysis of destinations ranked by volume and TAT efficiency."
                aside={
                    <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                        {destinationSummary.length} Locations Identified
                    </span>
                }
            >
                {loading && destinationSummary.length === 0 ? (
                    <div className="grid gap-4 lg:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-48 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                        ))}
                    </div>
                ) : destinationSummary.length === 0 ? (
                    <EmptyState title="No destination data" description="Try broadening your date range to find completed trips." />
                ) : (
                    <div className="space-y-8">
                        <div className="grid gap-4 lg:grid-cols-3">
                            {spotlightDestinations.map((row, idx) => {
                                const rel = safeNumber(row.avg_tat_days) - destinationTatAverage;
                                const tone: Tone = rel <= 0 ? 'good' : rel <= 1 ? 'warning' : 'critical';
                                const styles = toneStyles(tone);
                                return (
                                    <div key={idx} className={cn('rounded-[24px] border bg-gradient-to-br p-6', styles.border, styles.surface)}>
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Spotlight</div>
                                                <h3 className="mt-2 text-xl font-bold text-white">{row.location}</h3>
                                            </div>
                                            <div className={cn('rounded-xl p-2.5', styles.icon)}>
                                                <MapPinned className="h-5 w-5" />
                                            </div>
                                        </div>
                                        <div className="mt-6 grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <div className="text-[10px] uppercase text-slate-500">Volume</div>
                                                <div className="text-xl font-bold text-white">{row.trip_count} trips</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[10px] uppercase text-slate-500">Avg TAT</div>
                                                <div className="text-xl font-bold text-white">{formatDays(row.avg_tat_days)}</div>
                                            </div>
                                        </div>
                                        <div className="mt-6 flex items-center gap-2">
                                            <div className={cn('h-1.5 w-1.5 rounded-full', tone === 'good' ? 'bg-emerald-400' : 'bg-amber-400')} />
                                            <span className="text-sm text-slate-400">
                                                {rel <= 0 ? 'Better than average' : `${rel.toFixed(1)}d slower than avg`}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="overflow-hidden rounded-[24px] border border-slate-800/90 bg-slate-950/60">
                            <table className="w-full text-left">
                                <thead className="bg-slate-950 px-6 py-4">
                                    <tr className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                                        <th className="px-6 py-4">Location</th>
                                        <th className="px-6 py-4 text-right">Trips</th>
                                        <th className="px-6 py-4 text-right">Avg TAT</th>
                                        <th className="px-6 py-4">Volume intensity</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {destinationSummary.map(row => {
                                        const tripWidth = (row.trip_count / maxDestinationTrips) * 100;
                                        return (
                                            <tr key={row.location} className="group transition hover:bg-slate-900/40">
                                                <td className="px-6 py-4 font-semibold text-white">{row.location}</td>
                                                <td className="px-6 py-4 text-right font-mono text-slate-300">{row.trip_count}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200">
                                                        {formatDays(row.avg_tat_days)}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="h-1.5 w-full max-w-[120px] rounded-full bg-slate-800">
                                                        <div 
                                                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" 
                                                            style={{ width: `${tripWidth}%` }} 
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </SectionShell>

            {/* Dynamic Phase Performance */}
            <SectionShell
                eyebrow="Lifecycle Intelligence"
                title="Operational Phase Performance"
                description="Real-time dwell and efficiency metrics for every stage in the fleet journey."
                aside={
                    <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                        {phases.length} Phases Monitored
                    </span>
                }
            >
                {loading && phases.length === 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="h-32 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                        {phases.map((phase, idx) => {
                            // Extract stats for this phase from our fleet stats
                            // The get_tat_fleet_stats_v2 returns a single row with specific columns
                            // For dynamic, we might need a separate RPC, but for now we'll map common ones
                            const phaseKey = phase.role_code.toLowerCase();
                            let value = '--';
                            let helper = phase.trip_stage;
                            let tone: Tone = 'neutral';

                            if (phaseKey === 'loading') {
                                value = formatHours(stats?.avg_loading_hrs);
                                helper = 'Mean terminal cycle.';
                                tone = safeNumber(stats?.avg_loading_hrs) > 24 ? 'warning' : 'good';
                            } else if (phaseKey === 'border') {
                                value = formatHours(stats?.avg_border_wait_hours);
                                helper = 'Cumulative border dwell.';
                                tone = safeNumber(stats?.avg_border_wait_hours) > 18 ? 'critical' : 'warning';
                            } else if (phaseKey === 'unloading') {
                                value = formatHours(stats?.avg_offloading_hrs);
                                helper = 'Destination site dwell.';
                                tone = safeNumber(stats?.avg_offloading_hrs) > 36 ? 'critical' : 'warning';
                            }

                            return (
                                <div key={idx} className="group relative overflow-hidden rounded-[24px] border border-slate-800 bg-slate-950/40 p-5 transition hover:border-slate-700">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{phase.role_code}</div>
                                            <div className="mt-2 text-xl font-bold text-white">{value}</div>
                                        </div>
                                        <div className="rounded-xl bg-slate-900 p-2 text-slate-500 transition-colors group-hover:text-cyan-400">
                                            <Layers3 className="h-4 w-4" />
                                        </div>
                                    </div>
                                    <div className="mt-4 flex items-center gap-2">
                                        <div className={cn('h-1 w-full rounded-full bg-slate-800')}>
                                            <div 
                                                className={cn('h-full rounded-full', tone === 'good' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : tone === 'critical' ? 'bg-rose-500' : 'bg-cyan-500')} 
                                                style={{ width: '40%' }} // Placeholder width
                                            />
                                        </div>
                                    </div>
                                    <p className="mt-3 text-[10px] text-slate-500">{helper}</p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </SectionShell>

            {/* Modals & Sub-Modules */}
            <TripCompletionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                initialTab={modalTab}
                data={tripDetails}
                loading={detailsLoading}
                error={detailsError}
                onPageChange={(page, status) => { setModalTab(status as ModalStatus); fetchTripDetails(status as ModalStatus, page); }}
            />

            <ActiveTripQueuesModule
                isOpen={isActiveQueuesOpen}
                onClose={() => setIsActiveQueuesOpen(false)}
                data={activeQueueDetails}
                loading={activeQueueLoading}
                error={activeQueueError}
            />

            <CompletedTripFactsModule
                isOpen={isCompletedFactsOpen}
                onClose={() => setIsCompletedFactsOpen(false)}
                data={completedFactsData}
                loading={completedFactsLoading}
                error={completedFactsError}
                searchTerm={completedFactsSearchTerm}
                onSearchTermChange={(q) => { setCompletedFactsSearchTerm(q); fetchCompletedFacts(q, 0); }}
                currentPage={completedFactsPage}
                onPageChange={(p) => { setCompletedFactsPage(p); fetchCompletedFacts(completedFactsSearchTerm, p); }}
                destinationScopeLabel={selectedDestination}
                dateWindowLabel={`${dateRange.start} - ${dateRange.end}`}
            />
        </div>
    );
}

function buildActiveQueueCounts(rows: V2TripRow[]): ActiveQueueCounts {
    return {
        active_all: rows.length,
        active_just_delivered: rows.filter(r => r.active_queue_status === 'active_just_delivered').length,
        active_loading_started: rows.filter(r => r.active_queue_status === 'active_loading_started').length,
        active_loading_completed: rows.filter(r => r.active_queue_status === 'active_loading_completed').length,
        active_at_border: rows.filter(r => r.active_queue_status === 'active_at_border').length,
        active_awaiting_unloading: rows.filter(r => r.active_queue_status === 'active_awaiting_unloading').length,
        active_waiting_next_load: rows.filter(r => r.active_queue_status === 'active_waiting_next_load').length,
    };
}
