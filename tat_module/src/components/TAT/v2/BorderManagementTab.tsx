'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
    Activity, 
    ArrowRight, 
    Clock3, 
    Database, 
    Gauge, 
    Layers3, 
    MapPinned, 
    Route, 
    ShieldAlert, 
    Truck, 
    Waypoints,
    TrendingUp,
    TrendingDown,
    Sparkles,
    BarChart3
} from 'lucide-react';
import { 
    Area, 
    AreaChart, 
    Bar, 
    BarChart, 
    CartesianGrid, 
    ResponsiveContainer, 
    Tooltip, 
    XAxis, 
    YAxis 
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
    SectionShell,
    MetricCard,
    EmptyState,
    formatHours,
    formatPercent,
    formatCompactNumber,
    toneStyles,
    safeNumber,
    type BorderTrendRow,
    type Tone
} from './v2-common';

interface Props {
    dateRange: { start: string; end: string };
}

interface BorderNode {
    canonical_name: string;
    border_code: string;
    border_family: string;
    country_code: string;
}

/** A truck currently at a border crossing (open entry, no exit yet). */
interface ActiveBorderTruck {
    trip_border_id: string;
    tracker_id: number;
    tracker_name: string;
    border_code: string;
    border_name: string;
    border_family: string;
    entry_time: string;
    /** NULL = physically still at border; non-null = has exited */
    exit_time: string | null;
    dwell_hrs: number | null;
}

export default function BorderManagementTab({ dateRange }: Props) {
    const [loadingBorders, setLoadingBorders] = useState(true);
    const [borders, setBorders] = useState<BorderNode[]>([]);
    const [trends, setTrends] = useState<Record<string, BorderTrendRow[]>>({});
    const [loadingTrends, setLoadingTrends] = useState<Record<string, boolean>>({});
    const [activeBorderTrucks, setActiveBorderTrucks] = useState<ActiveBorderTruck[]>([]);
    const [loadingActiveTrucks, setLoadingActiveTrucks] = useState(false);

    const fetchBorders = useCallback(async () => {
        setLoadingBorders(true);
        try {
            const { data, error } = await supabase.rpc('get_active_borders_v2');
            if (error) throw error;
            setBorders(data || []);
        } catch (e) {
            console.error('Fetch active borders failed', e);
        } finally {
            setLoadingBorders(false);
        }
    }, []);

    /** Fetch trucks currently at a border (exit_time IS NULL in border facts). */
    const fetchActiveBorderTrucks = useCallback(async () => {
        setLoadingActiveTrucks(true);
        try {
            // Query tat_trip_border_facts_v2 joined to tat_trip_facts_v2 for tracker info.
            // Only open crossings (exit_time IS NULL) represent trucks physically at the border.
            const { data, error } = await supabase
                .from('tat_trip_border_facts_v2')
                .select(`
                    trip_border_id,
                    trip_key,
                    tracker_id,
                    tracker_name,
                    border_code,
                    border_name,
                    border_family,
                    entry_time,
                    exit_time,
                    dwell_hrs
                `)
                .is('exit_time', null)
                .not('entry_time', 'is', null)
                .order('entry_time', { ascending: true });

            if (error) throw error;

            const trucks: ActiveBorderTruck[] = (data || []).map((row: any) => ({
                trip_border_id: row.trip_border_id,
                tracker_id:   row.tracker_id   ?? 0,
                tracker_name: row.tracker_name ?? 'Unknown',
                border_code:  row.border_code  ?? '',
                border_name:  row.border_name  ?? row.border_code ?? 'Unknown Border',
                border_family: row.border_family ?? '',
                entry_time:   row.entry_time,
                exit_time:    row.exit_time,
                dwell_hrs:    row.dwell_hrs ?? null,
            }));

            setActiveBorderTrucks(trucks);
        } catch (e) {
            console.error('Fetch active border trucks failed', e);
        } finally {
            setLoadingActiveTrucks(false);
        }
    }, []);

    const fetchTrend = useCallback(async (borderFamily: string) => {
        setLoadingTrends(prev => ({ ...prev, [borderFamily]: true }));
        try {
            const { data, error } = await supabase.rpc('get_border_wait_trend_v2', {
                p_start_date: dateRange.start,
                p_end_date: dateRange.end,
                p_border_family: borderFamily
            });
            if (error) throw error;
            setTrends(prev => ({ ...prev, [borderFamily]: data || [] }));
        } catch (e) {
            console.error(`Fetch trend for ${borderFamily} failed`, e);
        } finally {
            setLoadingTrends(prev => ({ ...prev, [borderFamily]: false }));
        }
    }, [dateRange]);

    useEffect(() => {
        fetchBorders();
        fetchActiveBorderTrucks();
    }, [fetchBorders, fetchActiveBorderTrucks]);

    const borderFamilies = useMemo(() => {
        const families = [...new Set(borders.map(b => b.border_family))];
        return families.sort();
    }, [borders]);

    useEffect(() => {
        borderFamilies.forEach(family => {
            if (!trends[family]) {
                fetchTrend(family);
            }
        });
    }, [borderFamilies, fetchTrend, trends]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Active Border Queue — trucks physically at a border right now */}
            {(loadingActiveTrucks || activeBorderTrucks.length > 0) && (
                <SectionShell
                    eyebrow="Live Border Queue"
                    title="Trucks Currently at Border"
                    description="Trucks with an open border crossing (no exit recorded). Dwell is measured from original entry — midnight data boundaries do not truncate these figures."
                    aside={
                        !loadingActiveTrucks ? (
                            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-200">
                                <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                                </span>
                                {activeBorderTrucks.length} at border
                            </span>
                        ) : null
                    }
                >
                    {loadingActiveTrucks ? (
                        <div className="flex h-24 items-center justify-center">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400" />
                        </div>
                    ) : activeBorderTrucks.length === 0 ? (
                        <EmptyState compact title="No trucks at border" description="No open border crossings at this time." />
                    ) : (
                        <div className="overflow-hidden rounded-[20px] border border-slate-800/80">
                            <table className="min-w-full divide-y divide-slate-800/70 text-sm">
                                <thead className="bg-slate-950/80 text-xs uppercase tracking-[0.2em] text-slate-500">
                                    <tr>
                                        <th className="px-5 py-3 text-left font-medium">Truck</th>
                                        <th className="px-5 py-3 text-left font-medium">Border</th>
                                        <th className="px-5 py-3 text-left font-medium">Entry (UTC)</th>
                                        <th className="px-5 py-3 text-left font-medium">Live Dwell</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60">
                                    {activeBorderTrucks.map((truck) => {
                                        const entryMs = new Date(truck.entry_time).getTime();
                                        const liveDwellHrs = Number.isNaN(entryMs)
                                            ? null
                                            : Math.max(0, (Date.now() - entryMs) / 3_600_000);
                                        const tone: Tone = liveDwellHrs != null && liveDwellHrs > 24
                                            ? 'critical'
                                            : liveDwellHrs != null && liveDwellHrs > 12
                                            ? 'warning'
                                            : 'neutral';
                                        const styles = toneStyles(tone);
                                        return (
                                            <tr key={truck.trip_border_id || `${truck.tracker_id}-${truck.entry_time}-${Math.random()}`} className="hover:bg-slate-900/40">
                                                <td className="px-5 py-3">
                                                    <div className="font-medium text-white">{truck.tracker_name}</div>
                                                    <div className="mt-0.5 text-[11px] text-slate-500">ID {truck.tracker_id}</div>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <div className="font-medium text-amber-200">{truck.border_name}</div>
                                                    <div className="mt-0.5 text-[11px] text-slate-500 uppercase tracking-wider">{truck.border_family.replace(/_/g, ' ')}</div>
                                                </td>
                                                <td className="px-5 py-3 text-slate-300">
                                                    {new Date(truck.entry_time).toLocaleString('en-GB', {
                                                        month: 'short', day: 'numeric',
                                                        hour: '2-digit', minute: '2-digit',
                                                        timeZone: 'UTC',
                                                    })}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className={cn(
                                                        'font-mono text-base font-semibold',
                                                        tone === 'critical' ? 'text-rose-300' : tone === 'warning' ? 'text-amber-300' : 'text-slate-200'
                                                    )}>
                                                        {liveDwellHrs != null ? formatHours(liveDwellHrs) : '--'}
                                                    </span>
                                                    <div className="mt-0.5 text-[10px] uppercase tracking-widest text-slate-500">continuous</div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </SectionShell>
            )}

            {loadingBorders && borders.length === 0 ? (
                <div className="grid gap-6 md:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-80 rounded-[32px] border border-slate-800 bg-slate-900/40 animate-pulse" />
                    ))}
                </div>
            ) : borderFamilies.length === 0 ? (
                <EmptyState title="No active borders found" description="The geofence_master table does not contain active borders with the required role mappings." />
            ) : (
                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-2">
                    {borderFamilies.map(family => {
                        const familyBorders = borders.filter(b => b.border_family === family);
                        const trendData = trends[family] || [];
                        const isLoading = loadingTrends[family];
                        const avgOutboundDwell = trendData.length > 0 ? (trendData.reduce((sum, r) => sum + safeNumber(r.avg_outbound_dwell_hrs), 0) / trendData.filter(r => safeNumber(r.avg_outbound_dwell_hrs) > 0).length || 1) : 0;
                        const avgReturnDwell = trendData.length > 0 ? (trendData.reduce((sum, r) => sum + safeNumber(r.avg_return_dwell_hrs), 0) / trendData.filter(r => safeNumber(r.avg_return_dwell_hrs) > 0).length || 1) : 0;
                        const avgCombined = (avgOutboundDwell + avgReturnDwell) / 2;
                        
                        const totalTrucks = trendData.reduce((sum, r) => sum + safeNumber(r.truck_count), 0);
                        const tone: Tone = avgCombined >= 18 ? 'critical' : avgCombined >= 10 ? 'warning' : 'good';
                        const styles = toneStyles(tone);

                        return (
                            <SectionShell
                                key={family}
                                eyebrow="Border Pressure"
                                title={family.replace(/_/g, ' ').toUpperCase()}
                                description={`Combined analytics for ${familyBorders.map(b => b.canonical_name.replace(' BORDER', '')).join(' / ')}.`}
                                className="p-0 overflow-visible"
                                aside={
                                    <div className="flex gap-2">
                                        <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest', styles.badge)}>
                                            {tone}
                                        </span>
                                    </div>
                                }
                            >
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 flex gap-8">
                                            <div>
                                                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                                                    <ArrowRight className="h-3 w-3 text-cyan-400" /> Outbound Avg
                                                </div>
                                                <div className={cn('mt-2 text-2xl font-bold', avgOutboundDwell >= 18 ? 'text-rose-400' : 'text-slate-200')}>{formatHours(avgOutboundDwell)}</div>
                                            </div>
                                            <div className="w-px bg-slate-800/80 my-2" />
                                            <div>
                                                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                                                    <ArrowRight className="h-3 w-3 rotate-180 text-fuchsia-400" /> Return Avg
                                                </div>
                                                <div className={cn('mt-2 text-2xl font-bold', avgReturnDwell >= 18 ? 'text-rose-400' : 'text-slate-200')}>{formatHours(avgReturnDwell)}</div>
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
                                            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">Total Volume</div>
                                            <div className="mt-2 text-2xl font-bold text-white">{formatCompactNumber(totalTrucks)} trucks</div>
                                        </div>
                                    </div>

                                    <div className="h-48 w-full mt-4">
                                        {isLoading ? (
                                            <div className="flex h-full items-center justify-center">
                                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-500" />
                                            </div>
                                        ) : trendData.length > 1 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={trendData}>
                                                    <defs>
                                                        <linearGradient id={`gradient-outbound-${family}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3}/>
                                                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                                                        </linearGradient>
                                                        <linearGradient id={`gradient-return-${family}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#e879f9" stopOpacity={0.3}/>
                                                            <stop offset="95%" stopColor="#e879f9" stopOpacity={0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <Area 
                                                        type="monotone" 
                                                        dataKey="avg_outbound_dwell_hrs" 
                                                        name="Outbound Wait (hrs)"
                                                        stroke="#22d3ee" 
                                                        fillOpacity={1} 
                                                        fill={`url(#gradient-outbound-${family})`} 
                                                        strokeWidth={2.5}
                                                    />
                                                    <Area 
                                                        type="monotone" 
                                                        dataKey="avg_return_dwell_hrs" 
                                                        name="Return Wait (hrs)"
                                                        stroke="#e879f9" 
                                                        fillOpacity={1} 
                                                        fill={`url(#gradient-return-${family})`} 
                                                        strokeWidth={2.5}
                                                    />
                                                    <Tooltip 
                                                        contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '12px' }}
                                                        itemStyle={{ color: '#fff', fontSize: '12px' }}
                                                        labelStyle={{ color: '#64748b', fontSize: '10px', marginBottom: '4px' }}
                                                    />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-xs text-slate-600 italic">Insufficient historical trend data</div>
                                        )}
                                    </div>
                                </div>
                            </SectionShell>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

