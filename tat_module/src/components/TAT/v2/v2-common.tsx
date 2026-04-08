import React from 'react';
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
    MapPinned, 
    Route, 
    ShieldAlert, 
    Sparkles, 
    Target, 
    TrendingDown, 
    TrendingUp, 
    Truck, 
    Waypoints,
    MapPin,
    AlertTriangle,
    CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';

// --- Shared Interfaces ---
export type ModalStatus =
    | 'completed'
    | 'returning'
    | 'unfinished'
    | 'completed_or_returning'
    | 'completed_missed_dest';

export type Tone = 'neutral' | 'good' | 'warning' | 'critical';

export interface BorderTrendRow {
    day_date: string;
    avg_outbound_dwell_hrs: number;
    avg_return_dwell_hrs: number;
    truck_count: number;
}

export interface BorderSignal {
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

export interface KPIStatsShape {
    avg_waiting_hrs: number;
    avg_transit_to_load_hrs: number;
    avg_loading_hrs: number;
    avg_border_hrs: number;
    avg_offloading_hrs: number;
    trip_completion_rate: number;
    trips_departed: number;
    trips_completed: number;
}

export interface OverviewMetric {
    label: string;
    value: string;
    helper: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
}

export interface StageMetric {
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

export interface InsightMetric {
    title: string;
    value: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
}

export interface VisitEvent {
    geofence_name: string;
    in_time: string;
    out_time: string | null;
    event_type: 'loading' | 'unloading' | 'border' | 'transit';
}

export interface TimelineEvent {
    event_code?: string;
    event_time?: string;
    canonical_name?: string;
    role_code?: string;
    trip_stage?: string;
    stop_state?: string;
}

export interface BorderCrossing {
    border_code?: string;
    border_name?: string;
    entry_time?: string;
    exit_time?: string;
}

export interface V2TripRow {
    [key: string]: unknown;
    tracker_id: number;
    tracker_name: string;
    trip_status?: string;
    status?: string;
    /** Server-side corrected status: 'returning' overridden to 'at_destination' when exit was a midnight artifact */
    effective_trip_status?: string | null;
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
    /** loading_end with midnight-boundary nulled out */
    effective_loading_end?: string | null;
    dest_entry?: string | null;
    dest_exit?: string | null;
    /** dest_exit with midnight-boundary nulled out */
    effective_dest_exit?: string | null;
    customer_entry?: string | null;
    customer_exit?: string | null;
    /** customer_exit with midnight-boundary nulled out */
    effective_customer_exit?: string | null;
    completion_time?: string | null;
    trip_closed_at?: string | null;
    next_dar_entry?: string | null;
    next_loading_entry?: string | null;
    source_completion_time?: string | null;
    source_trip_closed_at?: string | null;
    source_next_dar_entry?: string | null;
    source_next_loading_entry?: string | null;
    active_queue_status?: string | null;
    missed_destination?: boolean;
    visit_chain?: VisitEvent[];
    timeline?: TimelineEvent[];
    border_crossings?: BorderCrossing[];
    destination_dwell_hrs?: number | null;
    dest_dwell_hrs?: number | null;
    drc_region_hrs?: number | null;
    closure_geofence?: string | null;
    last_destination?: string | null;
    is_returning?: boolean | null;
    /** TRUE when the truck's most recent exit is a 23:59:59 system boundary — truck is still physically present */
    is_midnight_split_state?: boolean | null;
    /** Live dwell hours since dest_entry / customer_entry, computed server-side */
    live_dest_dwell_hrs?: number | null;
    /** Live dwell hours since loading_start when loading is still in progress */
    live_loading_dwell_hrs?: number | null;
    closure_geofence_canonical?: string | null;
    last_destination_canonical?: string | null;
    /** Phase 66: number of destination stops in this trip */
    dest_stop_count?: number | null;
    /** Phase 66b: last destination exit (for return_hrs calc) */
    last_dest_exit?: string | null;
    /** Phase 66b: last destination name */
    last_dest_name?: string | null;
}

export interface DestinationSummaryRow {
    location: string;
    unique_trackers: number;
    trip_count: number;
    avg_tat_days: number;
}

// --- Shared Helper Functions ---

export function safeNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function formatHours(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${Number(value).toFixed(2)}h`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${Number(value).toFixed(digits)}%`;
}

export function formatCompactNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatDays(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${Number(value).toFixed(1)}d`;
}

export function normaliseFilter(value: string | null | undefined): string | null {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower === 'all' || lower.startsWith('all ')) return null;
    return value;
}

export function toUtcDayStart(dateValue: string): string {
    const dt = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return dateValue;
    return dt.toISOString();
}

export function toUtcDayEndExclusive(dateValue: string): string {
    const dt = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return dateValue;
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString();
}

export function escapePostgrestLiteral(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapePostgrestLike(value: string): string {
    return escapePostgrestLiteral(value).replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function hasTimestamp(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function isOperationallyActive(row: V2TripRow): boolean {
    const status = String(row?.trip_status || row?.status || '').toLowerCase();
    const hasNext = hasTimestamp(row?.next_loading_entry) || hasTimestamp(row?.source_next_loading_entry);
    return !hasNext && (
        status === 'loading' || 
        status === 'pre_transit' || 
        status === 'in_transit' || 
        status === 'at_destination' || 
        status === 'returning'
    );
}

export function describeSupabaseError(error: unknown, fallback: string): string {
    if (!error) return fallback;
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error || fallback;
    if (typeof error === 'object') {
        const err = error as Record<string, unknown>;
        return (err.message || err.details || err.hint || JSON.stringify(err)) as string;
    }
    return fallback;
}

/**
 * Detects midnight-split boundary timestamps.
 * Returns TRUE for any timestamp at exactly 23:59:59 UTC, which indicates
 * a system-generated daily data population boundary — not a real exit.
 */
export function isMidnightBoundary(value: string | null | undefined): boolean {
    if (!value) return false;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return false;
    return dt.getUTCHours() === 23 && dt.getUTCMinutes() === 59 && dt.getUTCSeconds() === 59;
}

/**
 * Returns the timestamp if it's a real exit, or null if it's a midnight split.
 */
export function effectiveExit(value: string | null | undefined): string | null {
    if (!value) return null;
    return isMidnightBoundary(value) ? null : value;
}

/**
 * Returns TRUE if the row is in a "midnight split" state — meaning the truck's
 * most recent exit timestamp is a 23:59:59 system boundary, not a physical exit.
 * In this state the truck is still physically at the geofence.
 *
 * Priority: uses the server-supplied `is_midnight_split_state` flag when present,
 * then falls back to client-side inspection of the raw timestamps.
 */
export function isMidnightSplitState(row: Record<string, unknown> | null | undefined): boolean {
    if (!row) return false;
    // Server-side flag takes priority (from Phase 64 get_active_queues_v2)
    if (typeof row.is_midnight_split_state === 'boolean') return row.is_midnight_split_state;
    // Client-side inference: check dest_exit, customer_exit, loading_end
    return (
        isMidnightBoundary(row.dest_exit as string | null)     ||
        isMidnightBoundary(row.customer_exit as string | null) ||
        isMidnightBoundary(row.loading_end as string | null)
    );
}

/**
 * Returns the display status label for a trip row, correcting for midnight-split
 * artifacts. When the server supplies `effective_trip_status` (Phase 64+), that
 * value is used. Otherwise it falls back to client-side correction.
 */
export function resolveDisplayStatus(row: V2TripRow | Record<string, unknown>): string {
    const effective = (row as V2TripRow).effective_trip_status;
    if (effective) return effective;
    const raw = String((row as V2TripRow).trip_status || (row as V2TripRow).status || 'unknown');
    // If status is 'returning' but dest_exit is a midnight boundary, truck is still at destination
    if (raw === 'returning' && isMidnightSplitState(row as Record<string, unknown>)) {
        return 'at_destination';
    }
    return raw;
}

/**
 * Determines if a truck is currently in the "returning" state.
 * A truck is returning if it has exited the destination but has NOT
 * completed the trip cycle (no closure event, no next loading entry).
 * Midnight-boundary exits (23:59:59) are treated as still-at-destination.
 */
export function isReturningState(row: any): boolean {
    const status = String(row.trip_status || row.status || '').toLowerCase();
    // If status says returning BUT the exit is a midnight split, the truck is actually still there
    if (status === 'returning') {
        const realDestExit = effectiveExit(row.dest_exit);
        const realCustExit = effectiveExit(row.customer_exit);
        // If there's no real exit, the truck hasn't actually left — it's a midnight artifact
        if (!realDestExit && !realCustExit && (isMidnightBoundary(row.dest_exit) || isMidnightBoundary(row.customer_exit))) {
            return false;
        }
        return true;
    }
    // Exited destination but no closure yet (only if it's a real exit)
    const destExitReal = effectiveExit(row.dest_exit);
    const custExitReal = effectiveExit(row.customer_exit);
    if ((destExitReal || custExitReal) 
        && !row.completion_time 
        && !row.trip_closed_at 
        && !row.next_loading_entry) {
        return true;
    }
    return false;
}

export function calculateActiveQueueStatus(row: any): string | null {
    const status = String(row.trip_status || row.status || '').toLowerCase();
    const returning = isReturningState(row);
    
    // 1. At Border (Highest operational priority)
    const borders = [
        'tunduma', 'nakonde', 'kasumbalesa', 'sakania', 
        'mokambo', 'chembe', 'kasumulu', 'other'
    ];
    for (const b of borders) {
        const entry = row[`border_${b}_entry`] || row[`return_border_${b}_entry`];
        const exit = row[`border_${b}_exit`] || row[`return_border_${b}_exit`];
        if (entry && !exit) return 'active_at_border';
    }

    // 2. Awaiting Unloading (At destination/customer site)
    //    Midnight-boundary exits don't count as real exits — truck is still there
    const realDestExit = effectiveExit(row.dest_exit);
    const realCustExit = effectiveExit(row.customer_exit);
    if (row.dest_entry || row.customer_entry) {
        if (!realDestExit && !realCustExit) {
            return 'active_awaiting_unloading';
        }
    }

    // 3. Just Delivered (Exited destination, currently returning)
    // If truck is returning to origin but hasn't arrived/closed, it is NOT "awaiting next load"
    if (returning) {
        return 'active_just_delivered';
    }

    // 4. Loading Live (Started loading, still in terminal)
    if (row.loading_start && !row.loading_end) {
        return 'active_loading_started';
    }

    // 5. Loaded (Finished loading, in transit)
    if (row.loading_end && !row.dest_entry && !row.customer_entry) {
        return 'active_loading_completed';
    }

    // 6. Awaiting Next Load — STRICT CLOSURE LOGIC:
    //    Trip status must be CLOSED (completed) AND is_returning must be FALSE.
    //    If a truck is returning but hasn't arrived/closed, it is NOT "awaiting next load".
    const isClosed = status === 'completed' || status === 'completed_missed_dest';
    if (isClosed && !returning) {
        return 'active_waiting_next_load';
    }

    // Fallback: completion/closure signals without strict closure
    if (row.completion_time || row.trip_closed_at || row.next_loading_entry) {
        return 'active_waiting_next_load';
    }

    return null;
}

export function adaptV2TripRow(row: any): V2TripRow {
    const adapted = {
        ...row,
        trip_status: row.trip_status || row.status,
        destination_name: row.destination_name || row.dest_name,
        dest_name: row.dest_name || row.destination_name,
        origin_arrival: row.origin_arrival || row.dar_arrival,
        dar_arrival: row.dar_arrival || row.origin_arrival,
        origin_exit: row.origin_exit || row.dar_exit,
        dar_exit: row.dar_exit || row.origin_exit,
        completion_time: row.completion_time || row.trip_closed_at,
        trip_closed_at: row.trip_closed_at || row.completion_time,
    };

    return {
        ...adapted,
        active_queue_status: row.active_queue_status || calculateActiveQueueStatus(adapted)
    };
}

export function toneStyles(tone: Tone): { badge: string; icon: string; surface: string; border: string; text: string } {
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

// --- Shared UI Components ---

export function EmptyState({
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

export function SectionShell({
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

export function MetricCard({
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
                    <div className={cn('mt-3 text-3xl font-bold tracking-tight', styles.text)}>{value}</div>
                </div>
                <div className={cn('rounded-2xl border border-white/5 p-3', styles.icon)}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400/90">{helper}</p>
        </div>
    );
}
