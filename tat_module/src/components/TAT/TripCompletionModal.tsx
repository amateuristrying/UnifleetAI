'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    Clock3,
    Filter,
    Layers3,
    LoaderCircle,
    MapPinned,
    Route,
    Search,
    ShieldAlert,
    Sparkles,
    Truck,
    Waypoints,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import TripTimeline, { mergeVisitChain } from './TripTimeline';
import TripRouteMap from './TripRouteMap';
import { supabase } from '@/lib/supabase';

interface TripVisit {
    geofence_name: string;
    in_time: string;
    out_time: string | null;
    event_type: 'loading' | 'unloading' | 'border' | 'transit';
}

interface RawGeofenceVisit {
    id: number | string;
    tracker_id: number;
    tracker_name: string | null;
    geofence_name: string | null;
    zone_name: string | null;
    in_time_dt: string;
    out_time_dt: string | null;
    visit_date: string | null;
    duration_seconds: number | null;
    in_address: string | null;
    out_address: string | null;
    source_file: string | null;
    created_at: string | null;
}

export interface TripDetail {
    tracker_id: number;
    tracker_name: string;
    trip_status: string;
    loading_terminal: string | null;
    dar_arrival: string | null;
    departure_time: string;
    loading_start: string;
    loading_end: string | null;
    kurasini_entry: string;
    kurasini_exit: string;
    dar_exit: string | null;
    dest_name: string | null;
    dest_entry: string | null;
    dest_exit: string | null;
    next_dar_entry: string | null;
    next_loading_entry?: string | null;
    border_tunduma_entry: string | null;
    border_tunduma_exit: string | null;
    border_kasumbalesa_entry: string | null;
    border_kasumbalesa_exit: string | null;
    border_mokambo_entry: string | null;
    border_mokambo_exit: string | null;
    border_chembe_entry: string | null;
    border_chembe_exit: string | null;
    border_kasumulu_entry: string | null;
    border_kasumulu_exit: string | null;
    border_sakania_entry: string | null;
    border_sakania_exit: string | null;
    border_other_entry: string | null;
    border_other_exit: string | null;
    return_border_tunduma_entry: string | null;
    return_border_tunduma_exit: string | null;
    return_border_kasumbalesa_entry: string | null;
    return_border_kasumbalesa_exit: string | null;
    return_border_mokambo_entry: string | null;
    return_border_mokambo_exit: string | null;
    return_border_chembe_entry: string | null;
    return_border_chembe_exit: string | null;
    return_border_kasumulu_entry: string | null;
    return_border_kasumulu_exit: string | null;
    return_border_sakania_entry: string | null;
    return_border_sakania_exit: string | null;
    return_border_other_entry: string | null;
    return_border_other_exit: string | null;
    customs_entry: string | null;
    customs_exit: string | null;
    drc_region_entry: string | null;
    drc_region_exit: string | null;
    customer_name: string | null;
    customer_entry: string | null;
    customer_exit: string | null;
    completion_time: string | null;
    trip_closed_at?: string | null;
    waiting_for_orders_hrs: number | null;
    loading_phase_hrs: number | null;
    post_loading_delay_hrs: number | null;
    transit_hrs: number | null;
    border_tunduma_hrs: number | null;
    border_kasumbalesa_hrs: number | null;
    border_mokambo_hrs: number | null;
    border_chembe_hrs: number | null;
    border_kasumulu_hrs: number | null;
    border_sakania_hrs: number | null;
    border_other_hrs: number | null;
    return_border_tunduma_hrs: number | null;
    return_border_kasumbalesa_hrs: number | null;
    return_border_mokambo_hrs: number | null;
    return_border_chembe_hrs: number | null;
    return_border_kasumulu_hrs: number | null;
    return_border_sakania_hrs: number | null;
    return_border_other_hrs: number | null;
    customs_hrs: number | null;
    drc_region_hrs: number | null;
    dest_dwell_hrs: number | null;
    customer_dwell_hrs: number | null;
    return_hrs: number | null;
    total_tat_hrs: number | null;
    is_completed: boolean;
    is_returning: boolean;
    trip_type: string;
    visit_chain: TripVisit[];
}

interface VehicleOption {
    tracker_id: number;
    tracker_name: string;
}

interface TripCompletionModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: {
        total_completed: number;
        total_returning: number;
        total_unfinished: number;
        total_missed_dest?: number;
        total_for_active_tab?: number;
        limit: number;
        offset: number;
        data: TripDetail[];
    } | null;
    loading: boolean;
    error?: string | null;
    onPageChange: (
        page: number,
        status: string,
        sort?: string,
        origin?: string | null,
        destination?: string | null,
        trackerId?: number | null,
        tripType?: string | null
    ) => void;
    initialTab?:
        | 'completed'
        | 'returning'
        | 'unfinished'
        | 'completed_or_returning'
        | 'completed_missed_dest';
    initialDestination?: string | null;
    initialOrigin?: string | null;
    initialTrackerId?: number | null;
    initialTripType?: string | null;
}

type ModalTab =
    | 'completed'
    | 'returning'
    | 'unfinished'
    | 'completed_or_returning'
    | 'completed_missed_dest';
type DetailTab = 'overview' | 'raw_data';
type SortMode = 'tat_desc' | 'tat_asc' | 'newest' | 'oldest';
type MilestoneCategory = 'origin' | 'loading' | 'transit' | 'border' | 'customs' | 'destination' | 'customer' | 'return_border' | 'return';

interface MilestoneEvent {
    label: string;
    time: string;
    kind: 'point' | 'span_start' | 'span_end';
    category: MilestoneCategory;
}

const ALL_VALUE = 'all';

const STATUS_META: Record<string, {
    label: string;
    chipClass: string;
    iconClass: string;
    surfaceClass: string;
}> = {
    completed: {
        label: 'Delivered',
        chipClass: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
        iconClass: 'bg-emerald-500/12 text-emerald-300',
        surfaceClass: 'from-emerald-500/16 via-emerald-500/6 to-transparent border-emerald-400/18',
    },
    completed_missed_dest: {
        label: 'Delivered (No Dest)',
        chipClass: 'border-orange-400/20 bg-orange-500/10 text-orange-100',
        iconClass: 'bg-orange-500/12 text-orange-200',
        surfaceClass: 'from-orange-500/16 via-orange-500/6 to-transparent border-orange-400/18',
    },
    returning: {
        label: 'Returning',
        chipClass: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
        iconClass: 'bg-amber-500/12 text-amber-200',
        surfaceClass: 'from-amber-500/16 via-amber-500/6 to-transparent border-amber-400/18',
    },
    at_destination: {
        label: 'At Destination',
        chipClass: 'border-purple-400/20 bg-purple-500/10 text-purple-100',
        iconClass: 'bg-purple-500/12 text-purple-200',
        surfaceClass: 'from-purple-500/16 via-purple-500/6 to-transparent border-purple-400/18',
    },
    pre_transit: {
        label: 'Pre-Transit Ops',
        chipClass: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100',
        iconClass: 'bg-cyan-500/12 text-cyan-200',
        surfaceClass: 'from-cyan-500/16 via-cyan-500/6 to-transparent border-cyan-400/18',
    },
    loading: {
        label: 'Loading',
        chipClass: 'border-orange-400/20 bg-orange-500/10 text-orange-100',
        iconClass: 'bg-orange-500/12 text-orange-200',
        surfaceClass: 'from-orange-500/16 via-orange-500/6 to-transparent border-orange-400/18',
    },
    in_transit: {
        label: 'In Transit',
        chipClass: 'border-sky-400/20 bg-sky-500/10 text-sky-100',
        iconClass: 'bg-sky-500/12 text-sky-200',
        surfaceClass: 'from-sky-500/16 via-sky-500/6 to-transparent border-sky-400/18',
    },
};

const TRIP_TYPE_META: Record<string, { label: string; className: string }> = {
    long_haul: { label: 'Long Haul', className: 'border-sky-400/20 bg-sky-500/10 text-sky-100' },
    local_ops: { label: 'Local Ops', className: 'border-amber-400/20 bg-amber-500/10 text-amber-100' },
    lpg_delivery: { label: 'LPG Delivery', className: 'border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-100' },
};

const CATEGORY_META: Record<MilestoneCategory, { dotClass: string; textClass: string; label: string }> = {
    origin: { dotClass: 'bg-emerald-400', textClass: 'text-emerald-200', label: 'Origin' },
    loading: { dotClass: 'bg-orange-400', textClass: 'text-orange-200', label: 'Loading' },
    transit: { dotClass: 'bg-sky-400', textClass: 'text-sky-200', label: 'Transit' },
    border: { dotClass: 'bg-amber-300', textClass: 'text-amber-100', label: 'Border' },
    customs: { dotClass: 'bg-orange-500', textClass: 'text-orange-100', label: 'Customs' },
    destination: { dotClass: 'bg-purple-400', textClass: 'text-purple-100', label: 'Destination' },
    customer: { dotClass: 'bg-emerald-300', textClass: 'text-emerald-100', label: 'Customer' },
    return_border: { dotClass: 'bg-yellow-300/70', textClass: 'text-yellow-100', label: 'Return Border' },
    return: { dotClass: 'bg-cyan-300', textClass: 'text-cyan-100', label: 'Return' },
};

function safeNumber(value: number | null | undefined): number {
    return value != null && Number.isFinite(value) ? value : 0;
}

function formatHrs(hrs: number | null | undefined): string {
    if (hrs === null || hrs === undefined || !Number.isFinite(hrs)) return '--';
    if (hrs < 0) return '0m';
    if (hrs < 1) return `${Math.round(hrs * 60)}m`;
    return `${hrs.toFixed(1)}h`;
}

function formatDate(dt: string | null | undefined): string {
    if (!dt) return '--';
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    });
}

function formatPercent(value: number | null | undefined, digits = 0): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${value.toFixed(digits)}%`;
}

function durationFromSeconds(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return '--';
    if (seconds < 0) return '--';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(2)}h`;
}

function toMillis(ts: string | null | undefined): number | null {
    if (!ts) return null;
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? null : ms;
}

function earliestTimestamp(values: Array<string | null | undefined>): string | null {
    const valid = values
        .map((v) => ({ raw: v, ms: toMillis(v) }))
        .filter((x): x is { raw: string | null | undefined; ms: number } => x.ms != null);
    if (valid.length === 0) return null;
    valid.sort((a, b) => a.ms - b.ms);
    return valid[0].raw as string;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
    const valid = values
        .map((v) => ({ raw: v, ms: toMillis(v) }))
        .filter((x): x is { raw: string | null | undefined; ms: number } => x.ms != null);
    if (valid.length === 0) return null;
    valid.sort((a, b) => b.ms - a.ms);
    return valid[0].raw as string;
}

function timeOfDayUTC(ts: string | null | undefined): string | null {
    const ms = toMillis(ts);
    if (ms == null) return null;
    return new Date(ms).toISOString().slice(11, 19);
}

function normaliseFilter(value: string | null | undefined): string | null {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower === ALL_VALUE || lower.startsWith('all ')) return null;
    return value;
}

function buildTripIdentity(trip: TripDetail): string {
    return [
        trip.tracker_id,
        trip.departure_time || '',
        trip.loading_start || '',
        trip.dest_name || '',
        trip.customer_name || '',
        trip.trip_status || '',
    ].join('|');
}

function getStatusMeta(status: string) {
    return STATUS_META[status] || STATUS_META.in_transit;
}

function getTripTypeMeta(tripType: string | null | undefined) {
    if (!tripType) return { label: 'Unknown Type', className: 'border-slate-600 bg-slate-800 text-slate-200' };
    return TRIP_TYPE_META[tripType] || {
        label: tripType.replace(/_/g, ' '),
        className: 'border-slate-600 bg-slate-800 text-slate-200',
    };
}

function getDestinationLabel(trip: TripDetail): string {
    return trip.customer_name || trip.dest_name || 'Undeclared destination';
}

function getOriginLabel(trip: TripDetail): string {
    return trip.loading_terminal || 'Unknown loading terminal';
}

function getTripStart(trip: TripDetail): string | null {
    return earliestTimestamp([trip.dar_arrival, trip.loading_start, trip.departure_time]);
}

function getTripEnd(trip: TripDetail): string | null {
    return latestTimestamp([trip.next_dar_entry, trip.trip_closed_at, trip.next_loading_entry]);
}

function isTripStillInProgress(trip: TripDetail): boolean {
    return !getTripEnd(trip) && (
        trip.trip_status === 'returning' ||
        trip.trip_status === 'at_destination' ||
        trip.trip_status === 'in_transit' ||
        trip.trip_status === 'pre_transit' ||
        trip.trip_status === 'loading'
    );
}

function formatTripEndValue(trip: TripDetail): string {
    const tripEnd = getTripEnd(trip);
    if (tripEnd) return formatDate(tripEnd);
    return isTripStillInProgress(trip) ? 'In progress' : '--';
}

function getTripEndHelper(trip: TripDetail): string {
    if (getTripEnd(trip)) return 'Latest return or closure anchor.';
    return 'Return or closure anchor not yet confirmed by the engine.';
}

function getPhaseMetrics(trip: TripDetail) {
    const borderTotal =
        safeNumber(trip.border_tunduma_hrs) +
        safeNumber(trip.border_kasumbalesa_hrs) +
        safeNumber(trip.border_mokambo_hrs) +
        safeNumber(trip.border_chembe_hrs) +
        safeNumber(trip.border_kasumulu_hrs) +
        safeNumber(trip.border_sakania_hrs) +
        safeNumber(trip.border_other_hrs) +
        safeNumber(trip.return_border_tunduma_hrs) +
        safeNumber(trip.return_border_kasumbalesa_hrs) +
        safeNumber(trip.return_border_mokambo_hrs) +
        safeNumber(trip.return_border_chembe_hrs) +
        safeNumber(trip.return_border_kasumulu_hrs) +
        safeNumber(trip.return_border_sakania_hrs) +
        safeNumber(trip.return_border_other_hrs);

    const deliveryTotal = trip.customer_dwell_hrs ?? trip.dest_dwell_hrs ?? trip.drc_region_hrs ?? null;

    return [
        {
            key: 'waiting',
            label: 'Dispatch Wait',
            description: 'Pre-order and release dwell.',
            hours: trip.waiting_for_orders_hrs,
            colorClass: 'from-slate-400 via-slate-500 to-slate-600',
            icon: Clock3,
        },
        {
            key: 'loading',
            label: 'Loading Ops',
            description: 'Terminal or zone loading cycle.',
            hours: trip.loading_phase_hrs,
            colorClass: 'from-orange-300 via-orange-400 to-amber-500',
            icon: Layers3,
        },
        {
            key: 'pre_transit',
            label: 'Pre-Transit',
            description: 'Post-loading delay before true movement.',
            hours: trip.post_loading_delay_hrs,
            colorClass: 'from-cyan-300 via-sky-400 to-blue-500',
            icon: Route,
        },
        {
            key: 'transit',
            label: 'True Transit',
            description: 'Clean line-haul movement.',
            hours: trip.transit_hrs,
            colorClass: 'from-sky-300 via-sky-400 to-indigo-500',
            icon: Truck,
        },
        {
            key: 'border',
            label: 'Border Stack',
            description: 'All onward and return border dwell.',
            hours: borderTotal,
            colorClass: 'from-amber-300 via-yellow-400 to-orange-500',
            icon: ShieldAlert,
        },
        {
            key: 'delivery',
            label: 'Delivery Dwell',
            description: 'Destination or customer unload time.',
            hours: deliveryTotal,
            colorClass: 'from-emerald-300 via-emerald-400 to-teal-500',
            icon: MapPinned,
        },
        {
            key: 'return',
            label: 'Return Leg',
            description: 'Return movement back to origin coverage.',
            hours: trip.return_hrs,
            colorClass: 'from-cyan-300 via-cyan-400 to-teal-400',
            icon: Waypoints,
        },
    ];
}

function buildChronologicalMilestones(trip: TripDetail): MilestoneEvent[] {
    const events: MilestoneEvent[] = [];

    function addPoint(label: string, time: string | null, category: MilestoneCategory) {
        if (time) events.push({ label, time, kind: 'point', category });
    }

    function addSpan(
        labelEntry: string,
        entryTime: string | null,
        labelExit: string,
        exitTime: string | null,
        category: MilestoneCategory
    ) {
        if (entryTime) events.push({ label: labelEntry, time: entryTime, kind: 'span_start', category });
        if (exitTime) events.push({ label: labelExit, time: exitTime, kind: 'span_end', category });
    }

    addPoint('Origin arrival', trip.dar_arrival, 'origin');
    addPoint('Loading start', trip.loading_start, 'loading');
    addPoint('Loading end', trip.loading_end, 'loading');
    addPoint('Origin exit', trip.dar_exit, 'transit');

    addSpan('Tunduma entry', trip.border_tunduma_entry, 'Tunduma exit', trip.border_tunduma_exit, 'border');
    addSpan('Kasumbalesa entry', trip.border_kasumbalesa_entry, 'Kasumbalesa exit', trip.border_kasumbalesa_exit, 'border');
    addSpan('Sakania entry', trip.border_sakania_entry, 'Sakania exit', trip.border_sakania_exit, 'border');
    addSpan('Mokambo entry', trip.border_mokambo_entry, 'Mokambo exit', trip.border_mokambo_exit, 'border');
    addSpan('Chembe entry', trip.border_chembe_entry, 'Chembe exit', trip.border_chembe_exit, 'border');
    addSpan('Kasumulu entry', trip.border_kasumulu_entry, 'Kasumulu exit', trip.border_kasumulu_exit, 'border');
    addSpan('Other border entry', trip.border_other_entry, 'Other border exit', trip.border_other_exit, 'border');

    addSpan('Customs entry', trip.customs_entry, 'Customs exit', trip.customs_exit, 'customs');
    addSpan('DRC region entry', trip.drc_region_entry, 'DRC region exit', trip.drc_region_exit, 'destination');

    if (trip.customer_name) {
        addPoint(`Customer arrival: ${trip.customer_name}`, trip.customer_entry, 'customer');
        addPoint('Customer exit', trip.customer_exit, 'customer');
    } else if (trip.dest_name) {
        addPoint(`Destination arrival: ${trip.dest_name}`, trip.dest_entry, 'destination');
        addPoint('Destination exit', trip.dest_exit, 'destination');
    }

    addSpan('Return Tunduma entry', trip.return_border_tunduma_entry, 'Return Tunduma exit', trip.return_border_tunduma_exit, 'return_border');
    addSpan('Return Kasumbalesa entry', trip.return_border_kasumbalesa_entry, 'Return Kasumbalesa exit', trip.return_border_kasumbalesa_exit, 'return_border');
    addSpan('Return Sakania entry', trip.return_border_sakania_entry, 'Return Sakania exit', trip.return_border_sakania_exit, 'return_border');
    addSpan('Return Mokambo entry', trip.return_border_mokambo_entry, 'Return Mokambo exit', trip.return_border_mokambo_exit, 'return_border');
    addSpan('Return Chembe entry', trip.return_border_chembe_entry, 'Return Chembe exit', trip.return_border_chembe_exit, 'return_border');
    addSpan('Return Kasumulu entry', trip.return_border_kasumulu_entry, 'Return Kasumulu exit', trip.return_border_kasumulu_exit, 'return_border');
    addSpan('Return other border entry', trip.return_border_other_entry, 'Return other border exit', trip.return_border_other_exit, 'return_border');

    addPoint('Return to origin', latestTimestamp([trip.next_dar_entry, trip.trip_closed_at, trip.next_loading_entry]), 'return');

    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return events;
}

function spanDuration(entryTime: string, exitTime: string): string {
    const ms = new Date(exitTime).getTime() - new Date(entryTime).getTime();
    if (ms <= 0) return '';
    return formatHrs(ms / 3_600_000);
}

function FilterSelect({
    label,
    value,
    onChange,
    children,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    children: React.ReactNode;
}) {
    return (
        <label className="flex min-w-[170px] flex-col gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-500/20"
            >
                {children}
            </select>
        </label>
    );
}

function StatusTabButton({
    label,
    count,
    active,
    onClick,
}: {
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                'min-w-[160px] rounded-[22px] border p-4 text-left transition',
                active
                    ? 'border-cyan-400/30 bg-cyan-500/10 shadow-[0_18px_40px_-30px_rgba(34,211,238,0.6)]'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/70'
            )}
        >
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">{label}</div>
            <div className={cn('mt-3 text-2xl font-semibold', active ? 'text-cyan-100' : 'text-white')}>
                {count}
            </div>
        </button>
    );
}

function DetailSection({
    title,
    subtitle,
    aside,
    children,
    className,
}: {
    title: string;
    subtitle?: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn('overflow-hidden rounded-[26px] border border-slate-800/90 bg-slate-950/70', className)}>
            <div className="flex flex-col gap-3 border-b border-slate-800/80 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-white">{title}</h3>
                    {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
                </div>
                {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
            </div>
            <div className="p-5">{children}</div>
        </section>
    );
}

function SummaryMetric({
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

function PhaseMetricCard({
    label,
    description,
    hours,
    scale,
    colorClass,
    icon: Icon,
}: {
    label: string;
    description: string;
    hours: number | null;
    scale: number;
    colorClass: string;
    icon: React.ComponentType<{ className?: string }>;
}) {
    const pct = hours != null && scale > 0 ? Math.max(0, Math.min((hours / scale) * 100, 100)) : 0;
    return (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">{label}</div>
                    <div className="mt-2 text-xl font-semibold text-white">{formatHrs(hours)}</div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-slate-950/80 p-3 text-slate-200">
                    <Icon className="h-4.5 w-4.5" />
                </div>
            </div>
            <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Share of selected trip</span>
                    <span>{formatPercent(pct, 0)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-950">
                    <div className={cn('h-full rounded-full bg-gradient-to-r', colorClass)} style={{ width: `${pct}%` }} />
                </div>
            </div>
        </div>
    );
}

function FilterBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-medium text-cyan-100">
            {label}
            <button onClick={onRemove} className="ml-0.5 text-cyan-200 transition hover:text-white" aria-label={`Remove ${label} filter`}>
                <X className="h-3 w-3" />
            </button>
        </span>
    );
}

function TripListCard({
    trip,
    selected,
    onSelect,
    relativeMaxTat,
}: {
    trip: TripDetail;
    selected: boolean;
    onSelect: () => void;
    relativeMaxTat: number;
}) {
    const statusMeta = getStatusMeta(trip.trip_status);
    const tripTypeMeta = getTripTypeMeta(trip.trip_type);
    const routeLabel = `${getOriginLabel(trip)} → ${getDestinationLabel(trip)}`;
    const progress = trip.total_tat_hrs != null && relativeMaxTat > 0 ? Math.min((trip.total_tat_hrs / relativeMaxTat) * 100, 100) : 0;

    return (
        <button
            onClick={onSelect}
            className={cn(
                'w-full rounded-[22px] border p-4 text-left transition',
                selected
                    ? 'border-cyan-400/30 bg-cyan-500/10 shadow-[0_18px_40px_-30px_rgba(34,211,238,0.55)]'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/70'
            )}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="rounded-2xl border border-white/5 bg-slate-900/80 p-2 text-slate-100">
                            <Truck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{trip.tracker_name}</div>
                            <div className="mt-1 text-[11px] text-slate-500">ID {trip.tracker_id}</div>
                        </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-300">{routeLabel}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-medium', statusMeta.chipClass)}>
                        {statusMeta.label}
                    </span>
                    <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-medium', tripTypeMeta.className)}>
                        {tripTypeMeta.label}
                    </span>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Start</div>
                    <div className="mt-1 text-slate-300">{formatDate(getTripStart(trip))}</div>
                </div>
                <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">End</div>
                    <div className="mt-1 text-slate-300">{formatTripEndValue(trip)}</div>
                </div>
            </div>

            <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Total TAT</span>
                    <span className="font-mono text-slate-200">{formatHrs(trip.total_tat_hrs)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-950">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-500" style={{ width: `${progress}%` }} />
                </div>
            </div>
        </button>
    );
}

export function TripCompletionModal({
    isOpen,
    onClose,
    data,
    loading,
    error,
    onPageChange,
    initialTab = 'completed',
    initialDestination = null,
    initialOrigin = null,
    initialTrackerId = null,
    initialTripType = null,
}: TripCompletionModalProps) {
    if (!isOpen) return null;

    const modalKey = [
        initialTab,
        initialDestination ?? '',
        initialOrigin ?? '',
        initialTrackerId ?? '',
        initialTripType ?? '',
    ].join('|');

    return (
        <TripCompletionModalContent
            key={modalKey}
            isOpen={isOpen}
            onClose={onClose}
            data={data}
            loading={loading}
            error={error}
            onPageChange={onPageChange}
            initialTab={initialTab}
            initialDestination={initialDestination}
            initialOrigin={initialOrigin}
            initialTrackerId={initialTrackerId}
            initialTripType={initialTripType}
        />
    );
}

function TripCompletionModalContent({
    isOpen,
    onClose,
    data,
    loading,
    error,
    onPageChange,
    initialTab = 'completed',
    initialDestination = null,
    initialOrigin = null,
    initialTrackerId = null,
    initialTripType = null,
}: TripCompletionModalProps) {
    const [activeTab, setActiveTab] = useState<ModalTab>(initialTab);
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
    const [detailTab, setDetailTab] = useState<DetailTab>('overview');
    const [originFilter, setOriginFilter] = useState<string>(initialOrigin || ALL_VALUE);
    const [destinationFilter, setDestinationFilter] = useState<string>(initialDestination || ALL_VALUE);
    const [vehicleFilter, setVehicleFilter] = useState<string>(initialTrackerId ? String(initialTrackerId) : ALL_VALUE);
    const [tripTypeFilter, setTripTypeFilter] = useState<string>(initialTripType || ALL_VALUE);
    const [sortBy, setSortBy] = useState<SortMode>('tat_desc');
    const [localSearch, setLocalSearch] = useState('');
    const [allOrigins, setAllOrigins] = useState<string[]>([]);
    const [allDestinations, setAllDestinations] = useState<string[]>([]);
    const [allVehicles, setAllVehicles] = useState<VehicleOption[]>([]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        supabase
            .rpc('get_trip_filter_options')
            .single()
            .then(({ data: payload, error: rpcError }) => {
                if (cancelled || rpcError || !payload) {
                    if (rpcError) console.error('get_trip_filter_options error:', rpcError);
                    return;
                }

                const options = payload as {
                    origins: string[];
                    destinations: string[];
                    vehicles: { tracker_id: number; tracker_name: string; trip_count: number }[];
                };

                setAllOrigins(options.origins ?? []);
                setAllDestinations(options.destinations ?? []);
                setAllVehicles(
                    (options.vehicles ?? []).map(({ tracker_id, tracker_name }) => ({
                        tracker_id,
                        tracker_name,
                    }))
                );
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    function getActiveTrackerId(override?: string): number | null {
        const raw = override !== undefined ? override : vehicleFilter;
        if (raw === ALL_VALUE) return null;
        const parsed = Number.parseInt(raw, 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    function dispatch(
        page: number,
        status: string,
        overrides: {
            sort?: SortMode;
            origin?: string;
            destination?: string;
            vehicle?: string;
            tripType?: string;
        } = {}
    ) {
        const resolvedSort = overrides.sort ?? sortBy;
        const resolvedOrigin = overrides.origin ?? originFilter;
        const resolvedDestination = overrides.destination ?? destinationFilter;
        const resolvedVehicle = overrides.vehicle ?? vehicleFilter;
        const resolvedTripType = overrides.tripType ?? tripTypeFilter;

        onPageChange(
            page,
            status,
            resolvedSort,
            normaliseFilter(resolvedOrigin),
            normaliseFilter(resolvedDestination),
            getActiveTrackerId(resolvedVehicle),
            normaliseFilter(resolvedTripType),
        );
    }

    const handleTabClick = (tab: ModalTab) => {
        setActiveTab(tab);
        setSelectedTripId(null);
        dispatch(0, tab);
    };

    const resetFilters = () => {
        setOriginFilter(ALL_VALUE);
        setDestinationFilter(ALL_VALUE);
        setVehicleFilter(ALL_VALUE);
        setTripTypeFilter(ALL_VALUE);
        setLocalSearch('');
        setSelectedTripId(null);
        dispatch(0, activeTab, {
            origin: ALL_VALUE,
            destination: ALL_VALUE,
            vehicle: ALL_VALUE,
            tripType: ALL_VALUE,
        });
    };

    const searchTerm = localSearch.trim().toLowerCase();
    const trips = useMemo(() => {
        const baseTrips = data?.data ?? [];
        if (!searchTerm) return baseTrips;
        return baseTrips.filter((trip) => {
            const haystack = [
                trip.tracker_name,
                String(trip.tracker_id),
                getOriginLabel(trip),
                getDestinationLabel(trip),
                trip.trip_status,
                trip.trip_type,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(searchTerm);
        });
    }, [data?.data, searchTerm]);

    const effectiveSelectedTripId = useMemo(() => {
        if (trips.length === 0) return null;
        if (selectedTripId && trips.some((trip) => buildTripIdentity(trip) === selectedTripId)) {
            return selectedTripId;
        }
        return buildTripIdentity(trips[0]);
    }, [selectedTripId, trips]);

    const selectedTrip = useMemo(
        () => trips.find((trip) => buildTripIdentity(trip) === effectiveSelectedTripId) || null,
        [effectiveSelectedTripId, trips]
    );

    const currentPage = Math.floor((data?.offset || 0) / (data?.limit || 100));
    const totalCount =
        data?.total_for_active_tab ??
        (activeTab === 'completed'
            ? data?.total_completed || 0
            : activeTab === 'returning'
                ? data?.total_returning || 0
                : activeTab === 'unfinished'
                    ? data?.total_unfinished || 0
                    : activeTab === 'completed_missed_dest'
                        ? data?.total_missed_dest || 0
                        : (data?.total_completed || 0) + (data?.total_returning || 0));
    const totalPages = Math.max(1, Math.ceil(totalCount / (data?.limit || 100)));
    const maxTat = Math.max(...trips.map((trip) => safeNumber(trip.total_tat_hrs)), 1);

    const statusCards = [
        { key: 'completed_or_returning' as const, label: 'Combined', count: (data?.total_completed || 0) + (data?.total_returning || 0) },
        { key: 'completed' as const, label: 'Completed', count: data?.total_completed || 0 },
        { key: 'returning' as const, label: 'Returning', count: data?.total_returning || 0 },
        { key: 'unfinished' as const, label: 'In Progress', count: data?.total_unfinished || 0 },
        { key: 'completed_missed_dest' as const, label: 'Delivered (No Dest)', count: data?.total_missed_dest || 0 },
    ];

    const activeFilterCount =
        Number(originFilter !== ALL_VALUE) +
        Number(destinationFilter !== ALL_VALUE) +
        Number(vehicleFilter !== ALL_VALUE) +
        Number(tripTypeFilter !== ALL_VALUE);

    return (
        <div className="fixed inset-0 z-50 bg-slate-950/82 backdrop-blur-md">
            <div className="mx-auto flex h-full max-w-[1680px] flex-col p-3 sm:p-4">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-800/90 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_30%),linear-gradient(135deg,_rgba(2,6,23,0.98),_rgba(15,23,42,0.96))] shadow-[0_32px_120px_-48px_rgba(15,23,42,0.95)]">
                    <div className="border-b border-slate-800/80 px-5 py-5 sm:px-6">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Trip Investigation Workspace
                                </div>
                                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Lifecycle drilldown powered by the state-stop engine</h2>
                                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                                    Review completed, returning, in-progress, and exception trips with a richer trip list, sharper lifecycle context, and direct raw-geofence inspection.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    {trips.length} loaded / {totalCount} total
                                </span>
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    Page {currentPage + 1} of {totalPages}
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
                            {statusCards.map((card) => (
                                <StatusTabButton
                                    key={card.key}
                                    label={card.label}
                                    count={card.count}
                                    active={activeTab === card.key}
                                    onClick={() => handleTabClick(card.key)}
                                />
                            ))}
                        </div>

                        <div className="mt-5 rounded-[26px] border border-slate-800/90 bg-slate-950/60 p-4">
                            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                                    <label className="lg:col-span-2">
                                        <span className="mb-2 block text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Quick search</span>
                                        <div className="flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 px-4 py-2.5 text-sm text-white">
                                            <Search className="h-4 w-4 text-slate-500" />
                                            <input
                                                value={localSearch}
                                                onChange={(e) => setLocalSearch(e.target.value)}
                                                placeholder="Search tracker, origin, destination, status"
                                                className="w-full bg-transparent outline-none placeholder:text-slate-500"
                                            />
                                        </div>
                                    </label>

                                    <FilterSelect
                                        label="Origin"
                                        value={originFilter}
                                        onChange={(value) => {
                                            setOriginFilter(value);
                                            setSelectedTripId(null);
                                            dispatch(0, activeTab, { origin: value });
                                        }}
                                    >
                                        <option value={ALL_VALUE}>All loading terminals</option>
                                        {allOrigins.map((origin) => (
                                            <option key={origin} value={origin}>{origin}</option>
                                        ))}
                                    </FilterSelect>

                                    <FilterSelect
                                        label="Destination"
                                        value={destinationFilter}
                                        onChange={(value) => {
                                            setDestinationFilter(value);
                                            setSelectedTripId(null);
                                            dispatch(0, activeTab, { destination: value });
                                        }}
                                    >
                                        <option value={ALL_VALUE}>All destinations</option>
                                        {allDestinations.map((destination) => (
                                            <option key={destination} value={destination}>{destination}</option>
                                        ))}
                                    </FilterSelect>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-3">
                                    <FilterSelect
                                        label="Vehicle"
                                        value={vehicleFilter}
                                        onChange={(value) => {
                                            setVehicleFilter(value);
                                            setSelectedTripId(null);
                                            dispatch(0, activeTab, { vehicle: value });
                                        }}
                                    >
                                        <option value={ALL_VALUE}>All vehicles</option>
                                        {allVehicles.map((vehicle) => (
                                            <option key={vehicle.tracker_id} value={String(vehicle.tracker_id)}>
                                                {vehicle.tracker_name}
                                            </option>
                                        ))}
                                    </FilterSelect>

                                    <FilterSelect
                                        label="Trip type"
                                        value={tripTypeFilter}
                                        onChange={(value) => {
                                            setTripTypeFilter(value);
                                            setSelectedTripId(null);
                                            dispatch(0, activeTab, { tripType: value });
                                        }}
                                    >
                                        <option value={ALL_VALUE}>All types</option>
                                        <option value="long_haul">Long Haul</option>
                                        <option value="local_ops">Local Ops</option>
                                        <option value="lpg_delivery">LPG Delivery</option>
                                    </FilterSelect>

                                    <FilterSelect
                                        label="Sort"
                                        value={sortBy}
                                        onChange={(value) => {
                                            const nextSort = value as SortMode;
                                            setSortBy(nextSort);
                                            setSelectedTripId(null);
                                            dispatch(0, activeTab, { sort: nextSort });
                                        }}
                                    >
                                        <option value="tat_desc">Duration ↓</option>
                                        <option value="tat_asc">Duration ↑</option>
                                        <option value="newest">Newest first</option>
                                        <option value="oldest">Oldest first</option>
                                    </FilterSelect>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {originFilter !== ALL_VALUE ? (
                                        <FilterBadge
                                            label={`Origin: ${originFilter}`}
                                            onRemove={() => {
                                                setOriginFilter(ALL_VALUE);
                                                dispatch(0, activeTab, { origin: ALL_VALUE });
                                            }}
                                        />
                                    ) : null}
                                    {destinationFilter !== ALL_VALUE ? (
                                        <FilterBadge
                                            label={`Destination: ${destinationFilter}`}
                                            onRemove={() => {
                                                setDestinationFilter(ALL_VALUE);
                                                dispatch(0, activeTab, { destination: ALL_VALUE });
                                            }}
                                        />
                                    ) : null}
                                    {vehicleFilter !== ALL_VALUE ? (
                                        <FilterBadge
                                            label={`Vehicle: ${allVehicles.find((vehicle) => String(vehicle.tracker_id) === vehicleFilter)?.tracker_name || vehicleFilter}`}
                                            onRemove={() => {
                                                setVehicleFilter(ALL_VALUE);
                                                dispatch(0, activeTab, { vehicle: ALL_VALUE });
                                            }}
                                        />
                                    ) : null}
                                    {tripTypeFilter !== ALL_VALUE ? (
                                        <FilterBadge
                                            label={`Type: ${getTripTypeMeta(tripTypeFilter).label}`}
                                            onRemove={() => {
                                                setTripTypeFilter(ALL_VALUE);
                                                dispatch(0, activeTab, { tripType: ALL_VALUE });
                                            }}
                                        />
                                    ) : null}
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                                        {activeFilterCount} active filters
                                    </span>
                                    <button
                                        onClick={resetFilters}
                                        className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/70 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
                                    >
                                        <Filter className="h-3.5 w-3.5" />
                                        Clear all
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
                        <aside className="min-h-0 border-b border-slate-800/80 xl:border-b-0 xl:border-r">
                            <div className="flex h-full min-h-0 flex-col">
                                <div className="border-b border-slate-800/80 px-5 py-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Trip queue</div>
                                            <h3 className="mt-1 text-lg font-semibold text-white">Loaded trips</h3>
                                        </div>
                                        {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" /> : null}
                                    </div>
                                    <p className="mt-2 text-sm text-slate-400">
                                        Select a trip to open its lifecycle canvas and raw-geofence inspection panel.
                                    </p>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                    {error ? (
                                        <div className="rounded-[22px] border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                                            <div className="flex items-start gap-3">
                                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                                                <div>
                                                    <p className="font-semibold">Failed to load trips</p>
                                                    <p className="mt-1 text-rose-100/85">{error}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ) : loading ? (
                                        <div className="space-y-3">
                                            {Array.from({ length: 6 }).map((_, index) => (
                                                <div key={`modal-list-skeleton-${index}`} className="h-44 animate-pulse rounded-[22px] border border-slate-800 bg-slate-900/60" />
                                            ))}
                                        </div>
                                    ) : trips.length === 0 ? (
                                        <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-700/80 bg-slate-950/40 px-6 text-center">
                                            <Search className="h-6 w-6 text-slate-500" />
                                            <h4 className="mt-4 text-sm font-semibold text-slate-100">No trips match the current view</h4>
                                            <p className="mt-2 text-sm text-slate-400">
                                                Try clearing one or more filters, or broaden the date range from the main dashboard.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {trips.map((trip) => (
                                                <TripListCard
                                                    key={buildTripIdentity(trip)}
                                                    trip={trip}
                                                    selected={effectiveSelectedTripId === buildTripIdentity(trip)}
                                                    onSelect={() => setSelectedTripId(buildTripIdentity(trip))}
                                                    relativeMaxTat={maxTat}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {!loading && !error && totalPages > 1 ? (
                                    <div className="border-t border-slate-800/80 px-5 py-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <button
                                                disabled={currentPage === 0}
                                                onClick={() => {
                                                    setSelectedTripId(null);
                                                    dispatch(currentPage - 1, activeTab);
                                                }}
                                                className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                <ChevronLeft className="h-3.5 w-3.5" />
                                                Previous
                                            </button>
                                            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                                                Page {currentPage + 1} / {totalPages}
                                            </span>
                                            <button
                                                disabled={currentPage >= totalPages - 1}
                                                onClick={() => {
                                                    setSelectedTripId(null);
                                                    dispatch(currentPage + 1, activeTab);
                                                }}
                                                className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                Next
                                                <ChevronRight className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </aside>

                        <main className="min-h-0 overflow-y-auto bg-slate-950/20 p-4 sm:p-5">
                            {selectedTrip ? (
                                <TripDetailPanel
                                    trip={selectedTrip}
                                    detailTab={detailTab}
                                    onDetailTabChange={setDetailTab}
                                />
                            ) : (
                                <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-700/80 bg-slate-950/40 px-8 text-center">
                                    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4 text-slate-300">
                                        <ArrowRight className="h-8 w-8" />
                                    </div>
                                    <h3 className="mt-5 text-lg font-semibold text-white">Select a trip to open the lifecycle canvas</h3>
                                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                                        The right side becomes an investigation workspace with phase timing, milestone chronology, route context, and raw geofence evidence.
                                    </p>
                                </div>
                            )}
                        </main>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TripDetailPanel({
    trip,
    detailTab,
    onDetailTabChange,
}: {
    trip: TripDetail;
    detailTab: DetailTab;
    onDetailTabChange: (tab: DetailTab) => void;
}) {
    const statusMeta = getStatusMeta(trip.trip_status);
    const tripTypeMeta = getTripTypeMeta(trip.trip_type);
    const origin = getOriginLabel(trip);
    const destination = getDestinationLabel(trip);
    const start = getTripStart(trip);
    const tripEndValue = formatTripEndValue(trip);
    const tripEndHelper = getTripEndHelper(trip);
    const milestones = buildChronologicalMilestones(trip);
    const mergedChain = mergeVisitChain(trip.visit_chain || []);
    const phaseMetrics = getPhaseMetrics(trip);
    const scale = Math.max(
        safeNumber(trip.total_tat_hrs),
        ...phaseMetrics.map((metric) => safeNumber(metric.hours)),
        1
    );

    return (
        <div className="space-y-5">
            <section className={cn(
                'overflow-hidden rounded-[28px] border bg-gradient-to-br p-5 sm:p-6',
                statusMeta.surfaceClass
            )}>
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-slate-950/55 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-300">
                            <Sparkles className="h-3.5 w-3.5" />
                            Trip canvas
                        </div>
                        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-white">{trip.tracker_name}</h3>
                        <p className="mt-3 text-base text-slate-200">{origin} <span className="text-slate-500">→</span> {destination}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className={cn('rounded-full border px-3 py-1.5 text-[11px] font-medium', statusMeta.chipClass)}>
                                {statusMeta.label}
                            </span>
                            <span className={cn('rounded-full border px-3 py-1.5 text-[11px] font-medium', tripTypeMeta.className)}>
                                {tripTypeMeta.label}
                            </span>
                            <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                Tracker ID {trip.tracker_id}
                            </span>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
                        <SummaryMetric label="Trip start" value={formatDate(start)} helper="Earliest observed lifecycle anchor." />
                        <SummaryMetric label="Trip end" value={tripEndValue} helper={tripEndHelper} />
                        <SummaryMetric label="Lifecycle milestones" value={String(milestones.length)} helper="Engine-confirmed chronological events." />
                        <SummaryMetric label="Visit chain stops" value={String(mergedChain.length)} helper="Collapsed geofence stops across the trip." />
                    </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <SummaryMetric label="Total TAT" value={formatHrs(trip.total_tat_hrs)} helper="Full measured cycle for this trip." />
                    <SummaryMetric label="Transit" value={formatHrs(trip.transit_hrs)} helper="Pure movement outside loading and borders." />
                    <SummaryMetric label="Border stack" value={formatHrs(phaseMetrics.find((metric) => metric.key === 'border')?.hours ?? null)} helper="All border dwell aggregated." />
                    <SummaryMetric label="Delivery dwell" value={formatHrs(phaseMetrics.find((metric) => metric.key === 'delivery')?.hours ?? null)} helper="Destination or customer unload time." />
                </div>
            </section>

            <div className="inline-flex rounded-2xl border border-slate-800/90 bg-slate-950/70 p-1">
                <button
                    onClick={() => onDetailTabChange('overview')}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
                        detailTab === 'overview'
                            ? 'bg-slate-800 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                    )}
                >
                    <Layers3 className="h-4 w-4" />
                    Engine Overview
                </button>
                <button
                    onClick={() => onDetailTabChange('raw_data')}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
                        detailTab === 'raw_data'
                            ? 'bg-slate-800 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                    )}
                >
                    <ClipboardList className="h-4 w-4" />
                    Raw Geofence
                </button>
            </div>

            {detailTab === 'overview' ? (
                <OverviewTab trip={trip} phaseMetrics={phaseMetrics} scale={scale} milestones={milestones} mergedChain={mergedChain} />
            ) : (
                <RawDataTab trip={trip} />
            )}
        </div>
    );
}

function OverviewTab({
    trip,
    phaseMetrics,
    scale,
    milestones,
    mergedChain,
}: {
    trip: TripDetail;
    phaseMetrics: ReturnType<typeof getPhaseMetrics>;
    scale: number;
    milestones: MilestoneEvent[];
    mergedChain: TripVisit[];
}) {
    const routeStart = trip.dar_arrival || trip.loading_start || trip.kurasini_entry || trip.departure_time;
    const routeEnd = getTripEnd(trip) || new Date().toISOString();
    const returnAnchor = getTripEnd(trip);
    const returnAnchorValue = returnAnchor ? formatDate(returnAnchor) : 'Pending';
    const returnAnchorHelper = returnAnchor
        ? 'Latest return-to-origin or closure timestamp used by the engine.'
        : 'No return-to-origin or closure anchor has been confirmed yet.';

    return (
        <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                <DetailSection
                    title="Phase profile"
                    subtitle="Selected trip timing broken down into engine-visible lifecycle segments."
                    aside={
                        <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                            Scale: {formatHrs(scale)}
                        </span>
                    }
                >
                    <div className="grid gap-4 md:grid-cols-2">
                        {phaseMetrics.map((metric) => (
                            <PhaseMetricCard
                                key={metric.key}
                                label={metric.label}
                                description={metric.description}
                                hours={metric.hours}
                                scale={scale}
                                colorClass={metric.colorClass}
                                icon={metric.icon}
                            />
                        ))}
                    </div>
                </DetailSection>

                <DetailSection
                    title="Engine snapshot"
                    subtitle="High-confidence identifiers and anchors for the selected trip."
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <SummaryMetric label="Origin terminal" value={getOriginLabel(trip)} helper="Primary loading or origin domain associated with this trip." />
                        <SummaryMetric label="Destination" value={getDestinationLabel(trip)} helper="Customer depot preferred when available; otherwise destination name." />
                        <SummaryMetric label="Customer anchor" value={formatDate(trip.customer_entry || trip.dest_entry)} helper="Arrival at the delivery-side anchor." />
                        <SummaryMetric label="Return anchor" value={returnAnchorValue} helper={returnAnchorHelper} />
                    </div>
                </DetailSection>
            </div>

            <DetailSection
                title="Lifecycle milestones"
                subtitle="Chronological state-stop anchors used to understand how the trip progressed end to end."
                aside={
                    <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                        {milestones.length} milestones
                    </span>
                }
            >
                <MilestoneRail milestones={milestones} />
            </DetailSection>

            <DetailSection
                title="Route map"
                subtitle="Full-frame spatial playback for the selected lifecycle window, tuned for route analysis and replay."
                className="xl:min-h-[760px]"
            >
                <TripRouteMap
                    trackerId={trip.tracker_id}
                    startTime={routeStart}
                    endTime={routeEnd}
                    visitChain={trip.visit_chain}
                />
            </DetailSection>

            <DetailSection
                title={`Visit chain (${mergedChain.length} stops)`}
                subtitle="Collapsed geofence sequence after broad-visit suppression and overlap cleanup."
            >
                {trip.visit_chain && trip.visit_chain.length > 0 ? (
                    <TripTimeline visitChain={trip.visit_chain} />
                ) : (
                    <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 text-sm text-slate-400">
                        No visit chain available for this trip.
                    </div>
                )}
            </DetailSection>
        </div>
    );
}

function MilestoneRail({ milestones }: { milestones: MilestoneEvent[] }) {
    if (milestones.length === 0) {
        return (
            <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 text-sm text-slate-400">
                No milestone timestamps recorded for this trip.
            </div>
        );
    }

    return (
        <div className="relative pl-9">
            <div className="absolute left-3 top-3 bottom-3 w-px bg-gradient-to-b from-cyan-400/40 via-slate-700 to-transparent" />
            <div className="space-y-5">
                {milestones.map((event, index) => {
                    const category = CATEGORY_META[event.category];
                    let duration: string | null = null;
                    if (event.kind === 'span_start') {
                        const labelRoot = event.label.replace(' entry', '').replace(' start', '');
                        const nextMatch = milestones.find((candidate, candidateIndex) =>
                            candidateIndex > index &&
                            candidate.kind === 'span_end' &&
                            candidate.label.replace(' exit', '').replace(' end', '') === labelRoot
                        );
                        if (nextMatch) duration = spanDuration(event.time, nextMatch.time);
                    }

                    return (
                        <div key={`${event.label}-${index}`} className="relative">
                            <div className={cn('absolute -left-9 top-1.5 h-6 w-6 rounded-full border border-slate-800 shadow-[0_0_0_4px_rgba(2,6,23,0.88)]', category.dotClass)} />
                            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={cn('rounded-full border border-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]', category.textClass)}>
                                                {category.label}
                                            </span>
                                            {duration ? (
                                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300">
                                                    {duration}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className={cn('mt-3 text-sm font-semibold', category.textClass)}>{event.label}</div>
                                        <div className="mt-1 text-xs text-slate-400">{formatDate(event.time)}</div>
                                    </div>
                                    <div className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
                                        {event.kind === 'span_start' ? 'entry' : event.kind === 'span_end' ? 'exit' : 'point'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function RawDataTab({ trip }: { trip: TripDetail }) {
    const [rows, setRows] = useState<RawGeofenceVisit[]>([]);
    const [loadingRows, setLoadingRows] = useState(false);
    const [rowsError, setRowsError] = useState<string | null>(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
    const [copyStatus, setCopyStatus] = useState<string | null>(null);
    const nowFallbackRef = useRef<string>(new Date().toISOString());

    useEffect(() => {
        nowFallbackRef.current = new Date().toISOString();
    }, [trip.tracker_id, trip.loading_start, trip.departure_time]);

    const startTime = earliestTimestamp([trip.dar_arrival, trip.loading_start, trip.departure_time]);
    const endTime = getTripEnd(trip) || nowFallbackRef.current;

    useEffect(() => {
        let cancelled = false;

        async function run() {
            if (!trip?.tracker_id || !startTime || !endTime) {
                setRows([]);
                setRowsError('Unable to determine trip window for raw-geofence fetch.');
                return;
            }

            setLoadingRows(true);
            setRowsError(null);

            try {
                const params = new URLSearchParams({
                    trackerId: String(trip.tracker_id),
                    start: startTime,
                    end: endTime,
                    limit: '3000',
                });

                const res = await fetch(`/api/tat/v2/raw-geofence?${params.toString()}`);
                const payload = await res.json();

                if (!res.ok || payload?.success === false) {
                    throw new Error(payload?.error || `Request failed with status ${res.status}`);
                }

                const data = Array.isArray(payload?.data) ? payload.data : [];
                if (!cancelled) setRows(data as RawGeofenceVisit[]);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to load raw geofence rows.';
                if (!cancelled) {
                    setRows([]);
                    setRowsError(message);
                }
            } finally {
                if (!cancelled) setLoadingRows(false);
            }
        }

        run();
        return () => {
            cancelled = true;
        };
    }, [endTime, startTime, trip.tracker_id]);

    useEffect(() => {
        setSelectedRowKeys(new Set());
        setCopyStatus(null);
    }, [trip.tracker_id, startTime, endTime]);

    useEffect(() => {
        if (!copyStatus) return;
        const timeout = window.setTimeout(() => setCopyStatus(null), 2000);
        return () => window.clearTimeout(timeout);
    }, [copyStatus]);

    const buildRowKey = (visit: RawGeofenceVisit) => `${visit.id}|${visit.in_time_dt}|${visit.out_time_dt || 'null'}`;
    const allRowKeys = rows.map(buildRowKey);
    const selectedCount = selectedRowKeys.size;
    const allSelected = rows.length > 0 && allRowKeys.every((key) => selectedRowKeys.has(key));

    const toggleAll = () => {
        if (allSelected) {
            setSelectedRowKeys(new Set());
            return;
        }
        setSelectedRowKeys(new Set(allRowKeys));
    };

    const toggleRow = (key: string) => {
        setSelectedRowKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleCopyJson = async () => {
        if (rows.length === 0) return;
        const selectedRows = selectedRowKeys.size > 0
            ? rows.filter((row) => selectedRowKeys.has(buildRowKey(row)))
            : rows;

        const payload = {
            tracker_id: trip.tracker_id,
            window_start: startTime,
            window_end: endTime,
            selected_rows: selectedRows.length,
            rows: selectedRows,
        };

        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            setCopyStatus(`Copied ${selectedRows.length} row(s)`);
        } catch {
            setCopyStatus('Copy failed');
        }
    };

    const midnightSplitCount = rows.filter((visit) => {
        const inClock = timeOfDayUTC(visit.in_time_dt);
        const outClock = timeOfDayUTC(visit.out_time_dt);
        return inClock === '00:00:00' || outClock === '23:59:59' || outClock === '00:00:00';
    }).length;
    const openVisits = rows.filter((visit) => !visit.out_time_dt).length;

    return (
        <div className="space-y-5">
            <DetailSection
                title="Raw geofence evidence"
                subtitle="Database rows overlapping the selected trip window for this tracker."
                aside={
                    <div className="flex flex-wrap items-center gap-2">
                        {copyStatus ? (
                            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100">
                                {copyStatus}
                            </span>
                        ) : null}
                        <button
                            onClick={handleCopyJson}
                            disabled={loadingRows || rows.length === 0}
                            className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <ClipboardList className="h-3.5 w-3.5" />
                            Copy JSON
                        </button>
                    </div>
                }
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <SummaryMetric label="Window start" value={formatDate(startTime)} helper="Earliest timestamp used for raw overlap fetch." />
                    <SummaryMetric label="Window end" value={formatDate(endTime)} helper="Latest timestamp used for raw overlap fetch." />
                    <SummaryMetric label="Loaded rows" value={String(rows.length)} helper="Raw geofence records returned for the window." />
                    <SummaryMetric label="Selected rows" value={String(selectedCount)} helper="Rows marked for JSON copy; all rows copy when selection is empty." />
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <SummaryMetric label="Midnight splits" value={String(midnightSplitCount)} helper="Rows likely created by day-boundary visit splitting." />
                    <SummaryMetric label="Open visits" value={String(openVisits)} helper="Rows without an exit timestamp at query time." />
                    <SummaryMetric label="Tracker" value={`${trip.tracker_id}`} helper={trip.tracker_name} />
                </div>
            </DetailSection>

            <DetailSection
                title="Raw geofence table"
                subtitle="Selectable row-level evidence with overlap, dwell, and source-file context."
                aside={
                    <label className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                        <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            disabled={rows.length === 0 || loadingRows}
                            className="h-3.5 w-3.5 accent-cyan-400"
                        />
                        Select all
                    </label>
                }
            >
                <div className="overflow-hidden rounded-[22px] border border-slate-800/90 bg-slate-950/55">
                    <div className="max-h-[62vh] overflow-x-auto overflow-y-auto">
                        <table className="w-full min-w-[1080px] text-left">
                            <thead className="sticky top-0 z-10 bg-slate-950/95 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                <tr>
                                    <th className="px-4 py-3">Pick</th>
                                    <th className="px-4 py-3">#</th>
                                    <th className="px-4 py-3">Geofence</th>
                                    <th className="px-4 py-3">Zone</th>
                                    <th className="px-4 py-3">Entry</th>
                                    <th className="px-4 py-3">Exit</th>
                                    <th className="px-4 py-3">Midnight split</th>
                                    <th className="px-4 py-3 text-right">Dwell</th>
                                    <th className="px-4 py-3">Source file</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/80">
                                {rowsError ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-8 text-center text-sm text-rose-200">
                                            Failed to load raw rows: {rowsError}
                                        </td>
                                    </tr>
                                ) : null}

                                {loadingRows && !rowsError ? (
                                    Array.from({ length: 6 }).map((_, index) => (
                                        <tr key={`raw-skeleton-${index}`} className="animate-pulse">
                                            <td colSpan={9} className="h-14 bg-slate-900/45 px-4 py-3" />
                                        </tr>
                                    ))
                                ) : null}

                                {!loadingRows && !rowsError && rows.map((visit, index) => {
                                    const rowKey = buildRowKey(visit);
                                    const isSelected = selectedRowKeys.has(rowKey);
                                    const inClock = timeOfDayUTC(visit.in_time_dt);
                                    const outClock = timeOfDayUTC(visit.out_time_dt);
                                    const midnightSplit =
                                        inClock === '00:00:00' ||
                                        outClock === '23:59:59' ||
                                        outClock === '00:00:00';

                                    return (
                                        <tr
                                            key={`${rowKey}-${index}`}
                                            className={cn(
                                                'transition hover:bg-slate-900/75',
                                                midnightSplit ? 'bg-yellow-500/5' : '',
                                                isSelected ? 'bg-cyan-500/10' : ''
                                            )}
                                        >
                                            <td className="px-4 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleRow(rowKey)}
                                                    className="h-3.5 w-3.5 accent-cyan-400"
                                                    aria-label={`Select raw row ${index + 1}`}
                                                />
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-500">{index + 1}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-slate-200">{visit.geofence_name || '--'}</td>
                                            <td className="px-4 py-3 text-sm text-slate-400">{visit.zone_name || '--'}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-300">{formatDate(visit.in_time_dt)}</td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-300">{formatDate(visit.out_time_dt)}</td>
                                            <td className="px-4 py-3">
                                                <span className={cn(
                                                    'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                                                    midnightSplit
                                                        ? 'border-yellow-400/20 bg-yellow-500/10 text-yellow-100'
                                                        : 'border-slate-700/80 bg-slate-900/70 text-slate-300'
                                                )}>
                                                    {midnightSplit ? 'yes' : 'no'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-sm text-slate-200">{durationFromSeconds(visit.duration_seconds)}</td>
                                            <td className="max-w-[280px] truncate px-4 py-3 text-xs text-slate-500" title={visit.source_file || ''}>
                                                {visit.source_file || '--'}
                                            </td>
                                        </tr>
                                    );
                                })}

                                {!loadingRows && !rowsError && rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                                            No raw geofence rows found for this tracker and trip window.
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </div>
            </DetailSection>
        </div>
    );
}
