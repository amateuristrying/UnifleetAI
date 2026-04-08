'use client';

import React, { useMemo, useState } from 'react';
import {
    Clock3,
    Layers3,
    LoaderCircle,
    MapPinned,
    Route,
    Search,
    ShieldAlert,
    Sparkles,
    Truck,
    X,
    ChevronLeft,
    ChevronRight,
    Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMidnightBoundary } from './v2/v2-common';

export type ActiveQueueStatus =
    | 'active_all'
    | 'active_just_delivered'
    | 'active_loading_started'
    | 'active_loading_completed'
    | 'active_at_border'
    | 'active_awaiting_unloading'
    | 'active_waiting_next_load';

export type ActiveQueueCounts = Record<ActiveQueueStatus, number>;

export interface ActiveQueueBorderCrossing {
    border_code?: string;
    border_name?: string;
    entry_time?: string;
    exit_time?: string;
}

export interface ActiveQueueTrip {
    tracker_id: number;
    tracker_name: string;
    trip_status?: string;
    trip_type?: string;
    loading_terminal?: string | null;
    origin_region?: string | null;
    destination_name?: string | null;
    dest_name?: string | null;
    customer_name?: string | null;
    loading_start?: string | null;
    loading_end?: string | null;
    dest_entry?: string | null;
    dest_exit?: string | null;
    customer_entry?: string | null;
    customer_exit?: string | null;
    completion_time?: string | null;
    trip_closed_at?: string | null;
    next_dar_entry?: string | null;
    next_loading_entry?: string | null;
    border_entry?: string | null;
    border_exit?: string | null;
    return_border_entry?: string | null;
    return_border_exit?: string | null;
    total_tat_hrs?: number | null;
    transit_hrs?: number | null;
    loading_phase_hrs?: number | null;
    post_loading_delay_hrs?: number | null;
    return_hrs?: number | null;
    border_crossings?: ActiveQueueBorderCrossing[];
    active_queue_status?: ActiveQueueStatus | null;
    timeline?: Array<{ canonical_name?: string; event_time?: string }>;
    closure_geofence?: string | null;
    last_destination?: string | null;
    is_returning?: boolean | null;
    /** TRUE when the most recent exit is a 23:59:59 system boundary — truck still physically present */
    is_midnight_split_state?: boolean | null;
    /** Server-corrected status: 'returning' overridden to 'at_destination' for midnight artifacts */
    effective_trip_status?: string | null;
    /** dest/customer dwell hours since original entry (server-computed, midnight-continuous) */
    live_dest_dwell_hrs?: number | null;
    /** loading dwell hours since loading_start when still in loading phase */
    live_loading_dwell_hrs?: number | null;
    effective_dest_exit?: string | null;
    effective_customer_exit?: string | null;
    effective_loading_end?: string | null;
    closure_geofence_canonical?: string | null;
    last_destination_canonical?: string | null;
    last_known_geofence?: string | null;
    dest_stop_count?: number;
    destinations_array?: Array<{ name: string; dwell_hrs: number; is_current: boolean; sequence: number }>;
}

export interface ActiveQueuePayload {
    active_queue_counts: ActiveQueueCounts;
    data: ActiveQueueTrip[];
    generated_at?: string | null;
}

interface ActiveTripQueuesModuleProps {
    isOpen: boolean;
    onClose: () => void;
    data: ActiveQueuePayload | null;
    loading: boolean;
    error?: string | null;
    initialTab?: ActiveQueueStatus;
}

const ACTIVE_QUEUE_TABS: ActiveQueueStatus[] = [
    'active_all',
    'active_loading_started',
    'active_loading_completed',
    'active_at_border',
    'active_awaiting_unloading',
    'active_just_delivered',
    'active_waiting_next_load',
];

const QUEUE_META: Record<ActiveQueueStatus, {
    label: string;
    shortLabel: string;
    chipClass: string;
}> = {
    active_all: {
        label: 'Active Now',
        shortLabel: 'Active',
        chipClass: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100',
    },
    active_loading_started: {
        label: 'Loading Live',
        shortLabel: 'Loading',
        chipClass: 'border-orange-400/20 bg-orange-500/10 text-orange-100',
    },
    active_loading_completed: {
        label: 'Loaded',
        shortLabel: 'Loaded',
        chipClass: 'border-sky-400/20 bg-sky-500/10 text-sky-100',
    },
    active_at_border: {
        label: 'At Border',
        shortLabel: 'Border',
        chipClass: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
    },
    active_awaiting_unloading: {
        label: 'Await Unload',
        shortLabel: 'Await Unload',
        chipClass: 'border-purple-400/20 bg-purple-500/10 text-purple-100',
    },
    active_just_delivered: {
        label: 'Delivered Exit',
        shortLabel: 'Delivered',
        chipClass: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
    },
    active_waiting_next_load: {
        label: 'Await Next Load',
        shortLabel: 'Await Load',
        chipClass: 'border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-100',
    },
};

function formatDate(value: string | null | undefined): string {
    if (!value) return '--';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '--';
    return dt.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    });
}

function formatHours(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    if (value < 1) return `${Math.round(value * 60)}m`;
    return `${value.toFixed(1)}h`;
}

function toMillis(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

function hoursSince(value: string | null | undefined): number | null {
    const ms = toMillis(value);
    if (ms == null) return null;
    return Math.max(0, (Date.now() - ms) / 3_600_000);
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDestinationLabel(trip: ActiveQueueTrip): string {
    return trip.customer_name || trip.destination_name || trip.dest_name || 'Undeclared destination';
}

function getOriginLabel(trip: ActiveQueueTrip): string {
    return trip.loading_terminal || trip.origin_region || 'Unknown origin';
}

function getQueueStatus(trip: ActiveQueueTrip, activeTab: ActiveQueueStatus): ActiveQueueStatus {
    return activeTab === 'active_all' ? (trip.active_queue_status || 'active_all') : activeTab;
}

function getOpenBorderCrossing(trip: ActiveQueueTrip): ActiveQueueBorderCrossing | null {
    const crossings = Array.isArray(trip.border_crossings) ? trip.border_crossings : [];
    const open = crossings.find((crossing) => crossing.entry_time && !crossing.exit_time);
    if (open) return open;

    if (trip.return_border_entry && !trip.return_border_exit) {
        return {
            border_name: 'Return border checkpoint',
            entry_time: trip.return_border_entry,
            exit_time: trip.return_border_exit || undefined,
        };
    }

    if (trip.border_entry && !trip.border_exit) {
        return {
            border_name: 'Outbound border checkpoint',
            entry_time: trip.border_entry,
            exit_time: trip.border_exit || undefined,
        };
    }

    const sorted = [...crossings]
        .filter((crossing) => crossing.entry_time)
        .sort((a, b) => (toMillis(b.entry_time) || 0) - (toMillis(a.entry_time) || 0));
    return sorted[0] || null;
}

function resolveQueueContext(trip: ActiveQueueTrip, status: ActiveQueueStatus) {
    const latestEvent = [...(trip.timeline || [])]
        .filter(e => e.canonical_name && e.event_time)
        .sort((a, b) => (toMillis(b.event_time) || 0) - (toMillis(a.event_time) || 0))[0];
    
    const geofenceContext = latestEvent?.canonical_name || null;

    switch (status) {
        case 'active_loading_started': {
            const liveLoad = trip.live_loading_dwell_hrs ?? null;
            const isMidnightSplit = isTripMidnightSplit(trip);
            return {
                anchorLabel: 'Loading started',
                anchorTime: trip.loading_start || null,
                context: geofenceContext || getOriginLabel(trip),
                metricLabel: 'Loading age',
                metricValue: liveLoad != null ? formatHours(liveLoad) : formatHours(hoursSince(trip.loading_start)),
                isMidnightSplit,
            };
        }
        case 'active_loading_completed': {
            // Use effective_loading_end (midnight boundaries nulled) for the anchor display
            const realLoadEnd = trip.effective_loading_end || (
                !isMidnightBoundary(trip.loading_end) ? trip.loading_end : null
            ) || null;
            return {
                anchorLabel: 'Loading completed',
                anchorTime: realLoadEnd,
                context: trip.last_known_geofence || geofenceContext || getOriginLabel(trip),
                metricLabel: 'Post-load wait',
                metricValue: formatHours(hoursSince(realLoadEnd)),
                isMidnightSplit: false,
            };
        }
        case 'active_at_border': {
            const border = getOpenBorderCrossing(trip);
            return {
                anchorLabel: 'Border entry',
                anchorTime: border?.entry_time || null,
                context: geofenceContext || border?.border_name || border?.border_code || 'Border checkpoint',
                metricLabel: 'Border age',
                metricValue: formatHours(hoursSince(border?.entry_time)),
            };
        }
        case 'active_awaiting_unloading': {
            // Anchor is the ORIGINAL arrival — never the midnight boundary.
            // Use effective_dest_exit / effective_customer_exit to confirm no real exit.
            const customerAnchor = trip.customer_entry || null;
            const destAnchor = trip.dest_entry || null;
            const anchor = customerAnchor || destAnchor;
            // Prefer server-computed live dwell (already midnight-continuous) for accuracy
            const liveDwell = trip.live_dest_dwell_hrs ?? null;
            const isMidnightSplit = isTripMidnightSplit(trip);
            return {
                anchorLabel: customerAnchor ? 'Customer arrival' : 'Destination arrival',
                anchorTime: anchor,
                context: geofenceContext || getDestinationLabel(trip),
                metricLabel: 'Unload wait',
                metricValue: liveDwell != null ? formatHours(liveDwell) : formatHours(hoursSince(anchor)),
                isMidnightSplit,
            };
        }
        case 'active_just_delivered': {
            // Use effective exits (midnight boundaries already nulled out)
            const realCustomerExit = trip.effective_customer_exit || (
                !isMidnightBoundary(trip.customer_exit) ? trip.customer_exit : null
            ) || null;
            const realDestExit = trip.effective_dest_exit || (
                !isMidnightBoundary(trip.dest_exit) ? trip.dest_exit : null
            ) || null;

            if (!realCustomerExit && !realDestExit && isTripMidnightSplit(trip)) {
                // Midnight split — truck is actually still at destination, re-classify display
                const arrivalAnchor = trip.customer_entry || trip.dest_entry || null;
                const liveDwell = trip.live_dest_dwell_hrs ?? null;
                return {
                    anchorLabel: 'Destination arrival (still present)',
                    anchorTime: arrivalAnchor,
                    context: geofenceContext || getDestinationLabel(trip),
                    metricLabel: 'Dwell time',
                    metricValue: liveDwell != null ? formatHours(liveDwell) : formatHours(hoursSince(arrivalAnchor)),
                    isMidnightSplit: true,
                };
            }
            return {
                anchorLabel: realCustomerExit ? 'Customer exit' : 'Destination exit',
                anchorTime: realCustomerExit || realDestExit,
                context: geofenceContext || getDestinationLabel(trip),
                metricLabel: 'Post-delivery age',
                metricValue: formatHours(hoursSince(realCustomerExit || realDestExit)),
                isMidnightSplit: false,
            };
        }
        case 'active_waiting_next_load': {
            const completionAnchor = trip.trip_closed_at || trip.next_dar_entry || trip.completion_time || null;
            const closureGeo = trip.closure_geofence || trip.closure_geofence_canonical || geofenceContext || getOriginLabel(trip);
            return {
                anchorLabel: 'Trip closure',
                anchorTime: completionAnchor,
                context: trip.last_known_geofence || geofenceContext || closureGeo,
                metricLabel: 'Idle since close',
                metricValue: formatHours(hoursSince(completionAnchor)),
                closureGeofence: closureGeo,
                lastDestination: trip.last_destination || trip.last_destination_canonical || getDestinationLabel(trip),
            };
        }
        default: {
            const fallbackAnchor =
                trip.loading_start ||
                trip.loading_end ||
                trip.customer_entry ||
                trip.dest_entry ||
                trip.customer_exit ||
                trip.dest_exit ||
                trip.trip_closed_at ||
                trip.next_dar_entry ||
                null;
            return {
                anchorLabel: 'Latest queue anchor',
                anchorTime: fallbackAnchor,
                context: geofenceContext || getDestinationLabel(trip),
                metricLabel: 'Queue age',
                metricValue: formatHours(hoursSince(fallbackAnchor)),
            };
        }
    }
}

/**
 * Returns TRUE when the trip is in a "midnight split" state, meaning the most
 * recent exit timestamp is a 23:59:59 system boundary — NOT a physical exit.
 * The truck is still physically at the geofence.
 * Priority: server-supplied flag → client-side timestamp inspection.
 */
function isTripMidnightSplit(trip: ActiveQueueTrip): boolean {
    if (typeof trip.is_midnight_split_state === 'boolean') return trip.is_midnight_split_state;
    return (
        isMidnightBoundary(trip.dest_exit)     ||
        isMidnightBoundary(trip.customer_exit) ||
        isMidnightBoundary(trip.loading_end)
    );
}

/**
 * Returns the display label for trip status, correcting midnight-split artifacts.
 * When status is 'returning' but the exit was a midnight boundary, the truck is
 * physically still at the destination — show 'at_destination' instead.
 */
function resolveDisplayStatus(trip: ActiveQueueTrip): string {
    if (trip.effective_trip_status) return trip.effective_trip_status;
    const raw = trip.trip_status || 'active';
    if (raw === 'returning' && isTripMidnightSplit(trip)) return 'at_destination';
    return raw;
}

/** Animated "Active" pulse indicator shown on midnight-split rows. */
function ActivePulseBadge() {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
            <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Active
        </span>
    );
}

function StatusCardButton({
    status,
    count,
    active,
    onClick,
}: {
    status: ActiveQueueStatus;
    count: number;
    active: boolean;
    onClick: () => void;
}) {
    const meta = QUEUE_META[status];
    return (
        <button
            onClick={onClick}
            className={cn(
                'min-w-[164px] rounded-[22px] border bg-slate-950/60 p-4 text-left transition',
                active
                    ? 'border-cyan-400/30 bg-cyan-500/10 shadow-[0_18px_40px_-30px_rgba(34,211,238,0.6)]'
                    : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900/70'
            )}
        >
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">{meta.label}</div>
            <div className={cn('mt-3 text-2xl font-semibold', active ? 'text-cyan-100' : 'text-white')}>
                {count}
            </div>
        </button>
    );
}

function SummaryCard({
    label,
    value,
    helper,
}: {
    label: string;
    value: string;
    helper: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">{label}</div>
            <div className="mt-2 text-xl font-semibold text-white">{value}</div>
            <p className="mt-2 text-xs leading-5 text-slate-400">{helper}</p>
        </div>
    );
}

export function ActiveTripQueuesModule({
    isOpen,
    onClose,
    data,
    loading,
    error,
    initialTab = 'active_all',
}: ActiveTripQueuesModuleProps) {
    const [activeTab, setActiveTab] = useState<ActiveQueueStatus>(initialTab);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 100;

    const counts = data?.active_queue_counts || {
        active_all: 0,
        active_just_delivered: 0,
        active_loading_started: 0,
        active_loading_completed: 0,
        active_at_border: 0,
        active_awaiting_unloading: 0,
        active_waiting_next_load: 0,
    };

    const filteredTrips = useMemo(() => {
        const baseRows = Array.isArray(data?.data) ? data.data : [];
        const scopedRows = activeTab === 'active_all'
            ? baseRows
            : baseRows.filter((trip) => trip.active_queue_status === activeTab);

        const loweredSearch = searchTerm.trim().toLowerCase();
        const searchedRows = !loweredSearch
            ? scopedRows
            : scopedRows.filter((trip) => {
                const queueStatus = trip.active_queue_status || 'active_all';
                const haystack = [
                    trip.tracker_name,
                    String(trip.tracker_id),
                    getOriginLabel(trip),
                    getDestinationLabel(trip),
                    QUEUE_META[queueStatus].label,
                    trip.trip_type,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(loweredSearch);
            });

        return [...searchedRows].sort((left, right) => {
            const leftCtx = resolveQueueContext(left, getQueueStatus(left, activeTab));
            const rightCtx = resolveQueueContext(right, getQueueStatus(right, activeTab));
            // Recent (newest anchor) to oldest (oldest anchor)
            return (toMillis(rightCtx.anchorTime) || 0) - (toMillis(leftCtx.anchorTime) || 0);
        });
    }, [activeTab, data, searchTerm]);

    const pageCount = Math.ceil(filteredTrips.length / pageSize);
    const paginatedTrips = useMemo(() => {
        return filteredTrips.slice(page * pageSize, (page + 1) * pageSize);
    }, [filteredTrips, page, pageSize]);

    const queueAges = filteredTrips
        .map((trip) => {
            const ctx = resolveQueueContext(trip, getQueueStatus(trip, activeTab));
            return hoursSince(ctx.anchorTime);
        })
        .filter((value): value is number => value != null);

    const impactedDestinations = useMemo(
        () => new Set(filteredTrips.map((trip) => getDestinationLabel(trip))).size,
        [filteredTrips]
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-950/82 backdrop-blur-md">
            <div className="mx-auto flex h-full max-w-[1680px] flex-col p-3 sm:p-4">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-800/90 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.12),_transparent_30%),linear-gradient(135deg,_rgba(2,6,23,0.98),_rgba(15,23,42,0.96))] shadow-[0_32px_120px_-48px_rgba(15,23,42,0.95)]">
                    <div className="border-b border-slate-800/80 px-5 py-5 sm:px-6">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-200">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Active Queue Engine
                                </div>
                                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Live operational queues across the state-stop engine</h2>
                                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                                    Review trucks that are actively loading, cleared for transit, held at border, awaiting unload, recently delivered, or waiting for the next loading cycle.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {data?.generated_at ? (
                                    <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                        Snapshot {formatDate(data.generated_at)}
                                    </span>
                                ) : null}
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    {filteredTrips.length} trucks in view
                                </span>
                                <button
                                    onClick={onClose}
                                    className="inline-flex items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-950/70 p-3 text-slate-300 transition hover:border-slate-600 hover:text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 flex gap-3 overflow-x-auto pb-1">
                            {ACTIVE_QUEUE_TABS.map((status) => (
                                <StatusCardButton
                                    key={status}
                                    status={status}
                                    count={counts[status] || 0}
                                    active={activeTab === status}
                                    onClick={() => setActiveTab(status)}
                                />
                            ))}
                        </div>

                        <div className="mt-5 rounded-[26px] border border-slate-800/90 bg-slate-950/60 p-4">
                            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                                <label>
                                    <span className="mb-2 block text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Quick search</span>
                                    <div className="flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 px-4 py-2.5 text-sm text-white">
                                        <Search className="h-4 w-4 text-slate-500" />
                                        <input
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            placeholder="Search tracker, queue, route"
                                            className="w-full bg-transparent outline-none placeholder:text-slate-500"
                                        />
                                    </div>
                                </label>

                                <div className="grid gap-4 sm:grid-cols-3">
                                    <SummaryCard
                                        label="Queue count"
                                        value={String(filteredTrips.length)}
                                        helper="Trucks currently visible in the selected operational queue."
                                    />
                                    <SummaryCard
                                        label="Avg queue age"
                                        value={formatHours(average(queueAges))}
                                        helper="Average time trucks have remained in the selected queue."
                                    />
                                    <SummaryCard
                                        label="Destinations hit"
                                        value={String(impactedDestinations)}
                                        helper="Distinct delivery-side destinations represented in the queue."
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                        {loading ? (
                            <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-slate-800/80 bg-slate-950/40">
                                <div className="flex items-center gap-3 text-sm text-slate-300">
                                    <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" />
                                    Loading active queue snapshot...
                                </div>
                            </div>
                        ) : error ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-rose-500/20 bg-rose-500/5 px-6 text-center">
                                <ShieldAlert className="h-8 w-8 text-rose-300" />
                                <h3 className="mt-4 text-lg font-semibold text-white">Unable to load active queue module</h3>
                                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">{error}</p>
                            </div>
                        ) : filteredTrips.length === 0 ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-700/80 bg-slate-950/40 px-6 text-center">
                                <Truck className="h-8 w-8 text-slate-400" />
                                <h3 className="mt-4 text-lg font-semibold text-white">No trucks in this queue</h3>
                                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                                    The selected queue is currently empty for the active dashboard scope. Adjust the dashboard date or destination scope if you expect trucks here.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-[28px] border border-slate-800/90 bg-slate-950/55">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-800/70 text-sm">
                                        <thead className="bg-slate-950/80 text-xs uppercase tracking-[0.22em] text-slate-500">
                                            <tr>
                                                <th className="px-5 py-4 text-left font-medium">Truck</th>
                                                <th className="px-5 py-4 text-left font-medium">Queue</th>
                                                <th className="px-5 py-4 text-left font-medium">Route</th>
                                                <th className="px-5 py-4 text-left font-medium">Last Geofence</th>
                                                {activeTab === 'active_waiting_next_load' && (
                                                    <>
                                                        <th className="px-5 py-4 text-left font-medium">Closure Geofence</th>
                                                        <th className="px-5 py-4 text-left font-medium">Last Destination</th>
                                                    </>
                                                )}
                                                <th className="px-5 py-4 text-left font-medium">Anchor</th>
                                                <th className="px-5 py-4 text-left font-medium">Queue Age</th>
                                                <th className="px-5 py-4 text-left font-medium">Metrics</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/70">
                                            {paginatedTrips.map((trip) => {
                                                const status = getQueueStatus(trip, activeTab);
                                                const meta = QUEUE_META[status];
                                                const ctx = resolveQueueContext(trip, status);
                                                return (
                                                    <tr key={`${trip.tracker_id}-${trip.loading_start}-${status}`} className="align-top hover:bg-slate-900/45">
                                                        <td className="px-5 py-4">
                                                            <div className="flex items-start gap-3">
                                                                <div className={cn('rounded-2xl border p-2.5', meta.chipClass)}>
                                                                    <Truck className="h-4 w-4" />
                                                                </div>
                                                                <div>
                                                                    <div className="font-medium text-white">{trip.tracker_name}</div>
                                                                    <div className="mt-1 text-xs text-slate-500">Tracker ID {trip.tracker_id}</div>
                                                                    <div className="mt-2 text-xs text-slate-400">{trip.trip_type ? trip.trip_type.replace(/_/g, ' ') : 'Unknown type'}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium', meta.chipClass)}>
                                                                    {meta.shortLabel}
                                                                </span>
                                                                {['active_loading_started', 'active_at_border', 'active_awaiting_unloading'].includes(status) && <ActivePulseBadge />}
                                                            </div>
                                                            <div className="mt-2 text-xs text-slate-400">
                                                                {resolveDisplayStatus(trip)}
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4 text-slate-300">
                                                            <div className="max-w-[320px] font-medium text-white">
                                                                {getOriginLabel(trip)} <span className="text-slate-500">→</span> {getDestinationLabel(trip)}
                                                            </div>
                                                            <div className="mt-2 text-xs text-slate-500">{trip.customer_name ? 'Customer route' : 'Destination route'}</div>
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="flex flex-col gap-1.5">
                                                                {(() => {
                                                                    const isMulti = (trip.dest_stop_count || 0) > 1 && trip.destinations_array && activeTab === 'active_awaiting_unloading';
                                                                    const currentStop = isMulti ? (trip.destinations_array?.find(d => d.is_current) || trip.destinations_array?.[trip.destinations_array.length - 1]) : null;
                                                                    const displayContext = isMulti && currentStop ? currentStop.name : ctx.context;

                                                                    return (
                                                                        <>
                                                                            <div className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
                                                                                <MapPinned className="h-3.5 w-3.5" />
                                                                                {displayContext}
                                                                            </div>
                                                                            
                                                                            {isMulti && trip.destinations_array && (
                                                                                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-tight">
                                                                                    {trip.destinations_array.map((d, i) => (
                                                                                        <React.Fragment key={i}>
                                                                                            {i > 0 && <span className="text-slate-600">›</span>}
                                                                                            <span className={cn(d.is_current ? "text-emerald-200 font-medium" : "text-slate-500")} title={`${d.dwell_hrs.toFixed(1)}h delay`}>
                                                                                                <span className="inline-block">{d.name}</span>
                                                                                                <span className="opacity-70 ml-0.5">({d.dwell_hrs.toFixed(0)}h)</span>
                                                                                            </span>
                                                                                        </React.Fragment>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    );
                                                                })()}
                                                                {ctx.anchorLabel && (
                                                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-1.5">{ctx.anchorLabel}</div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        {activeTab === 'active_waiting_next_load' && (
                                                            <>
                                                                <td className="px-5 py-4">
                                                                    <div className="font-medium text-amber-200">
                                                                        {(ctx as any).closureGeofence || trip.closure_geofence || '--'}
                                                                    </div>
                                                                    <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Where finalized</div>
                                                                </td>
                                                                <td className="px-5 py-4">
                                                                    <div className="font-medium text-purple-200">
                                                                        {(ctx as any).lastDestination || trip.last_destination || getDestinationLabel(trip)}
                                                                    </div>
                                                                    <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">Coming from</div>
                                                                </td>
                                                            </>
                                                        )}
                                                        <td className="px-5 py-4">
                                                            <div className="font-medium text-white">{formatDate(ctx.anchorTime)}</div>
                                                            <div className="mt-1 text-xs text-slate-500">UTC Timestamp</div>
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="font-mono text-base text-cyan-100">{ctx.metricValue}</div>
                                                            <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{ctx.metricLabel}</div>
                                                        </td>
                                                        <td className="px-5 py-4 text-sm text-slate-300">
                                                            <div className="flex items-center gap-2">
                                                                <Route className="h-4 w-4 text-sky-300" />
                                                                <span>Transit {formatHours(trip.transit_hrs)}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <Layers3 className="h-4 w-4 text-orange-300" />
                                                                <span>Loading {formatHours(trip.loading_phase_hrs)}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <MapPinned className="h-4 w-4 text-emerald-300" />
                                                                <span>TAT {formatHours(trip.total_tat_hrs)}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <Clock3 className="h-4 w-4 text-fuchsia-300" />
                                                                <span>Return {trip.return_hrs != null ? formatHours(trip.return_hrs) : '--'}</span>
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
                        
                        {/* Pagination footer */}
                        {!loading && !error && filteredTrips.length > pageSize && (
                            <div className="mt-6 flex items-center justify-between border-t border-slate-800/60 pt-6">
                                <div className="text-xs text-slate-500 uppercase tracking-widest font-bold">
                                    Page {page + 1} of {pageCount} — Showing {paginatedTrips.length} of {filteredTrips.length}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(0, p - 1))}
                                        disabled={page === 0}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:bg-slate-800 disabled:opacity-30"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <button
                                        onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                                        disabled={page >= pageCount - 1}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 transition hover:bg-slate-800 disabled:opacity-30"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
