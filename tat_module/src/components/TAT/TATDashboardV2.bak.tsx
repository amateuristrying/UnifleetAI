'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Activity,
    ArrowRight,
    Calendar,
    CircleAlert,
    Clock3,
    Crosshair,
    Database,
    Gauge,
    Layers3,
    LoaderCircle,
    MapPinned,
    Route,
    ShieldAlert,
    Sparkles,
    Target,
    TrendingDown,
    TrendingUp,
    Truck,
    Waypoints,
} from 'lucide-react';
import {
    Area,
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
    ActiveTripQueuesModule,
    type ActiveQueueCounts,
    type ActiveQueuePayload,
    type ActiveQueueStatus,
} from './ActiveTripQueuesModule';
import {
    CompletedTripFactsModule,
    type CompletedFactRow,
    type CompletedFactsPayload,
} from './CompletedTripFactsModule';
import { TripCompletionModal } from './TripCompletionModal';

const UNMATCHED_ORPHAN_GAP_HOURS = 0;

type ModalStatus =
    | 'completed'
    | 'returning'
    | 'unfinished'
    | 'completed_or_returning'
    | 'completed_missed_dest';

type Tone = 'neutral' | 'good' | 'warning' | 'critical';

interface VisitEvent {
    geofence_name: string;
    in_time: string;
    out_time: string | null;
    event_type: 'loading' | 'unloading' | 'border' | 'transit';
}

interface V2Counts {
    total_completed: number;
    total_returning: number;
    total_unfinished: number;
    total_missed_dest: number;
}

interface TimelineEvent {
    event_code?: string;
    event_time?: string;
    canonical_name?: string;
    role_code?: string;
    trip_stage?: string;
    stop_state?: string;
}

interface BorderCrossing {
    border_code?: string;
    border_name?: string;
    entry_time?: string;
    exit_time?: string;
}

interface V2TripRow {
    [key: string]: unknown;
    tracker_id: number;
    tracker_name: string;
    trip_status?: string;
    status?: string;
    closure_reason?: string | null;
    trip_closure_reason?: string | null;
    trip_type?: string;
    loading_terminal?: string | null;
    origin_region?: string | null;
    destination_name?: string | null;
    dest_name?: string | null;
    customer_name?: string | null;
    dar_arrival?: string | null;
    origin_arrival?: string | null;
    origin_exit?: string | null;
    dar_exit?: string | null;
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
    source_completion_time?: string | null;
    source_trip_closed_at?: string | null;
    source_next_dar_entry?: string | null;
    source_next_loading_entry?: string | null;
    active_queue_status?: ActiveQueueStatus | null;
    missed_destination?: boolean;
    visit_chain?: VisitEvent[];
    timeline?: TimelineEvent[];
    border_crossings?: BorderCrossing[];
    destination_dwell_hrs?: number | null;
    dest_dwell_hrs?: number | null;
    drc_region_hrs?: number | null;
}

interface DestinationSummaryRow {
    location: string;
    unique_trackers: number;
    trip_count: number;
    avg_tat_days: number;
}

interface BorderTrendRow {
    day_date: string;
    avg_wait_hours: number;
    truck_count: number;
}

interface TripDetailsPayload {
    total_completed: number;
    total_returning: number;
    total_unfinished: number;
    total_missed_dest: number;
    limit: number;
    offset: number;
    data: V2TripRow[];
    total_for_active_tab?: number;
}

interface CompletedFactsScope {
    start: string;
    end: string;
    destination: string | null;
}

interface UncoveredTrackerRow {
    tracker_id: number;
    tracker_name: string;
    fact_trip_count: number;
    fact_completed_count: number;
    fact_returning_count: number;
    fact_unfinished_count: number;
    uncovered_trip_count: number;
    uncovered_raw_geofence_rows: number;
    uncovered_major_state_rows: number;
    uncovered_distinct_geofences: number;
    uncovered_total_hours: number;
    waiting_stage_rows: number;
    waiting_stage_hours: number;
    open_geofence_rows: number;
    first_uncovered_trip_start_utc: string | null;
    last_uncovered_trip_end_utc: string | null;
    uncovered_vs_fact_pct: number | null;
}

interface UncoveredTripsPayload {
    start_date: string | null;
    end_date: string | null;
    orphan_gap_hours: number;
    detection_mode?: string | null;
    visit_source?: string | null;
    waiting_stage_definition?: string | null;
    total_fact_trips: number;
    total_fact_trackers: number;
    total_uncovered_trips: number;
    total_uncovered_trackers: number;
    total_uncovered_hours: number;
    total_waiting_stage_rows: number;
    total_waiting_stage_hours: number;
    total_uncovered_raw_geofence_rows: number;
    total_uncovered_major_state_rows: number;
    uncovered_vs_fact_pct: number | null;
    trackers: UncoveredTrackerRow[];
}

interface TrackerFactTripRow {
    trip_key: string;
    trip_status: string;
    loading_terminal: string | null;
    destination_name: string | null;
    trip_start_utc: string | null;
    trip_end_utc: string | null;
    trip_duration_hours: number | null;
}

interface TrackerUncoveredTripRow {
    trip_key: string;
    trip_start_utc: string | null;
    trip_end_utc: string | null;
    trip_duration_hours: number | null;
    trip_raw_geofence_rows: number;
    trip_distinct_geofences: number;
    open_geofence_rows: number;
    trip_last_geofence_name: string | null;
    trip_stop_states: string[];
}

interface TrackerInspectorDetailPayload {
    tracker_id: number;
    tracker_name: string;
    fact_trip_count: number;
    uncovered_trip_count: number;
    fact_trips: TrackerFactTripRow[];
    uncovered_trips: TrackerUncoveredTripRow[];
}

interface KPIStatsShape {
    avg_waiting_hrs: number;
    avg_transit_to_load_hrs: number;
    avg_loading_hrs: number;
    avg_border_hrs: number;
    avg_offloading_hrs: number;
    trip_completion_rate: number;
    trips_departed: number;
    trips_completed: number;
}

interface OverviewMetric {
    label: string;
    value: string;
    helper: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
}

interface StageMetric {
    id: string;
    label: string;
    subtitle: string;
    value: number;
    share: number;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
    accentClass: string;
    meterClass: string;
}

interface InsightMetric {
    title: string;
    value: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
}

interface BorderSignal {
    key: string;
    title: string;
    subtitle: string;
    data: BorderTrendRow[];
    avgWaitHours: number;
    latestWaitHours: number | null;
    peakWaitHours: number;
    totalTrucks: number;
    avgTrucks: number;
    deltaPct: number | null;
    tone: Tone;
}

function normaliseFilter(value: string | null | undefined): string | null {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower === 'all' || lower.startsWith('all ')) return null;
    return value;
}

function safeNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function hasTimestamp(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasOpenBorderCrossing(row: V2TripRow): boolean {
    const borderCrossings = Array.isArray(row?.border_crossings) ? row.border_crossings : [];
    if (borderCrossings.some((crossing) => hasTimestamp(crossing?.entry_time) && !hasTimestamp(crossing?.exit_time))) {
        return true;
    }

    const rawRow = row as Record<string, unknown>;
    return Object.entries(rawRow).some(([key, value]) => {
        if (!key.includes('border') || !key.endsWith('_entry') || key.endsWith('_hrs')) return false;
        if (!hasTimestamp(value)) return false;
        const exitKey = key.replace(/_entry$/, '_exit');
        return !hasTimestamp(rawRow[exitKey]);
    });
}

function isAwaitingUnloading(row: V2TripRow): boolean {
    if (hasTimestamp(row?.customer_entry) && !hasTimestamp(row?.customer_exit)) return true;
    return hasTimestamp(row?.dest_entry) && !hasTimestamp(row?.dest_exit) && !hasTimestamp(row?.customer_entry);
}

function hasDeliveryExit(row: V2TripRow): boolean {
    return hasTimestamp(row?.customer_exit) || hasTimestamp(row?.dest_exit);
}

function hasCompletionAnchor(row: V2TripRow): boolean {
    return hasTimestamp(row?.source_completion_time) || hasTimestamp(row?.source_trip_closed_at);
}

function hasNextLoadingAnchor(row: V2TripRow): boolean {
    return hasTimestamp(row?.source_next_loading_entry) || hasTimestamp(row?.next_loading_entry);
}

function getActiveQueueStatus(row: V2TripRow): Exclude<ActiveQueueStatus, 'active_all'> | null {
    if (hasNextLoadingAnchor(row)) return null;
    if (hasTimestamp(row?.loading_start) && !hasTimestamp(row?.loading_end)) return 'active_loading_started';
    if (isAwaitingUnloading(row)) return 'active_awaiting_unloading';
    if (hasOpenBorderCrossing(row)) return 'active_at_border';
    if (hasDeliveryExit(row) && !hasCompletionAnchor(row)) return 'active_just_delivered';
    if (hasCompletionAnchor(row)) return 'active_waiting_next_load';
    if (hasTimestamp(row?.loading_end)) return 'active_loading_completed';
    return null;
}

function isOperationallyActive(row: V2TripRow): boolean {
    if (getActiveQueueStatus(row)) return true;
    const status = String(row?.trip_status || '').toLowerCase();
    return (
        !hasNextLoadingAnchor(row) &&
        (status === 'loading' || status === 'pre_transit' || status === 'in_transit' || status === 'at_destination')
    );
}

function buildActiveQueueCounts(rows: V2TripRow[]): ActiveQueueCounts {
    const counts: ActiveQueueCounts = {
        active_all: 0,
        active_just_delivered: 0,
        active_loading_started: 0,
        active_loading_completed: 0,
        active_at_border: 0,
        active_awaiting_unloading: 0,
        active_waiting_next_load: 0,
    };

    for (const row of rows) {
        if (isOperationallyActive(row)) counts.active_all += 1;
        const queue = getActiveQueueStatus(row);
        if (queue) counts[queue] += 1;
    }

    return counts;
}

function describeSupabaseError(error: unknown, fallback: string): string {
    if (!error) return fallback;
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error || fallback;
    if (typeof error === 'object') {
        const err = error as Record<string, unknown>;
        const message = typeof err.message === 'string' ? err.message : '';
        const details = typeof err.details === 'string' ? err.details : '';
        const hint = typeof err.hint === 'string' ? err.hint : '';
        const code = typeof err.code === 'string' ? err.code : '';
        const raw = typeof err.raw === 'string' ? err.raw : '';
        const combined = [message, details, hint, code, raw].filter(Boolean).join(' | ');
        if (combined) return combined;
        const keys = Object.keys(err);
        if (keys.length === 0) return fallback;
        try {
            const asJson = JSON.stringify(err);
            return asJson === '{}' ? fallback : asJson;
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function toUtcDayStart(dateValue: string): string {
    const dt = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return dateValue;
    return dt.toISOString();
}

function toUtcDayEndExclusive(dateValue: string): string {
    const dt = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return dateValue;
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString();
}

function escapePostgrestLiteral(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function escapePostgrestLike(value: string): string {
    return escapePostgrestLiteral(value)
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

function formatUtcDate(value: string | null | undefined): string {
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
    return `${Number(value).toFixed(2)}h`;
}

function formatPercent(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${Number(value).toFixed(digits)}%`;
}

function formatCompactNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDays(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${Number(value).toFixed(1)}d`;
}

function formatDateChip(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GB', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    });
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function toneStyles(tone: Tone): { badge: string; icon: string; surface: string; border: string; text: string } {
    switch (tone) {
        case 'good':
            return {
                badge: 'bg-emerald-500/12 text-emerald-200 border-emerald-400/20',
                icon: 'text-emerald-300 bg-emerald-500/12',
                surface: 'from-emerald-500/16 via-emerald-500/6 to-transparent',
                border: 'border-emerald-400/18',
                text: 'text-emerald-200',
            };
        case 'warning':
            return {
                badge: 'bg-amber-500/12 text-amber-100 border-amber-400/20',
                icon: 'text-amber-200 bg-amber-500/12',
                surface: 'from-amber-500/16 via-amber-500/6 to-transparent',
                border: 'border-amber-400/18',
                text: 'text-amber-100',
            };
        case 'critical':
            return {
                badge: 'bg-rose-500/12 text-rose-100 border-rose-400/20',
                icon: 'text-rose-200 bg-rose-500/12',
                surface: 'from-rose-500/16 via-rose-500/6 to-transparent',
                border: 'border-rose-400/18',
                text: 'text-rose-100',
            };
        default:
            return {
                badge: 'bg-sky-500/12 text-sky-100 border-sky-400/20',
                icon: 'text-sky-200 bg-sky-500/12',
                surface: 'from-sky-500/16 via-sky-500/6 to-transparent',
                border: 'border-slate-700/80',
                text: 'text-slate-100',
            };
    }
}

function borderTone(avgWaitHours: number, peakWaitHours: number): Tone {
    if (avgWaitHours >= 18 || peakWaitHours >= 30) return 'critical';
    if (avgWaitHours >= 10 || peakWaitHours >= 18) return 'warning';
    return 'good';
}

function adaptUncoveredPayload(raw: unknown): UncoveredTripsPayload {
    const payload = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const trackersRaw = Array.isArray(payload.trackers) ? payload.trackers : [];

    return {
        start_date: typeof payload.start_date === 'string' ? payload.start_date : null,
        end_date: typeof payload.end_date === 'string' ? payload.end_date : null,
        orphan_gap_hours: safeNumber(payload.orphan_gap_hours, UNMATCHED_ORPHAN_GAP_HOURS),
        detection_mode: typeof payload.detection_mode === 'string' ? payload.detection_mode : null,
        visit_source: typeof payload.visit_source === 'string' ? payload.visit_source : null,
        waiting_stage_definition: typeof payload.waiting_stage_definition === 'string' ? payload.waiting_stage_definition : null,
        total_fact_trips: safeNumber(payload.total_fact_trips),
        total_fact_trackers: safeNumber(payload.total_fact_trackers),
        total_uncovered_trips: safeNumber(payload.total_uncovered_trips),
        total_uncovered_trackers: safeNumber(payload.total_uncovered_trackers),
        total_uncovered_hours: safeNumber(payload.total_uncovered_hours),
        total_waiting_stage_rows: safeNumber(payload.total_waiting_stage_rows),
        total_waiting_stage_hours: safeNumber(payload.total_waiting_stage_hours),
        total_uncovered_raw_geofence_rows: safeNumber(payload.total_uncovered_raw_geofence_rows),
        total_uncovered_major_state_rows: safeNumber(payload.total_uncovered_major_state_rows),
        uncovered_vs_fact_pct:
            payload.uncovered_vs_fact_pct == null ? null : safeNumber(payload.uncovered_vs_fact_pct),
        trackers: trackersRaw.map((row) => {
            const item = (row && typeof row === 'object') ? row as Record<string, unknown> : {};
            return {
                tracker_id: safeNumber(item.tracker_id),
                tracker_name: String(item.tracker_name || '(unknown)'),
                fact_trip_count: safeNumber(item.fact_trip_count),
                fact_completed_count: safeNumber(item.fact_completed_count),
                fact_returning_count: safeNumber(item.fact_returning_count),
                fact_unfinished_count: safeNumber(item.fact_unfinished_count),
                uncovered_trip_count: safeNumber(item.uncovered_trip_count),
                uncovered_raw_geofence_rows: safeNumber(item.uncovered_raw_geofence_rows),
                uncovered_major_state_rows: safeNumber(item.uncovered_major_state_rows),
                uncovered_distinct_geofences: safeNumber(item.uncovered_distinct_geofences),
                uncovered_total_hours: safeNumber(item.uncovered_total_hours),
                waiting_stage_rows: safeNumber(item.waiting_stage_rows),
                waiting_stage_hours: safeNumber(item.waiting_stage_hours),
                open_geofence_rows: safeNumber(item.open_geofence_rows),
                first_uncovered_trip_start_utc: typeof item.first_uncovered_trip_start_utc === 'string' ? item.first_uncovered_trip_start_utc : null,
                last_uncovered_trip_end_utc: typeof item.last_uncovered_trip_end_utc === 'string' ? item.last_uncovered_trip_end_utc : null,
                uncovered_vs_fact_pct:
                    item.uncovered_vs_fact_pct == null ? null : safeNumber(item.uncovered_vs_fact_pct),
            };
        }),
    };
}

function sortByInTime(a: VisitEvent, b: VisitEvent): number {
    const ta = new Date(a.in_time).getTime();
    const tb = new Date(b.in_time).getTime();
    return ta - tb;
}

function pushVisit(
    list: VisitEvent[],
    geofenceName: string | null | undefined,
    inTime: string | null | undefined,
    outTime: string | null | undefined,
    eventType: VisitEvent['event_type']
) {
    if (!inTime || !geofenceName) return;
    list.push({
        geofence_name: geofenceName,
        in_time: inTime,
        out_time: outTime || null,
        event_type: eventType,
    });
}

function inferTimelineEventType(evt: TimelineEvent): VisitEvent['event_type'] {
    const code = String(evt?.event_code || '').toLowerCase();
    const role = String(evt?.role_code || '').toLowerCase();
    const stage = String(evt?.trip_stage || '').toLowerCase();
    const stopState = String(evt?.stop_state || '').toLowerCase();

    if (
        stopState === 'origin_loading_stop' ||
        stopState === 'operational_stop' ||
        stopState === 'origin_operational_stop' ||
        stopState === 'origin_region_presence'
    ) return 'loading';
    if (stopState === 'destination_stop' || stopState === 'destination_region_presence') return 'unloading';
    if (stopState === 'border_crossing') return 'border';
    if (stopState === 'corridor_transit' || stopState === 'customs_stop' || stopState === 'return_transit') return 'transit';

    if (code.includes('loading') || stage === 'loading' || stage === 'pre_transit') return 'loading';
    if (code.includes('destination') || code.includes('customer') || stage === 'at_destination') return 'unloading';
    if (code.includes('border') || role.includes('border')) return 'border';
    return 'transit';
}

function timelineToVisitChain(timeline: TimelineEvent[]): VisitEvent[] {
    const rows = Array.isArray(timeline) ? timeline : [];
    const visits: VisitEvent[] = rows
        .filter((evt): evt is TimelineEvent & { event_time: string } =>
            typeof evt?.event_time === 'string' && evt.event_time.length > 0
        )
        .map((evt) => ({
            geofence_name: evt?.canonical_name || evt?.event_code || 'Unknown Event',
            in_time: evt.event_time,
            out_time: null,
            event_type: inferTimelineEventType(evt),
        }))
        .sort(sortByInTime);

    return visits;
}

function buildVisitChainFromV2Row(row: V2TripRow): VisitEvent[] {
    if (Array.isArray(row?.visit_chain) && row.visit_chain.length > 0) {
        return row.visit_chain;
    }

    const visits: VisitEvent[] = [];

    pushVisit(
        visits,
        row?.loading_terminal || 'Loading Terminal',
        row?.loading_start,
        row?.loading_end,
        'loading'
    );
    pushVisit(
        visits,
        row?.origin_region || 'Origin Gateway',
        row?.dar_arrival || row?.origin_arrival,
        row?.origin_exit || row?.dar_exit,
        'transit'
    );

    const borderCrossings = Array.isArray(row?.border_crossings) ? row.border_crossings : [];
    for (const bc of borderCrossings) {
        pushVisit(
            visits,
            bc?.border_name || bc?.border_code || 'Border',
            bc?.entry_time || bc?.exit_time,
            bc?.exit_time || null,
            'border'
        );
    }

    pushVisit(
        visits,
        row?.destination_name || row?.dest_name || 'Destination',
        row?.dest_entry,
        row?.dest_exit,
        'unloading'
    );
    pushVisit(
        visits,
        row?.customer_name || null,
        row?.customer_entry,
        row?.customer_exit,
        'unloading'
    );

    pushVisit(
        visits,
        'Return to Origin',
        row?.next_dar_entry || row?.trip_closed_at || row?.next_loading_entry,
        row?.next_dar_entry || row?.trip_closed_at || row?.next_loading_entry,
        'transit'
    );

    if (visits.length > 0) return visits.sort(sortByInTime);
    return timelineToVisitChain(row?.timeline || []);
}

function adaptV2TripRow(raw: V2TripRow): V2TripRow {
    const status = raw?.trip_status || raw?.status || 'loading';
    const destinationName = raw?.destination_name || raw?.dest_name || null;
    const deliveryCompletionTime = raw?.completion_time || null;
    const lifecycleEndTime =
        raw?.trip_closed_at ||
        raw?.next_dar_entry ||
        raw?.next_loading_entry ||
        deliveryCompletionTime ||
        null;

    return {
        ...raw,
        trip_status: status,
        status,
        trip_closure_reason: raw?.trip_closure_reason || raw?.closure_reason || null,
        closure_reason: raw?.trip_closure_reason || raw?.closure_reason || null,
        departure_time: raw?.departure_time || raw?.dar_arrival || raw?.loading_start || lifecycleEndTime,
        dar_arrival: raw?.dar_arrival || raw?.origin_arrival || raw?.loading_start || null,
        kurasini_entry: raw?.kurasini_entry || raw?.loading_start || null,
        kurasini_exit: raw?.kurasini_exit || raw?.loading_end || null,
        dar_exit: raw?.dar_exit || raw?.origin_exit || null,
        origin_exit: raw?.origin_exit || raw?.dar_exit || null,
        dest_name: destinationName,
        destination_name: destinationName,
        next_dar_entry: raw?.next_dar_entry || null,
        completion_time: deliveryCompletionTime,
        source_completion_time: raw?.completion_time ?? null,
        source_trip_closed_at: raw?.trip_closed_at ?? null,
        source_next_dar_entry: raw?.next_dar_entry ?? null,
        source_next_loading_entry: raw?.next_loading_entry ?? null,
        active_queue_status: getActiveQueueStatus({
            ...raw,
            trip_status: status,
            status,
            source_completion_time: raw?.completion_time ?? null,
            source_trip_closed_at: raw?.trip_closed_at ?? null,
            source_next_dar_entry: raw?.next_dar_entry ?? null,
            source_next_loading_entry: raw?.next_loading_entry ?? null,
        }),
        dest_dwell_hrs: raw?.dest_dwell_hrs ?? raw?.destination_dwell_hrs ?? null,
        drc_region_hrs: raw?.drc_region_hrs ?? raw?.destination_dwell_hrs ?? null,
        is_completed: raw?.is_completed ?? (status === 'completed' || status === 'completed_missed_dest'),
        is_returning: raw?.is_returning ?? (status === 'returning'),
        visit_chain: buildVisitChainFromV2Row(raw),
    };
}

function filterRowsForTab(rows: V2TripRow[], tab: ModalStatus): V2TripRow[] {
    if (!Array.isArray(rows)) return [];

    if (tab === 'completed_or_returning') {
        return rows.filter((r) => r.trip_status === 'completed' || r.trip_status === 'returning');
    }
    if (tab === 'unfinished') {
        return rows.filter((r) =>
            r.trip_status === 'loading' ||
            r.trip_status === 'pre_transit' ||
            r.trip_status === 'in_transit' ||
            r.trip_status === 'at_destination'
        );
    }
    if (tab === 'completed_missed_dest') {
        return rows.filter((r) => r.trip_status === 'completed_missed_dest' || r.missed_destination === true);
    }
    return rows.filter((r) => r.trip_status === tab);
}

function mapStatusToV2(status: ModalStatus): string | null {
    if (status === 'completed_or_returning' || status === 'unfinished') return null;
    return status;
}

function getTabTotal(tab: ModalStatus, counts: V2Counts): number {
    if (tab === 'completed_or_returning') return counts.total_completed + counts.total_returning;
    if (tab === 'completed') return counts.total_completed;
    if (tab === 'returning') return counts.total_returning;
    if (tab === 'completed_missed_dest') return counts.total_missed_dest;
    return counts.total_unfinished;
}

function getStatsForKPI(stats: Record<string, unknown> | null): KPIStatsShape | null {
    if (!stats) return null;
    return {
        avg_waiting_hrs: safeNumber(stats.avg_mobilization_hours ?? stats.avg_waiting_hrs),
        avg_transit_to_load_hrs: safeNumber(stats.avg_transit_hours ?? stats.avg_transit_to_load_hrs),
        avg_loading_hrs: safeNumber(stats.avg_loading_phase_hours ?? stats.avg_loading_hrs),
        avg_border_hrs: safeNumber(stats.avg_border_wait_hours ?? stats.avg_border_hrs),
        avg_offloading_hrs: safeNumber(stats.avg_unloading_hours ?? stats.avg_offloading_hrs),
        trip_completion_rate: safeNumber(stats.trip_completion_rate),
        trips_departed: safeNumber(stats.trips_departed),
        trips_completed: safeNumber(stats.trips_completed),
    };
}

function buildBorderSignal(key: string, title: string, subtitle: string, data: BorderTrendRow[]): BorderSignal {
    const avgWaitHours = average(data.map((row) => safeNumber(row.avg_wait_hours)));
    const peakWaitHours = data.reduce((max, row) => Math.max(max, safeNumber(row.avg_wait_hours)), 0);
    const totalTrucks = data.reduce((sum, row) => sum + safeNumber(row.truck_count), 0);
    const avgTrucks = average(data.map((row) => safeNumber(row.truck_count)));
    const latestWaitHours = data.length > 0 ? safeNumber(data[data.length - 1].avg_wait_hours) : null;

    let deltaPct: number | null = null;
    if (data.length >= 2) {
        const first = safeNumber(data[0].avg_wait_hours);
        const last = safeNumber(data[data.length - 1].avg_wait_hours);
        if (first > 0) {
            deltaPct = ((last - first) / first) * 100;
        }
    }

    return {
        key,
        title,
        subtitle,
        data,
        avgWaitHours,
        latestWaitHours,
        peakWaitHours,
        totalTrucks,
        avgTrucks,
        deltaPct,
        tone: borderTone(avgWaitHours, peakWaitHours),
    };
}

function EmptyState({
    title,
    description,
    compact = false,
}: {
    title: string;
    description: string;
    compact?: boolean;
}) {
    return (
        <div className={cn(
            'flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/40 text-center',
            compact ? 'min-h-[160px] p-6' : 'min-h-[260px] p-10'
        )}>
            <div className="mb-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-slate-300">
                <CircleAlert className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            <p className="mt-2 max-w-md text-sm text-slate-400">{description}</p>
        </div>
    );
}

function SectionShell({
    eyebrow,
    title,
    description,
    aside,
    children,
    className,
}: {
    eyebrow?: string;
    title: string;
    description?: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn(
            'relative overflow-hidden rounded-[28px] border border-slate-800/90 bg-slate-950/80 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.95)] backdrop-blur-sm',
            className
        )}>
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-500/40 to-transparent" />
            <div className="flex flex-col gap-4 border-b border-slate-800/80 px-6 py-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    {eyebrow ? (
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                            {eyebrow}
                        </div>
                    ) : null}
                    <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
                    {description ? <p className="mt-2 max-w-3xl text-sm text-slate-400">{description}</p> : null}
                </div>
                {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
            </div>
            <div className="p-6">{children}</div>
        </section>
    );
}

function MetricCard({
    label,
    value,
    helper,
    icon: Icon,
    tone,
    loading,
}: OverviewMetric & { loading?: boolean }) {
    const styles = toneStyles(tone);

    if (loading) {
        return <div className="h-36 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />;
    }

    return (
        <div className={cn(
            'relative overflow-hidden rounded-[24px] border bg-gradient-to-br p-5',
            styles.border,
            styles.surface
        )}>
            <div className="relative flex items-start justify-between gap-4">
                <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">{label}</div>
                    <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{value}</div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{helper}</p>
                </div>
                <div className={cn('rounded-2xl border border-white/5 p-3', styles.icon)}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </div>
    );
}

function InsightCard({ title, value, description, icon: Icon, tone }: InsightMetric) {
    const styles = toneStyles(tone);

    return (
        <div className={cn(
            'rounded-[24px] border bg-gradient-to-br p-5',
            styles.border,
            styles.surface
        )}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">{title}</div>
                    <div className={cn('mt-3 text-2xl font-semibold tracking-tight', styles.text)}>{value}</div>
                </div>
                <div className={cn('rounded-2xl border border-white/5 p-3', styles.icon)}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">{description}</p>
        </div>
    );
}

function StageCard({ stage }: { stage: StageMetric }) {
    const styles = toneStyles(stage.tone);

    return (
        <div className={cn(
            'rounded-[24px] border bg-gradient-to-br p-5',
            styles.border,
            stage.accentClass
        )}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">{stage.label}</div>
                    <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{formatHours(stage.value)}</div>
                    <p className="mt-2 text-sm text-slate-400">{stage.subtitle}</p>
                </div>
                <div className={cn('rounded-2xl border border-white/5 p-3', styles.icon)}>
                    <stage.icon className="h-5 w-5" />
                </div>
            </div>
            <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Share of measured cycle</span>
                    <span>{formatPercent(stage.share, 0)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-900/70">
                    <div
                        className={cn('h-full rounded-full bg-gradient-to-r', stage.meterClass)}
                        style={{ width: `${clamp(stage.share, 0, 100)}%` }}
                    />
                </div>
            </div>
        </div>
    );
}

function BorderPressurePanel({ signal }: { signal: BorderSignal }) {
    if (signal.data.length === 0) {
        return (
            <EmptyState
                compact
                title={`${signal.title} unavailable`}
                description="No border trend data is available for the selected date range."
            />
        );
    }

    const styles = toneStyles(signal.tone);
    const trendUp = signal.deltaPct != null && signal.deltaPct > 0;

    return (
        <div className={cn(
            'rounded-[26px] border bg-gradient-to-br p-5',
            styles.border,
            styles.surface
        )}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]', styles.badge)}>
                            {signal.title}
                        </span>
                        {signal.deltaPct != null ? (
                            <span className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]',
                                trendUp ? 'border-rose-400/20 bg-rose-500/10 text-rose-200' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                            )}>
                                {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {formatPercent(Math.abs(signal.deltaPct), 0)} vs start
                            </span>
                        ) : null}
                    </div>
                    <h3 className="mt-4 text-xl font-semibold text-white">{signal.subtitle}</h3>
                    <p className="mt-2 text-sm text-slate-400">
                        Border pressure blended across average wait, latest exit friction, and checkpoint throughput.
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:min-w-[280px]">
                    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Avg Wait</div>
                        <div className="mt-2 text-lg font-semibold text-white">{formatHours(signal.avgWaitHours)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Peak</div>
                        <div className="mt-2 text-lg font-semibold text-white">{formatHours(signal.peakWaitHours)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Latest</div>
                        <div className="mt-2 text-lg font-semibold text-white">{formatHours(signal.latestWaitHours)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Avg Trucks</div>
                        <div className="mt-2 text-lg font-semibold text-white">{signal.avgTrucks.toFixed(1)}</div>
                    </div>
                </div>
            </div>

            <div className="mt-6 h-[300px] rounded-[22px] border border-slate-800/80 bg-slate-950/70 p-3">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={signal.data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <defs>
                            <linearGradient id={`wait-gradient-${signal.key}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
                        <XAxis
                            dataKey="day_date"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value: string) => new Date(value).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                        />
                        <YAxis
                            yAxisId="wait"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={48}
                        />
                        <YAxis
                            yAxisId="truck"
                            orientation="right"
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={36}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'rgba(2, 6, 23, 0.94)',
                                border: '1px solid rgba(51, 65, 85, 0.9)',
                                borderRadius: '16px',
                                color: '#e2e8f0',
                            }}
                            labelFormatter={(label) => new Date(String(label)).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                            formatter={(value, name) => {
                                if (name === 'truck_count') return [value, 'Truck count'];
                                return [formatHours(Number(value)), 'Avg wait'];
                            }}
                        />
                        <Bar yAxisId="truck" dataKey="truck_count" fill="rgba(56, 189, 248, 0.20)" radius={[8, 8, 0, 0]} barSize={14} />
                        <Area
                            yAxisId="wait"
                            type="monotone"
                            dataKey="avg_wait_hours"
                            stroke="#22d3ee"
                            strokeWidth={2}
                            fill={`url(#wait-gradient-${signal.key})`}
                        />
                        <Line yAxisId="wait" type="monotone" dataKey="avg_wait_hours" stroke="#67e8f9" strokeWidth={2.2} dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default function TATDashboardV2() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<Record<string, unknown> | null>(null);
    const [tundumaData, setTundumaData] = useState<BorderTrendRow[]>([]);
    const [kasumbalData, setKasumbalData] = useState<BorderTrendRow[]>([]);
    const [destinationSummary, setDestinationSummary] = useState<DestinationSummaryRow[]>([]);
    const [uncoveredPayload, setUncoveredPayload] = useState<UncoveredTripsPayload | null>(null);
    const [uncoveredLoading, setUncoveredLoading] = useState(false);
    const [uncoveredError, setUncoveredError] = useState<string | null>(null);
    const [selectedUncoveredTrackerId, setSelectedUncoveredTrackerId] = useState<number | null>(null);
    const [trackerInspectorData, setTrackerInspectorData] = useState<TrackerInspectorDetailPayload | null>(null);
    const [trackerInspectorLoading, setTrackerInspectorLoading] = useState(false);
    const [trackerInspectorError, setTrackerInspectorError] = useState<string | null>(null);
    const [selectedDestination, setSelectedDestination] = useState<string>('All Destinations');

    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
    });

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tripDetails, setTripDetails] = useState<TripDetailsPayload | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);

    const [modalTab, setModalTab] = useState<ModalStatus>('completed_or_returning');
    const [modalDestination, setModalDestination] = useState<string | null>(null);
    const [modalOrigin, setModalOrigin] = useState<string | null>(null);
    const [modalTrackerId, setModalTrackerId] = useState<number | null>(null);
    const [modalTripType, setModalTripType] = useState<string | null>(null);

    const [isActiveQueuesOpen, setIsActiveQueuesOpen] = useState(false);
    const [activeQueueDetails, setActiveQueueDetails] = useState<ActiveQueuePayload | null>(null);
    const [activeQueueLoading, setActiveQueueLoading] = useState(false);
    const [activeQueueError, setActiveQueueError] = useState<string | null>(null);
    const [activeQueueInitialTab, setActiveQueueInitialTab] = useState<ActiveQueueStatus>('active_all');

    const [isCompletedFactsOpen, setIsCompletedFactsOpen] = useState(false);
    const [completedFactsData, setCompletedFactsData] = useState<CompletedFactsPayload | null>(null);
    const [completedFactsLoading, setCompletedFactsLoading] = useState(false);
    const [completedFactsError, setCompletedFactsError] = useState<string | null>(null);
    const [completedFactsSearchTerm, setCompletedFactsSearchTerm] = useState('');
    const [completedFactsPage, setCompletedFactsPage] = useState(0);
    const [completedFactsScope, setCompletedFactsScope] = useState<CompletedFactsScope>({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
        destination: null,
    });
    const completedFactsSearchTimerRef = useRef<number | null>(null);
    const completedFactsRequestIdRef = useRef(0);

    const fetchUncoveredSummary = useCallback(async () => {
        const params = new URLSearchParams({
            start: dateRange.start,
            end: dateRange.end,
            orphanGapHours: String(UNMATCHED_ORPHAN_GAP_HOURS),
            trackerLimit: '200',
        });
        const res = await fetch(`/api/tat/v2/uncovered-summary?${params.toString()}`);
        const rawBody = await res.text();
        let payload: Record<string, unknown> = {};
        try {
            payload = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
        } catch {
            payload = { raw: rawBody };
        }

        if (!res.ok || payload?.success === false) {
            const payloadError =
                typeof payload?.error === 'string'
                    ? payload.error
                    : (typeof payload?.message === 'string' ? payload.message : null);
            return {
                data: null as unknown,
                error: {
                    message: payloadError || `Request failed with status ${res.status}`,
                    details: (typeof payload?.details === 'string' ? payload.details : null),
                    hint: (typeof payload?.hint === 'string' ? payload.hint : null),
                    code: (typeof payload?.code === 'string' ? payload.code : null),
                    raw: (typeof payload?.raw === 'string' ? payload.raw : (rawBody || null)),
                },
            };
        }

        return {
            data: payload?.data ?? null,
            error: null as null,
        };
    }, [dateRange.end, dateRange.start]);

    const fetchDashboardData = useCallback(async () => {
        setLoading(true);
        setUncoveredLoading(true);
        setUncoveredError(null);
        try {
            const destParam = normaliseFilter(selectedDestination);

            const [statsRes, tundumaRes, kasumbalRes, summaryRes, uncoveredRes] = await Promise.all([
                supabase.rpc('get_tat_fleet_stats_v2', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_destination: destParam,
                }),
                supabase.rpc('get_border_wait_trend', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_border_tz: 'TUNDUMA BORDER TZ SIDE',
                    p_border_foreign: 'NAKONDE BORDER ZMB SIDE',
                }),
                supabase.rpc('get_border_wait_trend', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_border_tz: 'KASUMBALESA ZMB SIDE',
                    p_border_foreign: 'KASUMBALESA BORDER  DRC SIDE',
                }),
                supabase.rpc('get_tat_summary_by_destination_v2', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                }),
                fetchUncoveredSummary(),
            ]);

            if (statsRes.error) console.error('V2 stats error:', statsRes.error);
            setStats((statsRes.data as Record<string, unknown>) || null);

            if (tundumaRes.error) console.error('Tunduma error:', tundumaRes.error);
            setTundumaData((tundumaRes.data as BorderTrendRow[]) || []);

            if (kasumbalRes.error) console.error('Kasumbal error:', kasumbalRes.error);
            setKasumbalData((kasumbalRes.data as BorderTrendRow[]) || []);

            if (summaryRes.error) console.error('V2 destination summary error:', summaryRes.error);
            setDestinationSummary(Array.isArray(summaryRes.data) ? summaryRes.data as DestinationSummaryRow[] : []);

            if (uncoveredRes.error) {
                console.error('V2 uncovered trip summary error:', uncoveredRes.error, JSON.stringify(uncoveredRes.error));
                const uncoveredMsg = describeSupabaseError(
                    uncoveredRes.error,
                    'Failed to load uncovered summary. Ensure the latest uncovered/state-machine migrations are applied.'
                );
                setUncoveredPayload(null);
                setUncoveredError(uncoveredMsg);
            } else {
                setUncoveredPayload(adaptUncoveredPayload(uncoveredRes.data));
            }
        } catch (e) {
            console.error('V2 dashboard fetch failed', e);
            setUncoveredPayload(null);
            setUncoveredError(e instanceof Error ? e.message : 'Unexpected dashboard error.');
        } finally {
            setLoading(false);
            setUncoveredLoading(false);
        }
    }, [dateRange, fetchUncoveredSummary, selectedDestination]);

    useEffect(() => {
        if (!dateRange.start || !dateRange.end) {
            setLoading(false);
            return;
        }
        fetchDashboardData();
    }, [fetchDashboardData, dateRange.start, dateRange.end]);

    const fetchTripDetails = useCallback(async (
        page: number,
        status: ModalStatus,
        destination: string | null,
        sort: string = 'tat_desc',
        origin: string | null = null,
        trackerId: number | null = null,
        tripType: string | null = null,
    ) => {
        setDetailsLoading(true);
        setDetailsError(null);

        const PAGE_SIZE = 100;
        const isCompositeTab = status === 'completed_or_returning' || status === 'unfinished';
        const detailsLimit = isCompositeTab ? 2000 : PAGE_SIZE;
        const detailsOffset = isCompositeTab ? 0 : page * PAGE_SIZE;

        try {
            const [detailsRes, countsRes] = await Promise.all([
                supabase.rpc('get_tat_trip_details_v2', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_limit: detailsLimit,
                    p_offset: detailsOffset,
                    p_trip_type: normaliseFilter(tripType),
                    p_status: mapStatusToV2(status),
                    p_search: null,
                    p_sort: sort,
                    p_origin: normaliseFilter(origin),
                    p_destination: normaliseFilter(destination),
                    p_tracker_id: trackerId ?? null,
                }),
                supabase.rpc('get_tat_trip_details_v2', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                    p_limit: 1,
                    p_offset: 0,
                    p_trip_type: normaliseFilter(tripType),
                    p_status: null,
                    p_search: null,
                    p_sort: 'loading_start_desc',
                    p_origin: normaliseFilter(origin),
                    p_destination: normaliseFilter(destination),
                    p_tracker_id: trackerId ?? null,
                }),
            ]);

            if (detailsRes.error) {
                console.error('V2 trip details error:', detailsRes.error);
                const detailMsg =
                    detailsRes.error.message ||
                    detailsRes.error.details ||
                    detailsRes.error.hint ||
                    JSON.stringify(detailsRes.error) ||
                    'Failed to load trip details.';
                setDetailsError(detailMsg);
                return;
            }
            if (countsRes.error) {
                console.error('V2 counts error:', countsRes.error);
                const countsMsg =
                    countsRes.error.message ||
                    countsRes.error.details ||
                    countsRes.error.hint ||
                    JSON.stringify(countsRes.error) ||
                    'Failed to load trip counts.';
                setDetailsError(countsMsg);
                return;
            }

            const detailsPayload = (detailsRes.data as Partial<TripDetailsPayload>) || {};
            const countsPayload = (countsRes.data as Partial<TripDetailsPayload>) || {};
            const rawRows = Array.isArray(detailsPayload?.data) ? detailsPayload.data : [];
            const adaptedRows = rawRows.map((row) => adaptV2TripRow(row));
            const filteredRows = filterRowsForTab(adaptedRows, status);

            const pagedRows = isCompositeTab
                ? filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
                : filteredRows;

            const counts: V2Counts = {
                total_completed: safeNumber(countsPayload?.total_completed ?? detailsPayload?.total_completed),
                total_returning: safeNumber(countsPayload?.total_returning ?? detailsPayload?.total_returning),
                total_unfinished: safeNumber(countsPayload?.total_unfinished ?? detailsPayload?.total_unfinished),
                total_missed_dest: safeNumber(countsPayload?.total_missed_dest ?? detailsPayload?.total_missed_dest),
            };

            const hydratedPayload: TripDetailsPayload = {
                total_completed: counts.total_completed,
                total_returning: counts.total_returning,
                total_unfinished: counts.total_unfinished,
                total_missed_dest: counts.total_missed_dest,
                limit: PAGE_SIZE,
                offset: page * PAGE_SIZE,
                data: pagedRows,
                total_for_active_tab: getTabTotal(status, counts),
            };

            setTripDetails(hydratedPayload);
        } catch (e: unknown) {
            console.error('fetchTripDetails v2 failed', e);
            setDetailsError(e instanceof Error ? e.message : 'Unexpected error.');
        } finally {
            setDetailsLoading(false);
        }
    }, [dateRange]);

    const fetchActiveQueueDetails = useCallback(async (
        destination: string | null,
        initialTab: ActiveQueueStatus = 'active_all',
    ) => {
        setActiveQueueLoading(true);
        setActiveQueueError(null);
        setActiveQueueInitialTab(initialTab);
        setActiveQueueDetails(null);

        try {
            const startIso = toUtcDayStart(dateRange.start);
            const endExclusiveIso = toUtcDayEndExclusive(dateRange.end);
            const destinationFilter = normaliseFilter(destination)?.trim().toLowerCase() || null;

            const detailsRes = await supabase
                .from('tat_trip_facts_v2')
                .select(
                    `
                        tracker_id,
                        tracker_name,
                        trip_status,
                        trip_type,
                        loading_terminal,
                        origin_region,
                        destination_name,
                        customer_name,
                        loading_start,
                        loading_end,
                        origin_exit,
                        dest_entry,
                        dest_exit,
                        customer_entry,
                        customer_exit,
                        completion_time,
                        trip_closed_at,
                        next_loading_entry,
                        border_entry,
                        border_exit,
                        return_border_entry,
                        return_border_exit,
                        total_tat_hrs,
                        transit_hrs,
                        loading_phase_hrs,
                        post_loading_delay_hrs,
                        return_hrs,
                        border_total_hrs,
                        outbound_border_total_hrs,
                        return_border_total_hrs
                    `,
                    { count: 'exact' }
                )
                .gte('loading_start', startIso)
                .lt('loading_start', endExclusiveIso)
                .is('next_loading_entry', null)
                .in('trip_status', ['loading', 'pre_transit', 'in_transit', 'at_destination', 'returning', 'completed', 'completed_missed_dest'])
                .order('loading_start', { ascending: false })
                .limit(2000);

            if (detailsRes.error) {
                console.error('Active queue details error:', detailsRes.error);
                setActiveQueueError(
                    describeSupabaseError(detailsRes.error, 'Failed to load active queue details.')
                );
                return;
            }

            const rawRows = Array.isArray(detailsRes.data) ? detailsRes.data : [];
            const adaptedRows = rawRows
                .map((row) => adaptV2TripRow(row))
                .filter((row) => {
                    if (!destinationFilter) return true;
                    const rowDestination = `${row.customer_name || ''} ${row.destination_name || row.dest_name || ''}`
                        .trim()
                        .toLowerCase();
                    return rowDestination.includes(destinationFilter);
                });
            const activeRows = adaptedRows.filter(isOperationallyActive);

            setActiveQueueDetails({
                active_queue_counts: buildActiveQueueCounts(adaptedRows),
                data: activeRows,
                generated_at: new Date().toISOString(),
            });
        } catch (e: unknown) {
            console.error('fetchActiveQueueDetails failed', e);
            setActiveQueueError(describeSupabaseError(e, 'Unexpected error while loading active queue details.'));
        } finally {
            setActiveQueueLoading(false);
        }
    }, [dateRange]);

    const fetchCompletedFacts = useCallback(async (
        scope: CompletedFactsScope,
        rawSearchTerm: string = '',
        page: number = 0,
    ) => {
        setCompletedFactsLoading(true);
        setCompletedFactsError(null);

        const ROW_LIMIT = 500;
        const startIso = toUtcDayStart(scope.start);
        const endExclusiveIso = toUtcDayEndExclusive(scope.end);
        const destinationFilter = normaliseFilter(scope.destination);
        const searchTerm = rawSearchTerm.trim();
        const requestId = ++completedFactsRequestIdRef.current;

        try {
            const selectClause = `
                trip_key,
                tracker_id,
                tracker_name,
                trip_status,
                trip_closure_reason,
                trip_type,
                loading_terminal,
                origin_region,
                destination_name,
                customer_name,
                loading_start,
                loading_end,
                origin_exit,
                dest_entry,
                dest_exit,
                customer_entry,
                customer_exit,
                completion_time,
                trip_closed_at,
                total_tat_hrs,
                waiting_for_orders_hrs,
                loading_phase_hrs,
                post_loading_delay_hrs,
                transit_hrs,
                border_total_hrs,
                destination_dwell_hrs,
                customer_dwell_hrs,
                return_hrs,
                lifecycle_confidence,
                missed_destination_flag,
                route_anomaly_flag,
                low_confidence_flag
            `;

            let query = supabase
                .from('tat_trip_facts_v2')
                .select(selectClause, { count: 'exact' })
                .gte('loading_start', startIso)
                .lt('loading_start', endExclusiveIso)
                .in('trip_status', ['completed', 'completed_missed_dest'])
                .order('loading_start', { ascending: false })
                .range(page * ROW_LIMIT, page * ROW_LIMIT + ROW_LIMIT - 1);

            if (searchTerm) {
                const escapedSearch = escapePostgrestLike(searchTerm);
                const searchFilters = [
                    `trip_key.ilike.%${escapedSearch}%`,
                    `tracker_name.ilike.%${escapedSearch}%`,
                    `trip_type.ilike.%${escapedSearch}%`,
                    `trip_closure_reason.ilike.%${escapedSearch}%`,
                    `loading_terminal.ilike.%${escapedSearch}%`,
                    `origin_region.ilike.%${escapedSearch}%`,
                    `destination_name.ilike.%${escapedSearch}%`,
                    `customer_name.ilike.%${escapedSearch}%`,
                ];
                if (/^\d+$/.test(searchTerm)) {
                    searchFilters.push(`tracker_id.eq.${searchTerm}`);
                }
                if (destinationFilter) {
                    const escapedDestination = escapePostgrestLiteral(destinationFilter);
                    const searchClause = `or(${searchFilters.join(',')})`;
                    query = query.or(
                        `and(destination_name.eq."${escapedDestination}",${searchClause}),and(customer_name.eq."${escapedDestination}",${searchClause})`
                    );
                } else {
                    query = query.or(searchFilters.join(','));
                }
            } else if (destinationFilter) {
                const escapedDestination = escapePostgrestLiteral(destinationFilter);
                query = query.or(`destination_name.eq."${escapedDestination}",customer_name.eq."${escapedDestination}"`);
            }

            const { data, error, count } = await query;
            if (requestId !== completedFactsRequestIdRef.current) return;

            if (error) {
                console.error('Completed facts error:', error);
                setCompletedFactsError(
                    describeSupabaseError(error, 'Failed to load completed facts.')
                );
                return;
            }

            const rows = (Array.isArray(data) ? data : []) as CompletedFactRow[];
            setCompletedFactsData({
                total_count: count ?? rows.length,
                limit: ROW_LIMIT,
                offset: page * ROW_LIMIT,
                data: rows,
                generated_at: new Date().toISOString(),
            });
            setCompletedFactsPage(page);
        } catch (e: unknown) {
            if (requestId !== completedFactsRequestIdRef.current) return;
            console.error('fetchCompletedFacts failed', e);
            setCompletedFactsError(
                describeSupabaseError(e, 'Unexpected error while loading completed facts.')
            );
        } finally {
            if (requestId === completedFactsRequestIdRef.current) {
                setCompletedFactsLoading(false);
            }
        }
    }, []);

    const handleKPICompletionClick = (page = 0, status: ModalStatus = 'completed') => {
        const dest = normaliseFilter(selectedDestination);
        setIsModalOpen(true);
        setModalTab(status);
        setModalDestination(dest);
        setModalOrigin(null);
        setModalTrackerId(null);
        setModalTripType(null);
        fetchTripDetails(page, status, dest);
    };

    const handleActiveQueuesClick = (initialTab: ActiveQueueStatus = 'active_all') => {
        const dest = normaliseFilter(selectedDestination);
        setIsActiveQueuesOpen(true);
        fetchActiveQueueDetails(dest, initialTab);
    };

    const handleCompletedFactsClick = () => {
        const scope: CompletedFactsScope = {
            start: dateRange.start,
            end: dateRange.end,
            destination: normaliseFilter(selectedDestination),
        };
        setCompletedFactsScope(scope);
        setCompletedFactsSearchTerm('');
        setCompletedFactsPage(0);
        setIsCompletedFactsOpen(true);
        fetchCompletedFacts(scope, '', 0);
    };

    const handleCompletedFactsSearchChange = useCallback((value: string) => {
        setCompletedFactsSearchTerm(value);
        setCompletedFactsPage(0);
        if (completedFactsSearchTimerRef.current != null) {
            window.clearTimeout(completedFactsSearchTimerRef.current);
        }
        if (!isCompletedFactsOpen) return;
        const scope = completedFactsScope;
        completedFactsSearchTimerRef.current = window.setTimeout(() => {
            fetchCompletedFacts(scope, value, 0);
        }, value.trim() ? 280 : 120);
    }, [completedFactsScope, fetchCompletedFacts, isCompletedFactsOpen]);

    const handleCompletedFactsPageChange = useCallback((page: number) => {
        const normalizedPage = Math.max(0, page);
        setCompletedFactsPage(normalizedPage);
        fetchCompletedFacts(completedFactsScope, completedFactsSearchTerm, normalizedPage);
    }, [completedFactsScope, completedFactsSearchTerm, fetchCompletedFacts]);

    const handleCompletedFactsClose = useCallback(() => {
        if (completedFactsSearchTimerRef.current != null) {
            window.clearTimeout(completedFactsSearchTimerRef.current);
            completedFactsSearchTimerRef.current = null;
        }
        completedFactsRequestIdRef.current += 1;
        setIsCompletedFactsOpen(false);
    }, []);

    useEffect(() => {
        return () => {
            if (completedFactsSearchTimerRef.current != null) {
                window.clearTimeout(completedFactsSearchTimerRef.current);
            }
            completedFactsRequestIdRef.current += 1;
        };
    }, []);

    const handleRowDrillDown = (destination: string) => {
        setIsModalOpen(true);
        setModalTab('completed_or_returning');
        setModalDestination(destination);
        setModalOrigin(null);
        setModalTrackerId(null);
        setModalTripType(null);
        fetchTripDetails(0, 'completed_or_returning', destination);
    };

    const handleModalPageChange = (
        page: number,
        status: string,
        sort?: string,
        origin?: string | null,
        destination?: string | null,
        trackerId?: number | null,
        tripType?: string | null,
    ) => {
        const nextStatus = status as ModalStatus;
        setModalTab(nextStatus);

        const activeOrigin = origin !== undefined ? origin : modalOrigin;
        const activeDest = destination !== undefined ? destination : modalDestination;
        const activeTrackerId = trackerId !== undefined ? trackerId : modalTrackerId;
        const activeTripType = tripType !== undefined ? tripType : modalTripType;

        setModalOrigin(activeOrigin);
        setModalDestination(activeDest);
        setModalTrackerId(activeTrackerId);
        setModalTripType(activeTripType);

        fetchTripDetails(
            page,
            nextStatus,
            activeDest,
            sort || 'tat_desc',
            activeOrigin,
            activeTrackerId,
            activeTripType,
        );
    };

    const uniqueDestinations = useMemo(() => ([
        'All Destinations',
        ...new Set((destinationSummary || []).map((d) => d.location).filter(Boolean)),
    ].sort()), [destinationSummary]);

    const uncoveredTrackers = useMemo(
        () => uncoveredPayload?.trackers || [],
        [uncoveredPayload]
    );
    const activeUncoveredTrackerId =
        selectedUncoveredTrackerId ?? (uncoveredTrackers[0]?.tracker_id ?? null);

    useEffect(() => {
        if (uncoveredTrackers.length === 0) {
            setSelectedUncoveredTrackerId(null);
            return;
        }
        if (
            selectedUncoveredTrackerId == null ||
            !uncoveredTrackers.some((row) => row.tracker_id === selectedUncoveredTrackerId)
        ) {
            setSelectedUncoveredTrackerId(uncoveredTrackers[0].tracker_id);
        }
    }, [selectedUncoveredTrackerId, uncoveredTrackers]);

    useEffect(() => {
        let cancelled = false;

        async function fetchTrackerInspector() {
            if (!activeUncoveredTrackerId) {
                setTrackerInspectorData(null);
                setTrackerInspectorError(null);
                return;
            }

            const activeTrackerSummary = uncoveredTrackers.find(
                (row) => row.tracker_id === activeUncoveredTrackerId
            );
            const requestedFactLimit = Math.max(
                100,
                safeNumber(activeTrackerSummary?.fact_trip_count, 0)
            );
            const requestedUncoveredLimit = Math.max(
                100,
                safeNumber(activeTrackerSummary?.uncovered_trip_count, 0)
            );

            setTrackerInspectorLoading(true);
            setTrackerInspectorError(null);

            try {
                const params = new URLSearchParams({
                    start: dateRange.start,
                    end: dateRange.end,
                    trackerId: String(activeUncoveredTrackerId),
                    orphanGapHours: String(UNMATCHED_ORPHAN_GAP_HOURS),
                    factLimit: String(requestedFactLimit),
                    uncoveredLimit: String(requestedUncoveredLimit),
                });
                const res = await fetch(`/api/tat/v2/uncovered-tracker-detail?${params.toString()}`);
                const payload = await res.json();
                if (!res.ok || payload?.success === false) {
                    throw new Error(payload?.error || `Request failed with status ${res.status}`);
                }
                if (!cancelled) {
                    const data =
                        payload?.data && typeof payload.data === 'object'
                            ? payload.data as TrackerInspectorDetailPayload
                            : null;
                    setTrackerInspectorData(data);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setTrackerInspectorData(null);
                    setTrackerInspectorError(err instanceof Error ? err.message : 'Failed to load tracker inspector data.');
                }
            } finally {
                if (!cancelled) setTrackerInspectorLoading(false);
            }
        }

        fetchTrackerInspector();
        return () => { cancelled = true; };
    }, [activeUncoveredTrackerId, dateRange.end, dateRange.start, uncoveredTrackers]);

    const kpiStats = useMemo(() => getStatsForKPI(stats), [stats]);

    const lifecycleStages = useMemo<StageMetric[]>(() => {
        if (!kpiStats) return [];
        const stageSeed = [
            {
                id: 'dispatch',
                label: 'Dispatch wait',
                subtitle: 'Order-to-release dwell before the trip commits.',
                value: kpiStats.avg_waiting_hrs,
                icon: Clock3,
                tone: 'warning' as Tone,
                accentClass: 'from-cyan-500/14 via-cyan-500/5 to-transparent border-cyan-400/16',
                meterClass: 'from-cyan-300 via-cyan-400 to-sky-400',
            },
            {
                id: 'origin-transfer',
                label: 'Origin reposition',
                subtitle: 'Transit from DAR release to the active loading domain.',
                value: kpiStats.avg_transit_to_load_hrs,
                icon: Route,
                tone: 'neutral' as Tone,
                accentClass: 'from-sky-500/14 via-sky-500/5 to-transparent border-sky-400/16',
                meterClass: 'from-sky-300 via-sky-400 to-blue-400',
            },
            {
                id: 'loading',
                label: 'Loading ops',
                subtitle: 'Terminal/zone dwell while the truck is inside the loading state.',
                value: kpiStats.avg_loading_hrs,
                icon: Layers3,
                tone: 'warning' as Tone,
                accentClass: 'from-orange-500/16 via-orange-500/5 to-transparent border-orange-400/16',
                meterClass: 'from-orange-300 via-orange-400 to-amber-400',
            },
            {
                id: 'border',
                label: 'Border dwell',
                subtitle: 'Cross-frontier delay accumulated across route checkpoints.',
                value: kpiStats.avg_border_hrs,
                icon: ShieldAlert,
                tone: borderTone(kpiStats.avg_border_hrs, kpiStats.avg_border_hrs),
                accentClass: 'from-amber-500/16 via-amber-500/5 to-transparent border-amber-400/16',
                meterClass: 'from-amber-300 via-yellow-300 to-orange-400',
            },
            {
                id: 'delivery',
                label: 'Delivery dwell',
                subtitle: 'Destination/customer dwell before completion confirmation.',
                value: kpiStats.avg_offloading_hrs,
                icon: MapPinned,
                tone: 'good' as Tone,
                accentClass: 'from-emerald-500/16 via-emerald-500/5 to-transparent border-emerald-400/16',
                meterClass: 'from-emerald-300 via-emerald-400 to-teal-400',
            },
        ];
        const total = stageSeed.reduce((sum, item) => sum + item.value, 0);
        return stageSeed.map((item) => ({
            ...item,
            share: total > 0 ? (item.value / total) * 100 : 0,
        }));
    }, [kpiStats]);

    const dominantStage = useMemo(() => {
        if (lifecycleStages.length === 0) return null;
        return lifecycleStages.reduce((current, stage) => (stage.value > current.value ? stage : current), lifecycleStages[0]);
    }, [lifecycleStages]);

    const destinationRows = useMemo(() => {
        const scoped = destinationSummary.filter((row) => (
            selectedDestination === 'All Destinations' || row.location === selectedDestination
        ));
        return [...scoped].sort((a, b) => {
            const tripDelta = safeNumber(b.trip_count) - safeNumber(a.trip_count);
            if (tripDelta !== 0) return tripDelta;
            return safeNumber(a.avg_tat_days) - safeNumber(b.avg_tat_days);
        });
    }, [destinationSummary, selectedDestination]);

    const destinationTatAverage = useMemo(
        () => average(destinationRows.map((row) => safeNumber(row.avg_tat_days))),
        [destinationRows]
    );
    const maxDestinationTrips = useMemo(
        () => destinationRows.reduce((max, row) => Math.max(max, safeNumber(row.trip_count)), 0),
        [destinationRows]
    );
    const maxDestinationTat = useMemo(
        () => destinationRows.reduce((max, row) => Math.max(max, safeNumber(row.avg_tat_days)), 0),
        [destinationRows]
    );
    const spotlightDestinations = useMemo(() => destinationRows.slice(0, 3), [destinationRows]);

    const borderSignals = useMemo(() => ([
        buildBorderSignal('tunduma', 'Tunduma corridor', 'Tunduma (TZ) → Nakonde (ZMB)', tundumaData),
        buildBorderSignal('kasumbalesa', 'Kasumbalesa corridor', 'Kasumbalesa (ZMB) → DRC', kasumbalData),
    ]), [kasumbalData, tundumaData]);

    const coverageGapPct = uncoveredPayload?.uncovered_vs_fact_pct ?? null;
    const coverageScore = coverageGapPct == null ? null : clamp(100 - coverageGapPct, 0, 100);
    const waitingShare = useMemo(() => {
        if (!uncoveredPayload || uncoveredPayload.total_uncovered_hours <= 0) return null;
        return (uncoveredPayload.total_waiting_stage_hours / uncoveredPayload.total_uncovered_hours) * 100;
    }, [uncoveredPayload]);

    const topExposureTracker = uncoveredTrackers[0] ?? null;
    const activeTrackerSummary = useMemo(
        () => uncoveredTrackers.find((row) => row.tracker_id === activeUncoveredTrackerId) ?? null,
        [activeUncoveredTrackerId, uncoveredTrackers]
    );

    const overviewMetrics = useMemo<OverviewMetric[]>(() => {
        return [
            {
                label: 'Observed trips',
                value: formatCompactNumber(kpiStats?.trips_departed ?? 0),
                helper: 'Trips with v2 lifecycle activity inside the selected analysis window.',
                icon: Truck,
                tone: 'neutral',
            },
            {
                label: 'Completed trips',
                value: formatCompactNumber(kpiStats?.trips_completed ?? 0),
                helper: 'Closed trips confirmed by the state-stop engine in the same period.',
                icon: Activity,
                tone: 'good',
            },
            {
                label: 'Completion rate',
                value: formatPercent(kpiStats?.trip_completion_rate ?? 0, 1),
                helper: 'Completion share across all observed trips for the current scope.',
                icon: Gauge,
                tone: (kpiStats?.trip_completion_rate ?? 0) >= 80 ? 'good' : (kpiStats?.trip_completion_rate ?? 0) >= 60 ? 'warning' : 'critical',
            },
            {
                label: 'Coverage score',
                value: coverageScore == null ? '--' : formatPercent(coverageScore, 1),
                helper: 'Inverse of uncovered-vs-facts drift, used as the data integrity headline.',
                icon: Database,
                tone: coverageScore == null ? 'neutral' : coverageScore >= 90 ? 'good' : coverageScore >= 75 ? 'warning' : 'critical',
            },
        ];
    }, [coverageScore, kpiStats]);

    const heroInsights = useMemo<InsightMetric[]>(() => {
        const primaryDestination = spotlightDestinations[0];
        return [
            {
                title: 'Primary bottleneck',
                value: dominantStage ? `${dominantStage.label} · ${formatHours(dominantStage.value)}` : '--',
                description: dominantStage
                    ? `${formatPercent(dominantStage.share, 0)} of the measured cycle is concentrated in this phase, making it the best candidate for operational improvement.`
                    : 'Stage-level breakdown becomes available once fleet stats load.',
                icon: Waypoints,
                tone: dominantStage ? dominantStage.tone : 'neutral',
            },
            {
                title: 'Destination leader',
                value: primaryDestination ? primaryDestination.location : '--',
                description: primaryDestination
                    ? `${primaryDestination.trip_count} trips averaging ${formatDays(primaryDestination.avg_tat_days)}. This is currently the strongest volume signal in the selected scope.`
                    : 'No destination completions found in the selected date range.',
                icon: MapPinned,
                tone: primaryDestination ? 'good' : 'neutral',
            },
            {
                title: 'Integrity hotspot',
                value: topExposureTracker ? topExposureTracker.tracker_name : '--',
                description: topExposureTracker
                    ? `${topExposureTracker.uncovered_trip_count} uncovered trips, ${formatHours(topExposureTracker.uncovered_total_hours)} outside fact coverage. Use the tracker focus panel to inspect exact gaps.`
                    : 'No uncovered-tracker hotspots detected for the selected date range.',
                icon: Target,
                tone: topExposureTracker ? 'critical' : 'good',
            },
        ];
    }, [dominantStage, spotlightDestinations, topExposureTracker]);

    const integrityCards = useMemo<InsightMetric[]>(() => ([
        {
            title: 'Uncovered trips',
            value: formatCompactNumber(uncoveredPayload?.total_uncovered_trips ?? 0),
            description: 'Trips present in the operational state stream but missing from fact coverage.',
            icon: ShieldAlert,
            tone: (uncoveredPayload?.total_uncovered_trips ?? 0) > 0 ? 'warning' : 'good',
        },
        {
            title: 'Waiting share',
            value: waitingShare == null ? '--' : formatPercent(waitingShare, 1),
            description: 'Share of uncovered hours explained by post-closure waiting/maintenance dwell.',
            icon: Clock3,
            tone: waitingShare == null ? 'neutral' : waitingShare >= 50 ? 'warning' : 'good',
        },
        {
            title: 'Top exposure tracker',
            value: topExposureTracker ? topExposureTracker.tracker_name : '--',
            description: topExposureTracker
                ? `${topExposureTracker.uncovered_trip_count} uncovered trips across ${topExposureTracker.uncovered_major_state_rows} major state rows.`
                : 'No tracker has elevated uncovered exposure in this range.',
            icon: Crosshair,
            tone: topExposureTracker ? 'critical' : 'good',
        },
    ]), [topExposureTracker, uncoveredPayload, waitingShare]);

    const dateWindowLabel = `${formatDateChip(dateRange.start)} - ${formatDateChip(dateRange.end)}`;
    const destinationScopeLabel = selectedDestination === 'All Destinations' ? 'Fleet-wide scope' : selectedDestination;

    return (
        <div className="relative mx-auto max-w-[1680px] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute left-0 top-0 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="absolute right-0 top-32 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl" />
                <div className="absolute inset-x-1/4 bottom-0 h-64 rounded-full bg-sky-500/5 blur-3xl" />
            </div>

            <section className="relative overflow-hidden rounded-[32px] border border-slate-800/90 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_28%),linear-gradient(135deg,_rgba(2,6,23,0.98),_rgba(15,23,42,0.94))] p-6 shadow-[0_24px_80px_-40px_rgba(14,165,233,0.25)] sm:p-8">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />
                <div className="grid gap-8 xl:grid-cols-[1.35fr_0.65fr] xl:items-start">
                    <div className="flex flex-col gap-8">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                                <Sparkles className="h-3.5 w-3.5" />
                                TAT Control Tower
                            </div>
                            <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                                <div className="max-w-3xl">
                                    <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                                        State-stop intelligence for the turnaround lifecycle.
                                    </h1>
                                    <p className="mt-4 text-base leading-7 text-slate-300/85">
                                        The TAT module blends operational performance, border risk, and v2 state-engine coverage into a single decision system.
                                    </p>
                                </div>

                                <div className="min-w-[280px] space-y-2 lg:mt-0 mt-4">
                                    <label className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500 ml-1">Fleet Engine Focus</label>
                                    <div className="relative group">
                                        <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 opacity-0 blur transition group-hover:opacity-100" />
                                        <select
                                            value={selectedDestination}
                                            onChange={(e) => setSelectedDestination(e.target.value)}
                                            className="relative w-full rounded-2xl border border-slate-700/50 bg-slate-900/90 px-4 py-3.5 text-sm font-medium text-white outline-none transition hover:border-cyan-400/40 focus:border-cyan-400/60 focus:ring-4 focus:ring-cyan-500/10"
                                        >
                                            {uniqueDestinations.map((dest) => (
                                                <option key={dest} value={dest} className="bg-slate-900">{dest}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-400">
                                <div className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-950/40 px-3 py-1.5 shadow-sm">
                                    <Calendar className="h-3.5 w-3.5 text-slate-500" />
                                    <span>{dateWindowLabel}</span>
                                </div>
                                <div className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-950/40 px-3 py-1.5 shadow-sm">
                                    <Target className="h-3.5 w-3.5 text-slate-500" />
                                    <span>{destinationScopeLabel}</span>
                                </div>
                                {uncoveredPayload?.visit_source && (
                                    <div className="rounded-full border border-slate-700/60 bg-slate-950/40 px-3 py-1.5 shadow-sm">
                                        Source: {uncoveredPayload.visit_source}
                                    </div>
                                )}
                                {uncoveredPayload?.detection_mode && (
                                    <div className="rounded-full border border-slate-700/60 bg-slate-950/40 px-3 py-1.5 shadow-sm border-dashed">
                                        Mode: {uncoveredPayload.detection_mode}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {overviewMetrics.map((metric) => (
                                <MetricCard key={metric.label} {...metric} loading={loading} />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-[28px] border border-slate-800/90 bg-slate-950/78 p-6 shadow-[0_18px_40px_-30px_rgba(14,165,233,0.25)]">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-cyan-400/80">Analysis window</div>
                                    <h2 className="mt-1 text-lg font-semibold text-white">Temporary context</h2>
                                </div>
                                {(loading || uncoveredLoading) ? <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" /> : <Calendar className="h-4 w-4 text-slate-600" />}
                            </div>
                            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500 ml-1">Start Point</label>
                                    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3.5 text-sm text-white transition-colors focus-within:border-cyan-500/40" id="analysis-start-date">
                                        <Calendar className="h-4 w-4 text-slate-500" />
                                        <input
                                            type="date"
                                            value={dateRange.start}
                                            onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                                            className="w-full bg-transparent text-sm text-white outline-none"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500 ml-1">End Point</label>
                                    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3.5 text-sm text-white transition-colors focus-within:border-cyan-500/40" id="analysis-end-date">
                                        <Calendar className="h-4 w-4 text-slate-500" />
                                        <input
                                            type="date"
                                            value={dateRange.end}
                                            onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                                            className="w-full bg-transparent text-sm text-white outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-[28px] border border-slate-800/90 bg-slate-950/78 p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-emerald-400/80">Operational Actions</div>
                                    <h2 className="mt-1 text-lg font-semibold text-white">Deep Inspection</h2>
                                </div>
                                <Sparkles className="h-4 w-4 text-emerald-500/50" />
                            </div>
                            <div className="grid gap-3">
                                <button
                                    id="engine-action-active-queues"
                                    onClick={() => handleActiveQueuesClick('active_all')}
                                    className="group flex items-center justify-between rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-4 py-4 text-left shadow-sm transition hover:border-emerald-500/30 hover:bg-emerald-500/10"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400 group-hover:scale-110 transition-transform">
                                            <Gauge className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.1em] text-emerald-300/60 font-bold">Live Engine</div>
                                            <div className="text-sm font-semibold text-white">Active Lifecycle Queues</div>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-emerald-500/40 group-hover:translate-x-1 transition-transform" />
                                </button>
                                
                                <button
                                    id="engine-action-trip-review"
                                    onClick={() => handleKPICompletionClick(0, 'completed_or_returning')}
                                    className="group flex items-center justify-between rounded-2xl border border-cyan-500/10 bg-cyan-500/5 px-4 py-4 text-left shadow-sm transition hover:border-cyan-500/30 hover:bg-cyan-500/10"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-400 group-hover:scale-110 transition-transform">
                                            <Activity className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.1em] text-cyan-300/60 font-bold">Performance</div>
                                            <div className="text-sm font-semibold text-white">Trip & Return Analysis</div>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-cyan-500/40 group-hover:translate-x-1 transition-transform" />
                                </button>

                                <button
                                    id="engine-action-missed-dest"
                                    onClick={() => handleKPICompletionClick(0, 'completed_missed_dest')}
                                    className="group flex items-center justify-between rounded-2xl border border-amber-500/10 bg-amber-500/5 px-4 py-4 text-left shadow-sm transition hover:border-amber-500/30 hover:bg-amber-500/10"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="rounded-xl bg-amber-500/10 p-2 text-amber-400 group-hover:scale-110 transition-transform">
                                            <ShieldAlert className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.1em] text-amber-300/60 font-bold">Exceptions</div>
                                            <div className="text-sm font-semibold text-white">Missed Destination Review</div>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-amber-500/40 group-hover:translate-x-1 transition-transform" />
                                </button>

                                <button
                                    id="engine-action-completed-facts"
                                    onClick={handleCompletedFactsClick}
                                    className="group flex items-center justify-between rounded-2xl border border-blue-500/10 bg-blue-500/5 px-4 py-4 text-left shadow-sm transition hover:border-blue-500/30 hover:bg-blue-500/10"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="rounded-xl bg-blue-500/10 p-2 text-blue-400 group-hover:scale-110 transition-transform">
                                            <Database className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.1em] text-blue-300/60 font-bold">Raw Intelligence</div>
                                            <div className="text-sm font-semibold text-white">Historical Fact Browser</div>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-blue-500/40 group-hover:translate-x-1 transition-transform" />
                                </button>
                            </div>
                        </div>

                        <div className="rounded-[28px] border border-slate-800/90 bg-slate-950/78 p-5">
                            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">Now reading</div>
                            <div className="mt-4 space-y-3">
                                {heroInsights.map((insight) => {
                                    const styles = toneStyles(insight.tone);
                                    return (
                                        <div key={insight.title} className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
                                            <div className="flex items-start gap-3">
                                                <div className={cn('rounded-2xl border border-white/5 p-2.5', styles.icon)}>
                                                    <insight.icon className="h-4.5 w-4.5" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">{insight.title}</div>
                                                    <div className={cn('mt-1 text-base font-semibold', styles.text)}>{insight.value}</div>
                                                    <p className="mt-2 text-sm leading-6 text-slate-400">{insight.description}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
                <SectionShell
                    eyebrow="Lifecycle analytics"
                    title="Phase architecture"
                    description="Measured average duration per state-stop phase, structured as a fast read on where cycle time is accumulating."
                    aside={
                        <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                            {dominantStage ? `Bottleneck: ${dominantStage.label}` : 'Awaiting stats'}
                        </span>
                    }
                >
                    {loading && lifecycleStages.length === 0 ? (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <div key={`stage-skeleton-${index}`} className="h-52 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                            ))}
                        </div>
                    ) : lifecycleStages.length === 0 ? (
                        <EmptyState
                            compact
                            title="Lifecycle analytics unavailable"
                            description="No fleet statistics were returned for the selected filters, so phase timing cannot be decomposed yet."
                        />
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {lifecycleStages.map((stage) => (
                                <StageCard key={stage.id} stage={stage} />
                            ))}
                        </div>
                    )}
                </SectionShell>

                <SectionShell
                    eyebrow="Decision intelligence"
                    title="Operational reads"
                    description="Condensed signals tuned for dispatch, fleet planning, and state-engine governance."
                >
                    <div className="grid gap-4">
                        {integrityCards.map((card) => (
                            <InsightCard key={card.title} {...card} />
                        ))}
                    </div>
                </SectionShell>
            </div>

            <SectionShell
                eyebrow="Destination intelligence"
                title="Where cycle time is being won or lost"
                description="Destinations are ranked by trip volume with contextual TAT comparison so teams can quickly isolate the biggest opportunities."
                aside={
                    <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                        {destinationRows.length} destination rows
                    </span>
                }
            >
                {loading && destinationRows.length === 0 ? (
                    <div className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-3">
                            {Array.from({ length: 3 }).map((_, index) => (
                                <div key={`dest-card-${index}`} className="h-40 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                            ))}
                        </div>
                        <div className="h-80 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                    </div>
                ) : destinationRows.length === 0 ? (
                    <EmptyState
                        title="No destination completions found"
                        description="The selected date window and destination scope did not return completed trips. Adjust the filter scope to inspect destination performance."
                    />
                ) : (
                    <div className="space-y-6">
                        <div className="grid gap-4 lg:grid-cols-3">
                            {spotlightDestinations.map((row, index) => {
                                const relativeToAverage = safeNumber(row.avg_tat_days) - destinationTatAverage;
                                const tone: Tone = relativeToAverage <= 0 ? 'good' : relativeToAverage <= 1 ? 'warning' : 'critical';
                                const styles = toneStyles(tone);
                                return (
                                    <button
                                        key={`spotlight-${row.location}-${index}`}
                                        onClick={() => handleRowDrillDown(row.location)}
                                        className={cn(
                                            'rounded-[24px] border bg-gradient-to-br p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/30',
                                            styles.border,
                                            styles.surface
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">Destination spotlight</div>
                                                <div className="mt-3 text-xl font-semibold text-white">{row.location}</div>
                                            </div>
                                            <div className={cn('rounded-2xl border border-white/5 p-3', styles.icon)}>
                                                <MapPinned className="h-5 w-5" />
                                            </div>
                                        </div>
                                        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                                            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                                                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Trips</div>
                                                <div className="mt-2 text-lg font-semibold text-white">{row.trip_count}</div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
                                                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Avg TAT</div>
                                                <div className="mt-2 text-lg font-semibold text-white">{formatDays(row.avg_tat_days)}</div>
                                            </div>
                                        </div>
                                        <p className="mt-4 text-sm leading-6 text-slate-400">
                                            {relativeToAverage <= 0
                                                ? 'Running at or better than the current destination average. Drill in for specific trip patterns.'
                                                : `Currently ${relativeToAverage.toFixed(1)}d slower than the destination average. Investigate trip mix and border exposure.`}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="overflow-hidden rounded-[24px] border border-slate-800/90 bg-slate-950/60">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[860px] text-left">
                                    <thead className="bg-slate-950/85 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                        <tr>
                                            <th className="px-5 py-4">Destination</th>
                                            <th className="px-5 py-4 text-right">Trackers</th>
                                            <th className="px-5 py-4 text-right">Trips</th>
                                            <th className="px-5 py-4 text-right">Avg TAT</th>
                                            <th className="px-5 py-4">Cycle intensity</th>
                                            <th className="px-5 py-4 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/80">
                                        {destinationRows.map((row) => {
                                            const tripWidth = maxDestinationTrips > 0 ? (safeNumber(row.trip_count) / maxDestinationTrips) * 100 : 0;
                                            const tatWidth = maxDestinationTat > 0 ? (safeNumber(row.avg_tat_days) / maxDestinationTat) * 100 : 0;
                                            const tatDelta = safeNumber(row.avg_tat_days) - destinationTatAverage;
                                            const tatTone: Tone = tatDelta <= 0 ? 'good' : tatDelta <= 1 ? 'warning' : 'critical';
                                            const styles = toneStyles(tatTone);
                                            return (
                                                <tr key={row.location} className="transition hover:bg-slate-900/70">
                                                    <td className="px-5 py-4">
                                                        <div className="font-medium text-white">{row.location}</div>
                                                        <div className="mt-1 text-xs text-slate-500">
                                                            Relative delta: {tatDelta >= 0 ? '+' : ''}{tatDelta.toFixed(1)}d vs average
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-4 text-right font-mono text-sm text-slate-200">{row.unique_trackers}</td>
                                                    <td className="px-5 py-4 text-right font-mono text-sm text-slate-200">{row.trip_count}</td>
                                                    <td className="px-5 py-4 text-right">
                                                        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-medium', styles.badge)}>
                                                            {formatDays(row.avg_tat_days)}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-4">
                                                        <div className="space-y-2">
                                                            <div>
                                                                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                                                                    <span>Trip share</span>
                                                                    <span>{formatPercent(tripWidth, 0)}</span>
                                                                </div>
                                                                <div className="h-2 rounded-full bg-slate-900">
                                                                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-400" style={{ width: `${tripWidth}%` }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                                                                    <span>TAT load</span>
                                                                    <span>{formatPercent(tatWidth, 0)}</span>
                                                                </div>
                                                                <div className="h-2 rounded-full bg-slate-900">
                                                                    <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400" style={{ width: `${tatWidth}%` }} />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-4 text-right">
                                                        <button
                                                            onClick={() => handleRowDrillDown(row.location)}
                                                            className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-500/15"
                                                        >
                                                            Inspect trips
                                                            <ArrowRight className="h-3.5 w-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </SectionShell>

            <div className="grid gap-8 xl:grid-cols-2">
                {borderSignals.map((signal) => (
                    <SectionShell
                        key={signal.key}
                        eyebrow="Border pressure"
                        title={signal.title}
                        description="Trend-aware wait analysis combining queue duration and truck throughput."
                        className="p-0"
                    >
                        <BorderPressurePanel signal={signal} />
                    </SectionShell>
                ))}
            </div>

            <SectionShell
                eyebrow="State-stop integrity"
                title="Coverage lab"
                description="A single place to monitor uncovered exposure, waiting-stage drift, and tracker-level fact alignment across the v2 engine."
                aside={
                    <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                            Gap split: disabled
                        </span>
                        <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                            Trackers: {uncoveredPayload?.total_uncovered_trackers ?? 0}
                        </span>
                    </div>
                }
            >
                {uncoveredError ? (
                    <div className="mb-6 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                        Failed to load uncovered summary: {uncoveredError}
                    </div>
                ) : null}

                {uncoveredLoading && !uncoveredPayload ? (
                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <div key={`integrity-skeleton-${index}`} className="h-28 rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                            ))}
                        </div>
                        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                            <div className="h-[560px] rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                            <div className="h-[560px] rounded-[24px] border border-slate-800 bg-slate-900/60 animate-pulse" />
                        </div>
                    </div>
                ) : uncoveredTrackers.length === 0 ? (
                    <EmptyState
                        title="No uncovered drift detected"
                        description="The selected window did not return uncovered tracker exposure. This usually means fact coverage is aligned for the current scope."
                    />
                ) : (
                    <div className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                            <MetricCard
                                label="Uncovered trips"
                                value={formatCompactNumber(uncoveredPayload?.total_uncovered_trips ?? 0)}
                                helper="Trips present in the state stream but not represented in facts."
                                icon={ShieldAlert}
                                tone={(uncoveredPayload?.total_uncovered_trips ?? 0) > 0 ? 'warning' : 'good'}
                            />
                            <MetricCard
                                label="Uncovered hours"
                                value={formatHours(uncoveredPayload?.total_uncovered_hours ?? 0)}
                                helper="Total uncovered time across all identified tracker gaps."
                                icon={Route}
                                tone="neutral"
                            />
                            <MetricCard
                                label="Waiting hours"
                                value={formatHours(uncoveredPayload?.total_waiting_stage_hours ?? 0)}
                                helper="Post-closure or maintenance dwell classified as waiting-stage time."
                                icon={Clock3}
                                tone={waitingShare != null && waitingShare >= 50 ? 'warning' : 'good'}
                            />
                            <MetricCard
                                label="Major state rows"
                                value={formatCompactNumber(uncoveredPayload?.total_uncovered_major_state_rows ?? 0)}
                                helper="High-signal state rows contributing to uncovered exposure."
                                icon={Layers3}
                                tone="warning"
                            />
                            <MetricCard
                                label="Coverage gap"
                                value={formatPercent(uncoveredPayload?.uncovered_vs_fact_pct ?? null, 1)}
                                helper="Uncovered trips as a share of fact trips for the same scope."
                                icon={Database}
                                tone={coverageGapPct == null ? 'neutral' : coverageGapPct <= 5 ? 'good' : coverageGapPct <= 20 ? 'warning' : 'critical'}
                            />
                        </div>

                        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                            <div className="overflow-hidden rounded-[24px] border border-slate-800/90 bg-slate-950/60">
                                <div className="flex flex-col gap-3 border-b border-slate-800/80 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
                                    <div>
                                        <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Tracker ranking</div>
                                        <h3 className="mt-2 text-lg font-semibold text-white">Exposure leaderboard</h3>
                                        <p className="mt-2 text-sm text-slate-400">
                                            Ranked by uncovered trip count with fact comparison, waiting hours, and last uncovered signal.
                                        </p>
                                    </div>
                                    <div className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                        Top tracker: {topExposureTracker?.tracker_name ?? '--'}
                                    </div>
                                </div>
                                <div className="max-h-[620px] overflow-auto">
                                    <table className="w-full min-w-[860px] text-left">
                                        <thead className="sticky top-0 bg-slate-950/95 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                            <tr>
                                                <th className="px-5 py-4">Tracker</th>
                                                <th className="px-5 py-4 text-right">Facts</th>
                                                <th className="px-5 py-4 text-right">Uncovered</th>
                                                <th className="px-5 py-4 text-right">Gap %</th>
                                                <th className="px-5 py-4 text-right">Waiting hrs</th>
                                                <th className="px-5 py-4 text-right">Major rows</th>
                                                <th className="px-5 py-4">Last uncovered</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/80">
                                            {uncoveredTrackers.map((row) => {
                                                const isActive = row.tracker_id === activeUncoveredTrackerId;
                                                const tone: Tone = row.uncovered_vs_fact_pct == null
                                                    ? 'neutral'
                                                    : row.uncovered_vs_fact_pct <= 5 ? 'good' : row.uncovered_vs_fact_pct <= 20 ? 'warning' : 'critical';
                                                const styles = toneStyles(tone);
                                                return (
                                                    <tr
                                                        key={`uncovered-summary-${row.tracker_id}`}
                                                        className={cn(
                                                            'cursor-pointer transition',
                                                            isActive ? 'bg-cyan-500/10' : 'hover:bg-slate-900/70'
                                                        )}
                                                        onClick={() => setSelectedUncoveredTrackerId(row.tracker_id)}
                                                    >
                                                        <td className="px-5 py-4">
                                                            <div className="font-medium text-white">{row.tracker_name}</div>
                                                            <div className="mt-1 text-xs text-slate-500">ID {row.tracker_id}</div>
                                                        </td>
                                                        <td className="px-5 py-4 text-right font-mono text-sm text-slate-200">{row.fact_trip_count}</td>
                                                        <td className="px-5 py-4 text-right font-mono text-sm text-orange-200">{row.uncovered_trip_count}</td>
                                                        <td className="px-5 py-4 text-right">
                                                            <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-medium', styles.badge)}>
                                                                {row.uncovered_vs_fact_pct == null ? '--' : formatPercent(row.uncovered_vs_fact_pct, 1)}
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-4 text-right font-mono text-sm text-cyan-100">{formatHours(row.waiting_stage_hours)}</td>
                                                        <td className="px-5 py-4 text-right font-mono text-sm text-slate-200">{row.uncovered_major_state_rows}</td>
                                                        <td className="px-5 py-4 text-sm text-slate-300">{formatUtcDate(row.last_uncovered_trip_end_utc)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-[24px] border border-slate-800/90 bg-slate-950/60 p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Tracker focus</div>
                                            <h3 className="mt-2 text-lg font-semibold text-white">
                                                {activeTrackerSummary?.tracker_name || trackerInspectorData?.tracker_name || 'Select a tracker'}
                                            </h3>
                                            <p className="mt-2 text-sm text-slate-400">
                                                Compare fact coverage against uncovered trip groups and inspect the most recent state mix for the selected tracker.
                                            </p>
                                        </div>
                                        {trackerInspectorLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" /> : null}
                                    </div>

                                    {activeTrackerSummary ? (
                                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
                                                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Facts vs uncovered</div>
                                                <div className="mt-2 flex items-end gap-3">
                                                    <div className="text-2xl font-semibold text-white">{activeTrackerSummary.fact_trip_count}</div>
                                                    <div className="text-sm text-slate-400">facts</div>
                                                    <div className="text-2xl font-semibold text-orange-200">{activeTrackerSummary.uncovered_trip_count}</div>
                                                    <div className="text-sm text-slate-400">uncovered</div>
                                                </div>
                                                <p className="mt-3 text-sm text-slate-400">
                                                    Coverage gap: {activeTrackerSummary.uncovered_vs_fact_pct == null ? '--' : formatPercent(activeTrackerSummary.uncovered_vs_fact_pct, 1)}.
                                                </p>
                                            </div>
                                            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
                                                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Exposure profile</div>
                                                <div className="mt-2 text-2xl font-semibold text-white">{formatHours(activeTrackerSummary.uncovered_total_hours)}</div>
                                                <p className="mt-3 text-sm text-slate-400">
                                                    {activeTrackerSummary.waiting_stage_rows} waiting rows, {activeTrackerSummary.uncovered_major_state_rows} major rows, last uncovered {formatUtcDate(activeTrackerSummary.last_uncovered_trip_end_utc)}.
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-5 rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 p-6 text-sm text-slate-400">
                                            Select a tracker from the leaderboard to open the focus view.
                                        </div>
                                    )}

                                    {trackerInspectorError ? (
                                        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                                            Failed to load tracker drilldown: {trackerInspectorError}
                                        </div>
                                    ) : null}
                                </div>

                                <div className="grid gap-4 xl:grid-cols-1">
                                    <div className="overflow-hidden rounded-[24px] border border-slate-800/90 bg-slate-950/60">
                                        <div className="border-b border-slate-800/80 px-4 py-3">
                                            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-300">Fact trips</div>
                                        </div>
                                        {trackerInspectorLoading && !trackerInspectorData ? (
                                            <div className="h-56 animate-pulse bg-slate-900/60" />
                                        ) : !trackerInspectorData ? (
                                            <div className="px-4 py-8 text-sm text-slate-500">No tracker detail selected yet.</div>
                                        ) : (
                                            <div className="max-h-[280px] overflow-auto">
                                                <table className="w-full min-w-[680px] text-left">
                                                    <thead className="sticky top-0 bg-slate-950/95 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                                        <tr>
                                                            <th className="px-4 py-3">Trip key</th>
                                                            <th className="px-4 py-3">Status</th>
                                                            <th className="px-4 py-3">Destination</th>
                                                            <th className="px-4 py-3">Terminal</th>
                                                            <th className="px-4 py-3">End</th>
                                                            <th className="px-4 py-3 text-right">Hours</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-800/80">
                                                        {trackerInspectorData.fact_trips.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                                                                    No fact trips for this tracker in the current range.
                                                                </td>
                                                            </tr>
                                                        ) : trackerInspectorData.fact_trips.map((trip) => (
                                                            <tr key={`fact-${trip.trip_key}`} className="text-sm text-slate-300">
                                                                <td className="px-4 py-3 font-mono text-[11px] text-slate-200">{trip.trip_key}</td>
                                                                <td className="px-4 py-3">{trip.trip_status}</td>
                                                                <td className="px-4 py-3">{trip.destination_name || '--'}</td>
                                                                <td className="px-4 py-3">{trip.loading_terminal || '--'}</td>
                                                                <td className="px-4 py-3">{formatUtcDate(trip.trip_end_utc)}</td>
                                                                <td className="px-4 py-3 text-right font-mono">{formatHours(trip.trip_duration_hours)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>

                                    <div className="overflow-hidden rounded-[24px] border border-slate-800/90 bg-slate-950/60">
                                        <div className="border-b border-slate-800/80 px-4 py-3">
                                            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-orange-300">Uncovered trips</div>
                                        </div>
                                        {trackerInspectorLoading && !trackerInspectorData ? (
                                            <div className="h-56 animate-pulse bg-slate-900/60" />
                                        ) : !trackerInspectorData ? (
                                            <div className="px-4 py-8 text-sm text-slate-500">No uncovered groups available yet.</div>
                                        ) : (
                                            <div className="max-h-[280px] overflow-auto">
                                                <table className="w-full min-w-[700px] text-left">
                                                    <thead className="sticky top-0 bg-slate-950/95 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                                        <tr>
                                                            <th className="px-4 py-3">Trip key</th>
                                                            <th className="px-4 py-3">Start</th>
                                                            <th className="px-4 py-3">End</th>
                                                            <th className="px-4 py-3 text-right">Hours</th>
                                                            <th className="px-4 py-3">Last geofence</th>
                                                            <th className="px-4 py-3">State mix</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-800/80">
                                                        {trackerInspectorData.uncovered_trips.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                                                                    No uncovered trips for this tracker in the current range.
                                                                </td>
                                                            </tr>
                                                        ) : trackerInspectorData.uncovered_trips.map((trip) => (
                                                            <tr key={`uncovered-${trip.trip_key}`} className="text-sm text-slate-300">
                                                                <td className="px-4 py-3 font-mono text-[11px] text-orange-200">{trip.trip_key}</td>
                                                                <td className="px-4 py-3">{formatUtcDate(trip.trip_start_utc)}</td>
                                                                <td className="px-4 py-3">{formatUtcDate(trip.trip_end_utc)}</td>
                                                                <td className="px-4 py-3 text-right font-mono">{formatHours(trip.trip_duration_hours)}</td>
                                                                <td className="px-4 py-3">{trip.trip_last_geofence_name || '--'}</td>
                                                                <td className="px-4 py-3 text-xs text-slate-400">
                                                                    {trip.trip_stop_states.length > 0 ? trip.trip_stop_states.join(', ') : '--'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </SectionShell>

            <ActiveTripQueuesModule
                key={isActiveQueuesOpen ? `active-queues-${activeQueueInitialTab}` : 'active-queues-closed'}
                isOpen={isActiveQueuesOpen}
                onClose={() => setIsActiveQueuesOpen(false)}
                data={activeQueueDetails}
                loading={activeQueueLoading}
                error={activeQueueError}
                initialTab={activeQueueInitialTab}
            />

            <CompletedTripFactsModule
                key={
                    isCompletedFactsOpen
                        ? `completed-facts-${completedFactsScope.start}-${completedFactsScope.end}-${completedFactsScope.destination || 'all'}`
                        : 'completed-facts-closed'
                }
                isOpen={isCompletedFactsOpen}
                onClose={handleCompletedFactsClose}
                data={completedFactsData}
                loading={completedFactsLoading}
                error={completedFactsError}
                searchTerm={completedFactsSearchTerm}
                onSearchTermChange={handleCompletedFactsSearchChange}
                currentPage={completedFactsPage}
                onPageChange={handleCompletedFactsPageChange}
                destinationScopeLabel={completedFactsScope.destination || 'Fleet-wide scope'}
                dateWindowLabel={`${formatDateChip(completedFactsScope.start)} - ${formatDateChip(completedFactsScope.end)}`}
            />

            <TripCompletionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                data={tripDetails as unknown as React.ComponentProps<typeof TripCompletionModal>['data']}
                loading={detailsLoading}
                error={detailsError}
                onPageChange={handleModalPageChange}
                initialTab={modalTab}
                initialDestination={modalDestination}
                initialOrigin={modalOrigin}
                initialTrackerId={modalTrackerId}
                initialTripType={modalTripType}
            />
        </div>
    );
}
