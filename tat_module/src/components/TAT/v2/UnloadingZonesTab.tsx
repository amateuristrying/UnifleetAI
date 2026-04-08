'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
    Clock3, 
    Database, 
    Gauge, 
    TrendingUp, 
    TrendingDown,
    Truck,
    MapPinned,
    Target,
    Activity,
    Layers3,
    ArrowRight
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
    toUtcDayStart,
    toUtcDayEndExclusive
} from './v2-common';

interface UnloadingZoneStat {
    zone_name: string;
    trip_count: number;
    avg_dwell_hrs: number;
    avg_tat_hrs: number;
    avg_transit_hrs: number;
    queue_count: number;
}

interface UnloadingZonesTabProps {
    dateRange: { start: string; end: string };
}

export function UnloadingZonesTab({ dateRange }: UnloadingZonesTabProps) {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<UnloadingZoneStat[]>([]);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase.rpc('get_unloading_zone_stats_v2', {
                p_start_date: toUtcDayStart(dateRange.start),
                p_end_date: toUtcDayEndExclusive(dateRange.end)
            });

            if (fetchError) throw fetchError;
            setStats(data || []);
        } catch (err) {
            console.error('Error fetching unloading zone stats:', err);
            setError('Failed to load unloading zone intelligence.');
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const totalDeliveries = useMemo(() => stats.reduce((acc, s) => acc + s.trip_count, 0), [stats]);
    const avgOffloading = useMemo(() => stats.length ? stats.reduce((acc, s) => acc + s.avg_dwell_hrs, 0) / stats.length : 0, [stats]);
    const totalAwaiting = useMemo(() => stats.reduce((acc, s) => acc + s.queue_count, 0), [stats]);

    return (
        <div className="space-y-8 pb-20">
            {/* Delivery Insights */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Primary Destination"
                    value={stats[0]?.zone_name || '--'}
                    helper={`${stats[0]?.trip_count || 0} deliveries completed.`}
                    icon={MapPinned}
                    tone="neutral"
                    loading={loading}
                />
                <MetricCard
                    label="Active Offloading"
                    value={formatCompactNumber(totalAwaiting)}
                    helper="Trucks currently inside destination zones."
                    icon={Truck}
                    tone={totalAwaiting > 15 ? 'critical' : 'warning'}
                    loading={loading}
                />
                <MetricCard
                    label="Mean Offload Dwell"
                    value={formatHours(avgOffloading)}
                    helper="Average time from entry to site exit."
                    icon={Clock3}
                    tone="neutral"
                    loading={loading}
                />
                <MetricCard
                    label="Delivery Volume"
                    value={formatCompactNumber(totalDeliveries)}
                    helper="Total completions in this window."
                    icon={Activity}
                    tone="good"
                    loading={loading}
                />
            </div>

            {/* Destination Intelligence */}
            <SectionShell
                eyebrow="Delivery Intelligence"
                title="Unloading Zone Analysis"
                description="Analysis of destination sites based on offloading efficiency, transit reach, and queue latency."
                aside={
                    <div className="flex gap-2">
                        <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                            Scope: {stats.length} Destinations
                        </span>
                    </div>
                }
            >
                {loading && stats.length === 0 ? (
                    <div className="space-y-4">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="h-32 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                        ))}
                    </div>
                ) : stats.length === 0 ? (
                    <EmptyState title="No delivery data" description="Try broadening filters to see unloading performance." />
                ) : (
                    <div className="grid gap-6">
                        {stats.map((zone, idx) => {
                            const tone: Tone = zone.avg_dwell_hrs > 36 ? 'critical' : zone.avg_dwell_hrs > 12 ? 'warning' : 'good';
                            const styles = toneStyles(tone);
                            
                            return (
                                <div key={idx} className={cn('relative overflow-hidden rounded-[28px] border bg-gradient-to-br p-6 transition-all hover:border-slate-600', styles.border, styles.surface)}>
                                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                                        <div className="flex-1 space-y-1">
                                            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Destination / Customer</div>
                                            <h3 className="text-2xl font-bold text-white">{zone.zone_name}</h3>
                                            <div className="flex items-center gap-4 mt-4">
                                                <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs text-slate-400">
                                                    <Layers3 className="h-3.5 w-3.5" />
                                                    {zone.trip_count} Deliveries
                                                </div>
                                                <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs text-slate-400">
                                                    <Truck className="h-3.5 w-3.5" />
                                                    {zone.queue_count} Active
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-8 lg:w-[480px]">
                                            <div className="space-y-2">
                                                <div className="text-xs uppercase tracking-wider text-slate-500">Avg Offload</div>
                                                <div className={cn('text-3xl font-bold', styles.text)}>{formatHours(zone.avg_dwell_hrs)}</div>
                                                <div className="h-1.5 w-full rounded-full bg-slate-800">
                                                    <div 
                                                        className={cn('h-full rounded-full transition-all duration-1000', tone === 'good' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-rose-500')} 
                                                        style={{ width: `${Math.min(100, (zone.avg_dwell_hrs / 72) * 100)}%` }} 
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="text-xs uppercase tracking-wider text-slate-500">Mean Transit</div>
                                                <div className="text-3xl font-bold text-slate-200">{formatDays(zone.avg_transit_hrs / 24)}</div>
                                                <div className="text-xs text-slate-500">
                                                    Lead time from origin terminal.
                                                </div>
                                            </div>
                                        </div>

                                        <div className="hidden lg:block lg:w-[120px] text-right">
                                            <button className="rounded-full border border-slate-700 bg-slate-900 p-3 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-400">
                                                <ArrowRight className="h-6 w-6" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </SectionShell>
        </div>
    );
}
