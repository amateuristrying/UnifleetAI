'use client';

import React from 'react';
import {
    ArrowLeft,
    ArrowRight,
    Clock3,
    Database,
    LoaderCircle,
    MapPinned,
    Route,
    Search,
    ShieldAlert,
    Sparkles,
    Truck,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CompletedFactRow {
    trip_key: string;
    tracker_id: number;
    tracker_name: string;
    trip_status?: string | null;
    trip_closure_reason?: string | null;
    trip_type?: string | null;
    loading_terminal?: string | null;
    origin_region?: string | null;
    destination_name?: string | null;
    customer_name?: string | null;
    loading_start?: string | null;
    loading_end?: string | null;
    origin_exit?: string | null;
    dest_entry?: string | null;
    dest_exit?: string | null;
    customer_entry?: string | null;
    customer_exit?: string | null;
    completion_time?: string | null;
    trip_closed_at?: string | null;
    total_tat_hrs?: number | null;
    waiting_for_orders_hrs?: number | null;
    loading_phase_hrs?: number | null;
    post_loading_delay_hrs?: number | null;
    transit_hrs?: number | null;
    border_total_hrs?: number | null;
    destination_dwell_hrs?: number | null;
    customer_dwell_hrs?: number | null;
    return_hrs?: number | null;
    lifecycle_confidence?: number | null;
    missed_destination_flag?: boolean | null;
    route_anomaly_flag?: boolean | null;
    low_confidence_flag?: boolean | null;
}

export interface CompletedFactsPayload {
    total_count: number;
    limit: number;
    offset: number;
    data: CompletedFactRow[];
    generated_at?: string | null;
}

interface CompletedTripFactsModuleProps {
    isOpen: boolean;
    onClose: () => void;
    data: CompletedFactsPayload | null;
    loading: boolean;
    error?: string | null;
    searchTerm: string;
    onSearchTermChange: (value: string) => void;
    currentPage: number;
    onPageChange: (page: number) => void;
    destinationScopeLabel: string;
    dateWindowLabel: string;
}

const EMPTY_COMPLETED_ROWS: CompletedFactRow[] = [];

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
    return `${Number(value).toFixed(1)}h`;
}

function formatCompactNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number | null | undefined, digits = 0): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return `${Number(value).toFixed(digits)}%`;
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDestinationLabel(row: CompletedFactRow): string {
    return row.customer_name || row.destination_name || 'Undeclared destination';
}

function getOriginLabel(row: CompletedFactRow): string {
    return row.loading_terminal || row.origin_region || 'Unknown origin';
}

function getExceptionFlags(row: CompletedFactRow): string[] {
    const flags: string[] = [];
    if (row.missed_destination_flag) flags.push('Missed destination');
    if (row.route_anomaly_flag) flags.push('Route anomaly');
    if (row.low_confidence_flag) flags.push('Low confidence');
    return flags;
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
        <div className="rounded-[24px] border border-slate-800/90 bg-slate-950/55 p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">{label}</div>
            <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
            <p className="mt-2 text-sm leading-6 text-slate-400">{helper}</p>
        </div>
    );
}

export function CompletedTripFactsModule({
    isOpen,
    onClose,
    data,
    loading,
    error,
    searchTerm,
    onSearchTermChange,
    currentPage,
    onPageChange,
    destinationScopeLabel,
    dateWindowLabel,
}: CompletedTripFactsModuleProps) {
    const rows = data?.data ?? EMPTY_COMPLETED_ROWS;
    const searchActive = searchTerm.trim().length > 0;
    const pageStart = rows.length === 0 ? 0 : (data?.offset || 0) + 1;
    const pageEnd = rows.length === 0 ? 0 : (data?.offset || 0) + rows.length;
    const totalPages = Math.max(1, Math.ceil((data?.total_count || 0) / Math.max(1, data?.limit || 500)));
    const avgTat = average(rows.map((row) => row.total_tat_hrs).filter((value): value is number => value != null && Number.isFinite(value)));
    const avgConfidence = average(
        rows
            .map((row) => row.lifecycle_confidence)
            .filter((value): value is number => value != null && Number.isFinite(value))
    );
    const flaggedRows = rows.filter((row) => getExceptionFlags(row).length > 0).length;
    const missedDestinationRows = rows.filter((row) => row.trip_status === 'completed_missed_dest').length;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-950/82 backdrop-blur-md">
            <div className="mx-auto flex h-full max-w-[1760px] flex-col p-3 sm:p-4">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-800/90 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.10),_transparent_30%),linear-gradient(135deg,_rgba(2,6,23,0.98),_rgba(15,23,42,0.96))] shadow-[0_32px_120px_-48px_rgba(15,23,42,0.95)]">
                    <div className="border-b border-slate-800/80 px-5 py-5 sm:px-6">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/15 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-200">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Completed Facts Registry
                                </div>
                                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Direct facts-table view for completed lifecycle outputs</h2>
                                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                                    Browse completed and completed-with-exception rows directly from the facts table, scoped to the current dashboard window and destination selection.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    Window {dateWindowLabel}
                                </span>
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    Scope {destinationScopeLabel}
                                </span>
                                {loading ? (
                                    <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium text-sky-100">
                                        Updating results...
                                    </span>
                                ) : null}
                                {data?.generated_at ? (
                                    <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                        Snapshot {formatDate(data.generated_at)}
                                    </span>
                                ) : null}
                                <button
                                    onClick={onClose}
                                    className="inline-flex items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-950/70 p-3 text-slate-300 transition hover:border-slate-600 hover:text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                            <label>
                                <span className="mb-2 block text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Quick search</span>
                                <div className="flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 px-4 py-2.5 text-sm text-white">
                                    <Search className="h-4 w-4 text-slate-500" />
                                    <input
                                        value={searchTerm}
                                        onChange={(e) => onSearchTermChange(e.target.value)}
                                        placeholder="Search full facts scope by trip, truck, route, closure"
                                        className="w-full bg-transparent outline-none placeholder:text-slate-500"
                                    />
                                </div>
                            </label>

                            <div className="grid gap-4 sm:grid-cols-4">
                                <SummaryCard
                                    label="Rows in Scope"
                                    value={formatCompactNumber(data?.total_count || 0)}
                                    helper={searchActive
                                        ? 'Total database matches across the selected scope for the current search.'
                                        : 'Total completed fact rows in the selected date and destination scope.'}
                                />
                                <SummaryCard
                                    label="Avg TAT"
                                    value={formatHours(avgTat)}
                                    helper="Average total TAT across the currently visible facts rows."
                                />
                                <SummaryCard
                                    label="Avg Confidence"
                                    value={formatPercent(avgConfidence == null ? null : avgConfidence * 100, 0)}
                                    helper="Mean lifecycle confidence across the facts currently in view."
                                />
                                <SummaryCard
                                    label="Flagged Rows"
                                    value={`${flaggedRows} / ${missedDestinationRows}`}
                                    helper="Rows with engine flags, with missed-destination rows shown after the slash."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                        {loading && !data ? (
                            <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-slate-800/80 bg-slate-950/40">
                                <div className="flex items-center gap-3 text-sm text-slate-300">
                                    <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
                                    Loading completed facts module...
                                </div>
                            </div>
                        ) : error && !data ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-rose-500/20 bg-rose-500/5 px-6 text-center">
                                <ShieldAlert className="h-8 w-8 text-rose-300" />
                                <h3 className="mt-4 text-lg font-semibold text-white">Unable to load completed facts</h3>
                                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">{error}</p>
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-700/80 bg-slate-950/40 px-6 text-center">
                                <Database className="h-8 w-8 text-slate-400" />
                                <h3 className="mt-4 text-lg font-semibold text-white">No completed facts in view</h3>
                                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                                    There are no completed fact rows for the current scope. Try clearing the search or adjusting the dashboard filters.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-[28px] border border-slate-800/90 bg-slate-950/55">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-800/70 text-sm">
                                        <thead className="bg-slate-950/80 text-xs uppercase tracking-[0.22em] text-slate-500">
                                            <tr>
                                                <th className="px-5 py-4 text-left font-medium">Truck</th>
                                                <th className="px-5 py-4 text-left font-medium">Route</th>
                                                <th className="px-5 py-4 text-left font-medium">Lifecycle</th>
                                                <th className="px-5 py-4 text-left font-medium">Anchors</th>
                                                <th className="px-5 py-4 text-left font-medium">TAT Split</th>
                                                <th className="px-5 py-4 text-left font-medium">Quality</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/70">
                                            {rows.map((row) => {
                                                const flags = getExceptionFlags(row);
                                                const qualityTone = flags.length > 0
                                                    ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                                                    : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';
                                                const statusTone = row.trip_status === 'completed_missed_dest'
                                                    ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                                                    : 'border-sky-400/20 bg-sky-500/10 text-sky-100';

                                                return (
                                                    <tr key={row.trip_key} className="align-top hover:bg-slate-900/45">
                                                        <td className="px-5 py-4">
                                                            <div className="flex items-start gap-3">
                                                                <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-2.5 text-sky-200">
                                                                    <Truck className="h-4 w-4" />
                                                                </div>
                                                                <div>
                                                                    <div className="font-medium text-white">{row.tracker_name}</div>
                                                                    <div className="mt-1 text-xs text-slate-500">Tracker ID {row.tracker_id}</div>
                                                                    <div className="mt-2 font-mono text-[11px] text-slate-300">{row.trip_key}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4 text-slate-300">
                                                            <div className="max-w-[320px] font-medium text-white">
                                                                {getOriginLabel(row)} <span className="text-slate-500">→</span> {getDestinationLabel(row)}
                                                            </div>
                                                            <div className="mt-2 flex flex-wrap gap-2">
                                                                <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium', statusTone)}>
                                                                    {row.trip_status === 'completed_missed_dest' ? 'Completed + exception' : 'Completed'}
                                                                </span>
                                                                <span className="inline-flex rounded-full border border-slate-700/80 bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                                                                    {row.trip_type ? row.trip_type.replace(/_/g, ' ') : 'Unknown type'}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4 text-slate-300">
                                                            <div className="font-medium text-white">{row.trip_closure_reason || 'No closure reason'}</div>
                                                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                                                                <MapPinned className="h-3.5 w-3.5 text-slate-500" />
                                                                <span>{row.customer_name ? 'Customer-linked completion' : 'Destination-linked completion'}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                                                                <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                                                                <span>Wait {formatHours(row.waiting_for_orders_hrs)} · Post-load {formatHours(row.post_loading_delay_hrs)}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="grid gap-2 text-xs">
                                                                <div>
                                                                    <div className="text-slate-500">Loading start</div>
                                                                    <div className="mt-1 text-sm text-white">{formatDate(row.loading_start)}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-slate-500">Delivery completion</div>
                                                                    <div className="mt-1 text-sm text-white">{formatDate(row.completion_time)}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-slate-500">Trip closed</div>
                                                                    <div className="mt-1 text-sm text-white">{formatDate(row.trip_closed_at)}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4 text-sm text-slate-300">
                                                            <div className="flex items-center gap-2">
                                                                <Database className="h-4 w-4 text-sky-300" />
                                                                <span>Total {formatHours(row.total_tat_hrs)}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <Truck className="h-4 w-4 text-orange-300" />
                                                                <span>Loading {formatHours(row.loading_phase_hrs)}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <Route className="h-4 w-4 text-cyan-300" />
                                                                <span>Transit {formatHours(row.transit_hrs)}</span>
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <Clock3 className="h-4 w-4 text-fuchsia-300" />
                                                                <span>Return {formatHours(row.return_hrs)}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-4">
                                                            <div className="inline-flex rounded-full border border-slate-700/80 bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-white">
                                                                Confidence {formatPercent(row.lifecycle_confidence == null ? null : row.lifecycle_confidence * 100, 0)}
                                                            </div>
                                                            <div className="mt-2 flex flex-wrap gap-2">
                                                                {flags.length === 0 ? (
                                                                    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium', qualityTone)}>
                                                                        Engine clean
                                                                    </span>
                                                                ) : flags.map((flag) => (
                                                                    <span
                                                                        key={`${row.trip_key}-${flag}`}
                                                                        className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium', qualityTone)}
                                                                    >
                                                                        {flag}
                                                                    </span>
                                                                ))}
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
                    </div>

                    <div className="border-t border-slate-800/80 px-5 py-4 sm:px-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm text-slate-400">
                                Showing rows {pageStart}-{pageEnd} of {formatCompactNumber(data?.total_count || 0)} facts in scope.
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    Page {currentPage + 1} of {totalPages}
                                </span>
                                <span className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-300">
                                    {searchActive ? 'Search spans full DB scope' : 'Default view paged at 500 rows'}
                                </span>
                                <button
                                    onClick={() => onPageChange(Math.max(0, currentPage - 1))}
                                    disabled={currentPage === 0 || loading}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Previous
                                </button>
                                <button
                                    onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
                                    disabled={currentPage >= totalPages - 1 || loading}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Next
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
