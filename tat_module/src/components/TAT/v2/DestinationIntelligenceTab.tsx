'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Clock3,
    MapPinned,
    Truck,
    Activity,
    Layers3,
    ArrowRight,
    ChevronDown,
    ChevronUp,
    Navigation,
    Package,
    Timer,
    Milestone,
    CircleDot,
    CircleCheck,
    Loader2,
    MapPin,
    Route
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
    formatDays,
    formatCompactNumber,
    toneStyles,
    toUtcDayStart,
    toUtcDayEndExclusive,
    isMidnightBoundary
} from './v2-common';

/* ────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────── */

interface DestinationIntelRow {
    canonical_name: string;
    total_visits: number;
    distinct_trips: number;
    distinct_trucks: number;
    avg_dwell_hrs: number;
    max_dwell_hrs: number;
    min_dwell_hrs: number;
    pct_multi_stop: number;
    currently_at: number;
}

interface DestStopFact {
    dest_fact_id: string;
    trip_key: string;
    tracker_id: number;
    dest_sequence: number;
    canonical_name: string;
    stop_state: string;
    entry_time: string;
    exit_time: string | null;
    dwell_hrs: number | null;
    is_current: boolean;
    is_midnight_stitch: boolean;
}

interface TripWithDests {
    trip_key: string;
    tracker_id: number;
    tracker_name: string;
    loading_terminal: string | null;
    destination_name: string | null;
    loading_start: string | null;
    status: string;
    destinations: DestStopFact[];
}

interface DestinationIntelligenceTabProps {
    dateRange: { start: string; end: string };
}

/* ────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────── */

function formatDateTime(value: string | null | undefined): string {
    if (!value) return '--';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '--';
    return dt.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'UTC'
    }) + ' UTC';
}

function dwellTone(hrs: number | null): Tone {
    if (hrs == null) return 'neutral';
    if (hrs > 72) return 'critical';
    if (hrs > 24) return 'warning';
    return 'good';
}

/* ────────────────────────────────────────────────────────────
   Components
   ──────────────────────────────────────────────────────────── */

/** Animated timeline node */
function TimelineNode({
    stop,
    isFirst,
    isLast,
    index,
}: {
    stop: DestStopFact;
    isFirst: boolean;
    isLast: boolean;
    index: number;
}) {
    const tone = dwellTone(stop.dwell_hrs);
    const styles = toneStyles(tone);
    const isCurrent = stop.is_current || (stop.exit_time && isMidnightBoundary(stop.exit_time));
    const dwellLabel = stop.dwell_hrs != null ? formatHours(stop.dwell_hrs) : '--';

    return (
        <div className="relative flex gap-5" style={{ animationDelay: `${index * 120}ms` }}>
            {/* Vertical connector line */}
            <div className="flex flex-col items-center">
                <div className={cn(
                    'z-10 h-10 w-10 rounded-2xl border-2 flex items-center justify-center text-sm font-bold transition-all duration-500',
                    isCurrent
                        ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.4)] animate-pulse'
                        : `border-slate-700 ${styles.icon}`
                )}>
                    {isCurrent ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : stop.dwell_hrs != null && stop.exit_time ? (
                        <CircleCheck className="h-4 w-4" />
                    ) : (
                        <CircleDot className="h-4 w-4" />
                    )}
                </div>
                {!isLast && (
                    <div className="w-0.5 flex-1 bg-gradient-to-b from-slate-600 via-slate-700/50 to-slate-800 min-h-[40px]" />
                )}
            </div>

            {/* Content card */}
            <div className={cn(
                'flex-1 rounded-2xl border p-5 mb-4 transition-all duration-300 hover:border-slate-600',
                isCurrent
                    ? 'border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-transparent shadow-[0_0_30px_rgba(6,182,212,0.08)]'
                    : `border-slate-800/80 bg-slate-950/60`
            )}>
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                Stop #{stop.dest_sequence}
                            </span>
                            {stop.is_midnight_stitch && (
                                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                                    Midnight Stitched
                                </span>
                            )}
                            {isCurrent && (
                                <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                    Currently Offloading
                                </span>
                            )}
                        </div>
                        <h4 className="text-lg font-bold text-white">{stop.canonical_name}</h4>
                    </div>

                    <div className={cn(
                        'rounded-2xl border px-4 py-2 text-center',
                        isCurrent
                            ? 'border-cyan-500/20 bg-cyan-500/10'
                            : `border-slate-800 ${styles.surface}`
                    )}>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Dwell</div>
                        <div className={cn(
                            'mt-1 text-xl font-bold',
                            isCurrent ? 'text-cyan-300' : styles.text
                        )}>
                            {dwellLabel}
                        </div>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                        <ArrowRight className="h-3 w-3 text-emerald-400" />
                        <span className="text-slate-500">Entry:</span>
                        <span className="font-medium text-slate-300">{formatDateTime(stop.entry_time)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <ArrowRight className="h-3 w-3 text-rose-400 rotate-180" />
                        <span className="text-slate-500">Exit:</span>
                        <span className="font-medium text-slate-300">
                            {isCurrent ? (
                                <span className="text-cyan-300 font-semibold">In Progress</span>
                            ) : (
                                formatDateTime(stop.exit_time)
                            )}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Trip timeline view */
function TripTimeline({
    trip,
    onClose,
}: {
    trip: TripWithDests;
    onClose: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [stops, setStops] = useState<DestStopFact[]>(trip.destinations || []);

    const fetchStops = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_trip_destination_facts_v2', {
                p_trip_key: trip.trip_key
            });
            if (error) throw error;
            setStops(data || []);
        } catch (err) {
            console.error('Failed to fetch destination facts:', err);
        } finally {
            setLoading(false);
        }
    }, [trip.trip_key]);

    useEffect(() => {
        if (!trip.destinations?.length) {
            fetchStops();
        } else {
            setLoading(false);
        }
    }, [fetchStops, trip.destinations]);

    const totalDwell = useMemo(() =>
        stops.reduce((sum, s) => sum + safeNumber(s.dwell_hrs), 0),
        [stops]
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="space-y-1">
                    <button
                        onClick={onClose}
                        className="mb-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
                    >
                        <ChevronUp className="h-3.5 w-3.5" />
                        Back to Overview
                    </button>
                    <h3 className="text-xl font-bold text-white">
                        Trip Timeline — {trip.tracker_name || `Tracker #${trip.tracker_id}`}
                    </h3>
                    <p className="text-sm text-slate-400">
                        {trip.loading_terminal && <>From <span className="text-slate-300 font-medium">{trip.loading_terminal}</span> · </>}
                        {new Set(stops.map(s => s.canonical_name)).size} destination{new Set(stops.map(s => s.canonical_name)).size !== 1 ? 's' : ''} · 
                        Total dwell: <span className="text-white font-semibold">{formatHours(totalDwell)}</span>
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <span className={cn(
                        'rounded-full border px-3 py-1 text-[11px] font-medium',
                        trip.status === 'completed'
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                            : trip.status === 'at_destination'
                            ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
                            : 'border-slate-700 bg-slate-900 text-slate-400'
                    )}>
                        {trip.status.replace(/_/g, ' ').toUpperCase()}
                    </span>
                </div>
            </div>

            {/* Timeline visualization */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
                </div>
            ) : stops.length === 0 ? (
                <EmptyState
                    title="No destination stops"
                    description="No destination visits were recorded for this trip."
                    compact
                />
            ) : (
                <div className="relative">
                    {/* Journey start marker */}
                    <div className="flex items-center gap-5 mb-4">
                        <div className="flex flex-col items-center">
                            <div className="h-10 w-10 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center">
                                <Package className="h-4 w-4 text-emerald-400" />
                            </div>
                            <div className="w-0.5 h-6 bg-gradient-to-b from-emerald-500/50 to-slate-700/50" />
                        </div>
                        <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-5 py-3 text-sm">
                            <span className="text-slate-400">Departed </span>
                            <span className="font-semibold text-emerald-300">{trip.loading_terminal || 'Origin'}</span>
                            {trip.loading_start && (
                                <span className="ml-2 text-slate-500">{formatDateTime(trip.loading_start)}</span>
                            )}
                        </div>
                    </div>

                    {/* Destination stops */}
                    {stops.map((stop, idx) => (
                        <TimelineNode
                            key={stop.dest_fact_id || idx}
                            stop={stop}
                            isFirst={idx === 0}
                            isLast={idx === stops.length - 1}
                            index={idx}
                        />
                    ))}

                    {/* Journey end marker */}
                    {trip.status === 'completed' && (
                        <div className="flex items-center gap-5 mt-2">
                            <div className="flex flex-col items-center">
                                <div className="h-10 w-10 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center">
                                    <CircleCheck className="h-4 w-4 text-emerald-400" />
                                </div>
                            </div>
                            <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-5 py-3 text-sm">
                                <span className="text-emerald-300 font-semibold">Trip Completed</span>
                                <span className="text-slate-400"> — Returned to origin</span>
                            </div>
                        </div>
                    )}
                    {stops.some(s => s.is_current) && (
                        <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-5 py-3 text-sm flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                            <span className="text-cyan-300 font-medium">Truck is currently offloading</span>
                            <span className="text-slate-400">at {stops.find(s => s.is_current)?.canonical_name}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** Multi-stop badge */
export function MultiStopBadge({
    destCount,
    className,
}: {
    destCount: number;
    className?: string;
}) {
    if (destCount <= 1) return null;
    return (
        <span className={cn(
            'inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300 whitespace-nowrap',
            className
        )}>
            <Route className="h-2.5 w-2.5" />
            +{destCount - 1} more
        </span>
    );
}

/* ────────────────────────────────────────────────────────────
   Main Component
   ──────────────────────────────────────────────────────────── */

export function DestinationIntelligenceTab({ dateRange }: DestinationIntelligenceTabProps) {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<DestinationIntelRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedTrip, setSelectedTrip] = useState<TripWithDests | null>(null);
    const [expandedDest, setExpandedDest] = useState<string | null>(null);
    const [destTrips, setDestTrips] = useState<TripWithDests[]>([]);
    const [destTripsLoading, setDestTripsLoading] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase.rpc('get_destination_intelligence_v2', {
                p_start_date: toUtcDayStart(dateRange.start),
                p_end_date: toUtcDayEndExclusive(dateRange.end)
            });
            if (fetchError) throw fetchError;
            setStats(data || []);
        } catch (err) {
            console.error('Error fetching destination intelligence:', err);
            setError('Failed to load destination intelligence.');
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const fetchTripsForDest = useCallback(async (destName: string) => {
        setDestTripsLoading(true);
        try {
            // Fetch trips that have facts for this destination
            const { data, error } = await supabase
                .from('tat_trip_destination_facts_v2')
                .select('trip_key, tracker_id, dest_sequence, canonical_name, entry_time, exit_time, dwell_hrs, is_current, is_midnight_stitch, dest_fact_id, stop_state')
                .eq('canonical_name', destName)
                .gte('entry_time', toUtcDayStart(dateRange.start))
                .lt('entry_time', toUtcDayEndExclusive(dateRange.end))
                .order('entry_time', { ascending: false })
                .limit(50);

            if (error) throw error;

            // Group by trip_key and fetch trip metadata
            const tripKeys = [...new Set((data || []).map(d => d.trip_key))];
            
            let tripMeta: any[] = [];
            if (tripKeys.length > 0) {
                const { data: meta } = await supabase
                    .from('tat_trip_facts_v2')
                    .select('trip_key, tracker_id, tracker_name, loading_terminal, destination_name, loading_start, status')
                    .in('trip_key', tripKeys);
                tripMeta = meta || [];
            }

            // Fetch ALL destination facts for these trips (to show full timelines)
            let allDests: DestStopFact[] = [];
            if (tripKeys.length > 0) {
                const { data: allDestsData } = await supabase
                    .from('tat_trip_destination_facts_v2')
                    .select('*')
                    .in('trip_key', tripKeys)
                    .order('dest_sequence', { ascending: true });
                allDests = allDestsData || [];
            }

            const trips: TripWithDests[] = tripKeys.map(tk => {
                const meta = tripMeta.find(m => m.trip_key === tk) || {};
                return {
                    trip_key: tk,
                    tracker_id: meta.tracker_id || 0,
                    tracker_name: meta.tracker_name || 'Unknown',
                    loading_terminal: meta.loading_terminal,
                    destination_name: meta.destination_name,
                    loading_start: meta.loading_start,
                    status: meta.status || 'unknown',
                    destinations: allDests.filter(d => d.trip_key === tk),
                };
            });

            setDestTrips(trips);
        } catch (err) {
            console.error('Error fetching trips for destination:', err);
        } finally {
            setDestTripsLoading(false);
        }
    }, [dateRange]);

    const handleDestClick = (destName: string) => {
        if (expandedDest === destName) {
            setExpandedDest(null);
            setDestTrips([]);
        } else {
            setExpandedDest(destName);
            fetchTripsForDest(destName);
        }
    };

    // Summary metrics
    const totalVisits = useMemo(() => stats.reduce((s, r) => s + r.total_visits, 0), [stats]);
    const totalTrucks = useMemo(() => stats.reduce((s, r) => s + r.distinct_trucks, 0), [stats]);
    const avgDwell = useMemo(
        () => stats.length ? stats.reduce((s, r) => s + r.avg_dwell_hrs, 0) / stats.length : 0,
        [stats]
    );
    const currentlyAt = useMemo(() => stats.reduce((s, r) => s + r.currently_at, 0), [stats]);

    // If a trip timeline is open, show it instead
    if (selectedTrip) {
        return (
            <div className="space-y-8 pb-20">
                <SectionShell
                    eyebrow="Trip Timeline"
                    title="Destination Sequence"
                    description="Sequential view of all destination stops for this trip."
                >
                    <TripTimeline
                        trip={selectedTrip}
                        onClose={() => setSelectedTrip(null)}
                    />
                </SectionShell>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-20">
            {/* KPI cards */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Total Dest Visits"
                    value={formatCompactNumber(totalVisits)}
                    helper="Individual destination stop visits across all trips."
                    icon={MapPinned}
                    tone="neutral"
                    loading={loading}
                />
                <MetricCard
                    label="Unique Trucks"
                    value={formatCompactNumber(totalTrucks)}
                    helper="Distinct trackers with destination data."
                    icon={Truck}
                    tone="good"
                    loading={loading}
                />
                <MetricCard
                    label="Avg Dwell"
                    value={formatHours(avgDwell)}
                    helper="Mean time from entry to exit across all dest stops."
                    icon={Clock3}
                    tone={avgDwell > 36 ? 'critical' : avgDwell > 12 ? 'warning' : 'good'}
                    loading={loading}
                />
                <MetricCard
                    label="Currently Offloading"
                    value={formatCompactNumber(currentlyAt)}
                    helper="Trucks currently inside destination zones right now."
                    icon={Activity}
                    tone={currentlyAt > 10 ? 'critical' : currentlyAt > 5 ? 'warning' : 'neutral'}
                    loading={loading}
                />
            </div>

            {/* Destination Intelligence Table */}
            <SectionShell
                eyebrow="Destination Intelligence v2"
                title="Multi-Stop Analysis"
                description="Comprehensive view of all destination sites with multi-stop trip detection and dwell analysis. Click a destination to see trip timelines."
                aside={
                    <div className="flex gap-2">
                        <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                            {stats.length} Destinations
                        </span>
                        {stats.some(s => s.pct_multi_stop > 0) && (
                            <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 text-[11px] font-medium text-violet-300">
                                Multi-Stop Detected
                            </span>
                        )}
                    </div>
                }
            >
                {loading && stats.length === 0 ? (
                    <div className="space-y-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-20 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                        ))}
                    </div>
                ) : stats.length === 0 ? (
                    <EmptyState title="No destination data" description="Try broadening filters to see destination intelligence." />
                ) : (
                    <div className="space-y-3">
                        {stats.map((dest, idx) => {
                            const tone = dwellTone(dest.avg_dwell_hrs);
                            const styles = toneStyles(tone);
                            const isExpanded = expandedDest === dest.canonical_name;

                            return (
                                <div key={idx} className="group">
                                    {/* Destination row */}
                                    <button
                                        onClick={() => handleDestClick(dest.canonical_name)}
                                        className={cn(
                                            'w-full rounded-[24px] border p-6 text-left transition-all duration-300',
                                            isExpanded
                                                ? 'border-cyan-500/30 bg-gradient-to-br from-cyan-500/8 via-transparent to-transparent shadow-[0_0_40px_rgba(6,182,212,0.06)]'
                                                : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700'
                                        )}
                                    >
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                                            {/* Name + badges */}
                                            <div className="flex-1 space-y-2">
                                                <div className="flex items-center gap-3">
                                                    <h3 className="text-xl font-bold text-white">{dest.canonical_name}</h3>
                                                    {dest.currently_at > 0 && (
                                                        <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                                            {dest.currently_at} active
                                                        </span>
                                                    )}
                                                    {dest.pct_multi_stop > 0 && (
                                                        <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                                                            {dest.pct_multi_stop.toFixed(0)}% multi-stop
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                                                        <Layers3 className="h-3 w-3" />
                                                        {dest.total_visits} visits
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                                                        <Truck className="h-3 w-3" />
                                                        {dest.distinct_trucks} trucks
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                                                        <Route className="h-3 w-3" />
                                                        {dest.distinct_trips} trips
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Metrics */}
                                            <div className="grid grid-cols-3 gap-6 lg:w-[400px]">
                                                <div className="space-y-1 text-center">
                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Avg Dwell</div>
                                                    <div className={cn('text-xl font-bold', styles.text)}>
                                                        {formatHours(dest.avg_dwell_hrs)}
                                                    </div>
                                                </div>
                                                <div className="space-y-1 text-center">
                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Max</div>
                                                    <div className="text-xl font-bold text-slate-200">
                                                        {formatHours(dest.max_dwell_hrs)}
                                                    </div>
                                                </div>
                                                <div className="space-y-1 text-center">
                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Min</div>
                                                    <div className="text-xl font-bold text-slate-200">
                                                        {formatHours(dest.min_dwell_hrs)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expand arrow */}
                                            <div className="flex items-center">
                                                {isExpanded ? (
                                                    <ChevronUp className="h-5 w-5 text-cyan-400 transition-transform" />
                                                ) : (
                                                    <ChevronDown className="h-5 w-5 text-slate-500 group-hover:text-slate-300 transition-all" />
                                                )}
                                            </div>
                                        </div>

                                        {/* Dwell bar */}
                                        <div className="mt-4 h-1.5 w-full rounded-full bg-slate-800">
                                            <div
                                                className={cn(
                                                    'h-full rounded-full transition-all duration-1000',
                                                    tone === 'good' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-rose-500'
                                                )}
                                                style={{ width: `${Math.min(100, (dest.avg_dwell_hrs / 96) * 100)}%` }}
                                            />
                                        </div>
                                    </button>

                                    {/* Expanded trip list */}
                                    {isExpanded && (
                                        <div className="ml-10 mt-2 space-y-2 animate-in slide-in-from-top-2 duration-300">
                                            {destTripsLoading ? (
                                                <div className="flex items-center justify-center py-10">
                                                    <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
                                                </div>
                                            ) : destTrips.length === 0 ? (
                                                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6 text-center text-sm text-slate-500">
                                                    No trip records found for this destination.
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 px-4 pt-2">
                                                        Trips with stops at {dest.canonical_name}
                                                    </div>
                                                    {destTrips.map((trip) => (
                                                        <button
                                                            key={trip.trip_key}
                                                            onClick={() => setSelectedTrip(trip)}
                                                            className="w-full rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4 text-left transition-all hover:border-cyan-500/20 hover:bg-slate-900/60 group/trip"
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="rounded-xl bg-slate-900 p-2 text-slate-500 group-hover/trip:text-cyan-400 transition-colors">
                                                                        <Navigation className="h-4 w-4" />
                                                                    </div>
                                                                    <div>
                                                                        <div className="font-semibold text-white text-sm">
                                                                            {trip.tracker_name}
                                                                        </div>
                                                                        <div className="text-xs text-slate-500 mt-0.5">
                                                                            {trip.loading_terminal && <>{trip.loading_terminal} → </>}
                                                                            {trip.destinations.map(d => d.canonical_name).filter((v, i, a) => a.indexOf(v) === i).join(' → ')}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    {new Set(trip.destinations.map(d => d.canonical_name)).size > 1 && (
                                                                        <MultiStopBadge destCount={new Set(trip.destinations.map(d => d.canonical_name)).size} />
                                                                    )}
                                                                    <span className={cn(
                                                                        'rounded-full border px-2.5 py-0.5 text-[10px] font-medium',
                                                                        trip.status === 'completed'
                                                                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                                                            : trip.status === 'at_destination'
                                                                            ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
                                                                            : 'border-slate-700 bg-slate-900 text-slate-400'
                                                                    )}>
                                                                        {trip.status.replace(/_/g, ' ')}
                                                                    </span>
                                                                    <ArrowRight className="h-4 w-4 text-slate-600 group-hover/trip:text-cyan-400 group-hover/trip:translate-x-1 transition-all" />
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </SectionShell>
        </div>
    );
}
