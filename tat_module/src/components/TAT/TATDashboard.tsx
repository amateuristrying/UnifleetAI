'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { KPIStats } from './KPIStats';
import { BorderChart } from './BorderChart';
import { TripCompletionModal } from './TripCompletionModal';
import { Calendar } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Normalises filter select values to null before sending to the RPC */
function normaliseFilter(value: string | null | undefined): string | null {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower === 'all' || lower.startsWith('all ')) return null;
    return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function TATDashboard() {
    // ── Dashboard-level state ─────────────────────────────────────────────────
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [tundumaData, setTundumaData] = useState<any[]>([]);
    const [kasumbalData, setKasumbalData] = useState<any[]>([]);
    const [destinationSummary, setDestinationSummary] = useState<any[]>([]);
    const [selectedDestination, setSelectedDestination] = useState<string>('All Destinations');

    // Default to last 7 days
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
    });

    // ── Modal state ──────────────────────────────────────────────────────────
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tripDetails, setTripDetails] = useState<any>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);

    /**
     * Active modal filter state — these are the canonical values used for
     * pagination / tab switching within the open modal.  They are updated
     * whenever the modal raises an onPageChange event so that the next
     * call uses the same filter snapshot.
     */
    const [modalTab, setModalTab] = useState<'completed' | 'returning' | 'unfinished' | 'completed_or_returning' | 'completed_missed_dest'>('completed_or_returning');
    const [modalDestination, setModalDestination] = useState<string | null>(null);
    const [modalOrigin, setModalOrigin] = useState<string | null>(null);
    const [modalTrackerId, setModalTrackerId] = useState<number | null>(null);   // NEW
    const [modalTripType, setModalTripType] = useState<string | null>(null);  // NEW

    // ── Dashboard data fetch ─────────────────────────────────────────────────
    useEffect(() => {
        if (!dateRange.start || !dateRange.end) {
            setLoading(false);
            return;
        }
        fetchDashboardData();
    }, [dateRange, selectedDestination]);

    async function fetchDashboardData() {
        setLoading(true);
        try {
            const destParam = normaliseFilter(selectedDestination);

            const [statsRes, tundumaRes, kasumbalRes, summaryRes] = await Promise.all([
                supabase.rpc('get_tat_fleet_stats', {
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
                supabase.rpc('get_tat_summary_by_destination', {
                    p_start_date: dateRange.start,
                    p_end_date: dateRange.end,
                }),
            ]);

            if (statsRes.error) console.error('Stats Error:', statsRes.error);
            else setStats(statsRes.data);

            if (tundumaRes.error) console.error('Tunduma Error:', tundumaRes.error);
            else setTundumaData(tundumaRes.data || []);

            if (kasumbalRes.error) console.error('Kasumbal Error:', kasumbalRes.error);
            else setKasumbalData(kasumbalRes.data || []);

            if (summaryRes.error) console.error('Summary Error:', summaryRes.error);
            else setDestinationSummary(summaryRes.data || []);

        } catch (e) {
            console.error('Dashboard fetch failed', e);
        } finally {
            setLoading(false);
        }
    }

    // ── Trip details RPC ─────────────────────────────────────────────────────
    /**
     * Core fetcher.  Every filter parameter is explicit here so callers
     * never accidentally rely on stale state.
     *
     * FIX: p_tracker_id and p_trip_type were previously never forwarded
     *      to the RPC — they are now included.
     */
    const fetchTripDetails = useCallback(async (
        page: number,
        status: string | null,
        destination: string | null,
        sort: string = 'tat_desc',
        origin: string | null = null,
        trackerId: number | null = null,   // NEW
        tripType: string | null = null,   // NEW
    ) => {
        setDetailsLoading(true);
        setDetailsError(null);

        const PAGE_SIZE = 100;

        try {
            const { data, error } = await supabase.rpc('get_tat_trip_details', {
                p_start_date: dateRange.start,
                p_end_date: dateRange.end,
                p_limit: PAGE_SIZE,
                p_offset: page * PAGE_SIZE,
                p_status: status,
                p_destination: normaliseFilter(destination),
                p_sort: sort,
                p_origin: normaliseFilter(origin),
                // Previously missing — now correctly forwarded:
                p_tracker_id: trackerId ?? null,
                p_trip_type: normaliseFilter(tripType),
            });

            if (error) {
                console.error('Trip details RPC error:', error);
                setDetailsError(error.message || 'Failed to load trip details.');
                return;
            }
            setTripDetails(data);
        } catch (e: any) {
            console.error('fetchTripDetails failed', e);
            setDetailsError(e?.message || 'Unexpected error.');
        } finally {
            setDetailsLoading(false);
        }
    }, [dateRange]);

    // ── Modal openers ─────────────────────────────────────────────────────────

    /**
     * Opens from KPI card — inherits dashboard destination filter,
     * resets all other modal-specific filters.
     */
    const handleKPICompletionClick = (page = 0, status: string | null = 'completed') => {
        const dest = normaliseFilter(selectedDestination);
        setIsModalOpen(true);
        setModalTab((status || 'completed_or_returning') as any);
        setModalDestination(dest);
        setModalOrigin(null);
        setModalTrackerId(null);
        setModalTripType(null);
        fetchTripDetails(page, status, dest);
    };

    /**
     * Opens from destination summary row — forces specific destination,
     * resets all other modal-specific filters.
     */
    const handleRowDrillDown = (destination: string) => {
        setIsModalOpen(true);
        setModalTab('completed_or_returning');
        setModalDestination(destination);
        setModalOrigin(null);
        setModalTrackerId(null);
        setModalTripType(null);
        fetchTripDetails(0, 'completed_or_returning', destination);
    };

    /**
     * Called by TripCompletionModal on every filter/page/tab change.
     *
     * FIX: now accepts trackerId and tripType params from the modal and
     *      stores them so subsequent paginations preserve all active filters.
     */
    const handleModalPageChange = (
        page: number,
        status: string,
        sort?: string,
        origin?: string | null,
        destination?: string | null,
        trackerId?: number | null,   // NEW
        tripType?: string | null,   // NEW
    ) => {
        setModalTab(status as any);

        // For each filter: use the incoming value if explicitly provided,
        // otherwise keep the last known value (prevents resets on tab switches).
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
            status,
            activeDest,
            sort || 'tat_desc',
            activeOrigin,
            activeTrackerId,
            activeTripType,
        );
    };

    // ── Destination options for dashboard filter ──────────────────────────────
    const uniqueDestinations = [
        'All Destinations',
        ...new Set(destinationSummary.map((d) => d.location)),
    ].sort();

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-10">

            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Turnaround Time (TAT) Insights</h1>
                    <p className="text-gray-400">Operational efficiency metrics and bottleneck analysis.</p>
                </div>

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                    {/* Destination Filter */}
                    <select
                        value={selectedDestination}
                        onChange={(e) => setSelectedDestination(e.target.value)}
                        className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg border
                                   border-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {uniqueDestinations.map((dest) => (
                            <option key={dest} value={dest}>{dest}</option>
                        ))}
                    </select>

                    {/* Date Range */}
                    <div className="flex items-center space-x-2 bg-gray-900 p-2 rounded-lg border border-gray-800">
                        <Calendar className="w-5 h-5 text-gray-500" />
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                            className="bg-transparent text-white text-sm focus:outline-none"
                        />
                        <span className="text-gray-600">to</span>
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                            className="bg-transparent text-white text-sm focus:outline-none"
                        />
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <KPIStats
                stats={stats}
                loading={loading}
                onTripCompletionClick={() => handleKPICompletionClick(0, 'completed')}
            />

            {/* Destination Summary Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-white">Performance Summary by Destination</h2>
                    <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
                        Completed Trips Only
                    </span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-900/30 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-3">Location</th>
                                <th className="px-6 py-3 text-center">Trackers</th>
                                <th className="px-6 py-3 text-center">Trips</th>
                                <th className="px-6 py-3 text-right">Avg TAT (Days)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {loading ? (
                                Array(3).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={4} className="px-6 py-4 h-12 bg-gray-900/10" />
                                    </tr>
                                ))
                            ) : destinationSummary.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500 text-sm">
                                        No completed trips found in this period.
                                    </td>
                                </tr>
                            ) : (
                                destinationSummary
                                    .filter((row) =>
                                        selectedDestination === 'All Destinations' ||
                                        row.location === selectedDestination
                                    )
                                    .map((row, i) => (
                                        <tr
                                            key={i}
                                            className="hover:bg-gray-900/20 transition-colors cursor-pointer group"
                                            onClick={() => handleRowDrillDown(row.location)}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:scale-125 transition-transform" />
                                                    <span className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                                                        {row.location}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="text-sm text-gray-300 font-mono">{row.unique_trackers}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center text-sm font-medium text-emerald-400">
                                                {row.trip_count}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="inline-flex items-center gap-2">
                                                    <span className="text-lg font-bold text-white">{row.avg_tat_days}</span>
                                                    <span className="text-xs text-gray-500 uppercase font-medium mt-1">days</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BorderChart
                    data={tundumaData}
                    title="Tunduma (TZ) → Nakonde (ZMB) Wait Trends"
                />
                <BorderChart
                    data={kasumbalData}
                    title="Kasumbalesa (ZMB) → DRC Wait Trends"
                />
            </div>

            {/* Trip Drill-Down Modal */}
            <TripCompletionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                data={tripDetails}
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