'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
    Clock3, 
    Database, 
    Layers3, 
    Route, 
    ShieldAlert, 
    Target, 
    Crosshair,
    Search,
    ChevronRight,
    ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
    SectionShell, 
    MetricCard, 
    EmptyState, 
    formatHours, 
    formatPercent, 
    formatCompactNumber, 
    toneStyles,
    safeNumber 
} from './v2-common';

interface Props {
    dateRange: { start: string; end: string };
}

export default function CoverageLabTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [payload, setPayload] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedTrackerId, setSelectedTrackerId] = useState<number | null>(null);
    const [inspectorData, setInspectorData] = useState<any>(null);
    const [inspectorLoading, setInspectorLoading] = useState(false);

    const fetchSummary = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                start: dateRange.start,
                end: dateRange.end,
                orphanGapHours: '0',
                trackerLimit: '200',
            });
            const res = await fetch(`/api/tat/v2/uncovered-summary?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to fetch summary');
            setPayload(data.data);
            if (data.data?.trackers?.length > 0 && !selectedTrackerId) {
                setSelectedTrackerId(data.data.trackers[0].tracker_id);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [dateRange, selectedTrackerId]);

    const fetchInspector = useCallback(async (trackerId: number) => {
        setInspectorLoading(true);
        try {
            const params = new URLSearchParams({
                start: dateRange.start,
                end: dateRange.end,
                trackerId: String(trackerId),
                orphanGapHours: '0',
                factLimit: '100',
                uncoveredLimit: '100',
            });
            const res = await fetch(`/api/tat/v2/uncovered-tracker-detail?${params.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to fetch inspector');
            setInspectorData(data.data);
        } catch (e) {
            console.error('Fetch Inspector failed', e);
        } finally {
            setInspectorLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    useEffect(() => {
        if (selectedTrackerId) {
            fetchInspector(selectedTrackerId);
        }
    }, [selectedTrackerId, fetchInspector]);

    const trackers = useMemo(() => payload?.trackers || [], [payload]);

    const metrics = useMemo(() => ([
        {
            label: 'Uncovered trips',
            value: formatCompactNumber(payload?.total_uncovered_trips ?? 0),
            helper: 'Trips in state stream but missing from facts.',
            icon: ShieldAlert,
            tone: (payload?.total_uncovered_trips ?? 0) > 0 ? 'warning' : 'good' as any,
        },
        {
            label: 'Uncovered hours',
            value: formatHours(payload?.total_uncovered_hours ?? 0),
            helper: 'Total time across all identified gaps.',
            icon: Route,
            tone: 'neutral' as any,
        },
        {
            label: 'Waiting share',
            value: formatPercent((payload?.total_waiting_stage_hours / payload?.total_uncovered_hours) * 100, 1),
            helper: 'Share explained by post-closure dwell.',
            icon: Clock3,
            tone: 'warning' as any,
        },
        {
            label: 'Major state rows',
            value: formatCompactNumber(payload?.total_uncovered_major_state_rows ?? 0),
            helper: 'High-signal rows with no fact coverage.',
            icon: Layers3,
            tone: 'warning' as any,
        },
        {
            label: 'Coverage gap',
            value: formatPercent(payload?.uncovered_vs_fact_pct ?? 0, 1),
            helper: 'Uncovered trips as a share of fact trips.',
            icon: Database,
            tone: (payload?.uncovered_vs_fact_pct ?? 0) <= 5 ? 'good' : 'warning' as any,
        },
    ]), [payload]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {error && (
                <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-200">
                    {error}
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metrics.map((m) => (
                    <MetricCard key={m.label} {...m} loading={loading} />
                ))}
            </div>

            <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
                {/* Tracker Leaderboard */}
                <SectionShell
                    eyebrow="Integrity audit"
                    title="Exposure leaderboard"
                    description="Ranked by uncovered trip count with fact comparison."
                >
                    <div className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/60">
                        <div className="max-h-[600px] overflow-auto">
                            <table className="w-full text-left">
                                <thead className="sticky top-0 bg-slate-900/95 text-[10px] uppercase tracking-widest text-slate-500">
                                    <tr>
                                        <th className="px-5 py-4">Tracker</th>
                                        <th className="px-5 py-4 text-right">Facts</th>
                                        <th className="px-5 py-4 text-right">Uncovered</th>
                                        <th className="px-5 py-4 text-right">Gap %</th>
                                        <th className="px-5 py-4 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {trackers.map((tracker: any) => (
                                        <tr 
                                            key={tracker.tracker_id} 
                                            className={cn(
                                                'group cursor-pointer transition-colors',
                                                selectedTrackerId === tracker.tracker_id ? 'bg-cyan-500/10' : 'hover:bg-white/[0.02]'
                                            )}
                                            onClick={() => setSelectedTrackerId(tracker.tracker_id)}
                                        >
                                            <td className="px-5 py-4 font-medium text-slate-200">{tracker.tracker_name}</td>
                                            <td className="px-5 py-4 text-right font-mono text-sm text-slate-400">{tracker.fact_trip_count}</td>
                                            <td className="px-5 py-4 text-right font-mono text-sm text-amber-400">{tracker.uncovered_trip_count}</td>
                                            <td className="px-5 py-4 text-right">
                                                <div className="inline-flex rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                                                    {formatPercent(tracker.uncovered_vs_fact_pct ?? 0, 1)}
                                                </div>
                                            </td>
                                            <td className="px-5 py-4 text-right">
                                                <ChevronRight className={cn(
                                                    'h-4 w-4 transition-transform',
                                                    selectedTrackerId === tracker.tracker_id ? 'translate-x-1 text-cyan-400' : 'text-slate-700'
                                                )} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </SectionShell>

                {/* Tracker Inspector */}
                <SectionShell
                    eyebrow="Root cause analysis"
                    title="Tracker inspector"
                    description="Drill into the specific timeline of uncovered vs fact events."
                >
                    {inspectorLoading ? (
                        <div className="flex h-[500px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/40">
                            <div className="flex flex-col items-center gap-4">
                                <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500/30 border-t-cyan-500" />
                                <div className="text-sm font-medium text-slate-400 uppercase tracking-widest">Hydrating inspector...</div>
                            </div>
                        </div>
                    ) : inspectorData ? (
                        <div className="space-y-6">
                            <div className="rounded-3xl bg-slate-900/50 p-6 border border-slate-800">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="rounded-2xl bg-cyan-500/10 p-2 text-cyan-400">
                                        <Target className="h-5 w-5" />
                                    </div>
                                    <h4 className="font-semibold text-white">{inspectorData.tracker_name}</h4>
                                </div>
                                <div className="space-y-4 max-h-[440px] overflow-auto pr-2 custom-scrollbar">
                                    <InspectorTimeline data={inspectorData} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <EmptyState 
                            title="Select a tracker to inspect" 
                            description="Use the leaderboard to the left to select a specific tracker for root-cause analysis." 
                        />
                    )}
                </SectionShell>
            </div>
        </div>
    );
}

function InspectorTimeline({ data }: { data: any }) {
    // Combine facts and uncovered trips into a single timeline
    const timeline = [
        ...(data.fact_trips?.map((t: any) => ({ ...t, type: 'fact' })) || []),
        ...(data.uncovered_trips?.map((t: any) => ({ ...t, type: 'uncovered' })) || []),
    ].sort((a, b) => new Date(a.trip_start_utc).getTime() - new Date(b.trip_start_utc).getTime());

    return (
        <div className="relative space-y-4 pl-4 border-l border-slate-800">
            {timeline.map((trip, idx) => (
                <div key={idx} className="relative">
                    <div className={cn(
                        'absolute -left-[21px] top-4 h-2 w-2 rounded-full ring-4 ring-slate-950',
                        trip.type === 'fact' ? 'bg-cyan-500' : 'bg-amber-500'
                    )} />
                    <div className={cn(
                        'rounded-2xl border p-4 transition-all hover:translate-x-1',
                        trip.type === 'fact' ? 'bg-cyan-500/5 border-cyan-500/10' : 'bg-amber-500/5 border-amber-500/10'
                    )}>
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                                {trip.type === 'fact' ? 'Fact Coverage' : 'Uncovered Gap'}
                            </div>
                            <div className="text-[10px] font-mono text-slate-600">
                                {new Date(trip.trip_start_utc).toLocaleDateString()}
                            </div>
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-200">
                            {trip.type === 'fact' ? (trip.destination_name || 'Completed Fact') : 'Unknown Movement'}
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatHours(trip.trip_duration_hours)}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
