
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { format } from 'date-fns';

interface HexReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    hexId: string;
    filters: {
        dateRange: { start: string; end: string };
        dayFilter?: number[];
        hourFilter?: number[] | null;
        trackerId?: number | null;
        durationFilter?: { min: string; max: string };
    };
    locationName?: string;
}

const ROWS_PER_PAGE = 50;

export default function HexReportModal({ isOpen, onClose, hexId, filters, locationName }: HexReportModalProps) {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(0);

    useEffect(() => {
        if (isOpen && hexId) {
            setCurrentPage(0);
            fetchData();
        }
    }, [isOpen, hexId, filters]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const minDate = filters.dateRange.start || '2024-01-01T00:00:00Z';
            const maxDate = filters.dateRange.end || new Date().toISOString();

            const rpcParams = {
                p_h3_index: hexId,
                min_date: minDate,
                max_date: maxDate,
                tracker_id_filter: filters.trackerId ?? null,
                day_filter: null,
                hour_filter: filters.hourFilter ?? null,
                p_min_duration: filters.durationFilter?.min ? parseFloat(filters.durationFilter.min) : null,
                p_max_duration: filters.durationFilter?.max ? parseFloat(filters.durationFilter.max) : null,
                p_limit: 1000,
                p_offset: 0
            };

            // Paginate through all results (Supabase caps at 1000 rows)
            let allData: any[] = [];
            let page = 0;
            const pageSize = 1000;
            let keepFetching = true;

            while (keepFetching) {
                const { data: batch, error } = await supabase.rpc('get_hex_details', {
                    ...rpcParams,
                    p_offset: page * pageSize
                });

                if (error) throw error;

                if (batch && batch.length > 0) {
                    allData = [...allData, ...batch];
                    if (batch.length < pageSize) keepFetching = false;
                } else {
                    keepFetching = false;
                }
                page++;
            }

            console.log(`[HexReport] Fetched ${allData.length} total sessions`);
            setData(allData);
        } catch (err: any) {
            console.error('Error fetching hex report:', err.message || err);
        } finally {
            setLoading(false);
        }
    };

    const downloadCSV = () => {
        if (!data || data.length === 0) return;

        const headers = ['Vehicle ID', 'Arrival', 'Departure', 'Duration (h)', 'Engine On (h)', 'Engine Off (h)', 'Ignition %', 'Risk Score'];
        const rows = data.map(row => [
            row.vehicle_id,
            row.visit_start,
            row.visit_end,
            row.duration_hours?.toFixed(2),
            row.engine_on_hours?.toFixed(2),
            row.engine_off_hours?.toFixed(2),
            row.ignition_on_percent?.toFixed(1) + '%',
            row.risk_score?.toFixed(1)
        ]);

        const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `hex_report_${hexId}_${format(new Date(), 'yyyyMMdd')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!isOpen) return null;

    // Pagination calculations
    const totalPages = Math.ceil(data.length / ROWS_PER_PAGE);
    const startIdx = currentPage * ROWS_PER_PAGE;
    const endIdx = Math.min(startIdx + ROWS_PER_PAGE, data.length);
    const pageData = data.slice(startIdx, endIdx);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Operational Report: {locationName || hexId}</h2>
                        <div className="text-xs text-slate-500 font-mono mt-1">HEX: {hexId} • {data.length.toLocaleString()} Sessions Found</div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-0">
                    {loading ? (
                        <div className="p-12 text-center text-slate-400">Loading visit data...</div>
                    ) : data.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">No visits found for this period.</div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-gray-200">Vehicle</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-gray-200">Arrival</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-gray-200">Duration</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-gray-200">Engine Profile</th>
                                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-gray-200">Risk</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {pageData.map((row, idx) => (
                                    <tr key={startIdx + idx} className="hover:bg-slate-50 transition-colors text-xs text-slate-700">
                                        <td className="px-4 py-3 font-medium text-slate-900">{row.vehicle_id}</td>
                                        <td className="px-4 py-3">
                                            <div>{format(new Date(row.visit_start), 'MMM d, HH:mm')}</div>
                                            <div className="text-[10px] text-slate-400">{format(new Date(row.visit_end), 'HH:mm')}</div>
                                        </td>
                                        <td className="px-4 py-3 font-semibold">
                                            {row.duration_hours?.toFixed(1)}h
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden flex">
                                                    <div style={{ width: `${row.ignition_on_percent}%` }} className="bg-orange-500"></div>
                                                </div>
                                                <span className="text-[10px] text-slate-500">{row.ignition_on_percent?.toFixed(0)}% On</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                Off: {row.engine_off_hours?.toFixed(1)}h
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${row.risk_score > 70 ? 'bg-red-100 text-red-700' :
                                                row.risk_score > 40 ? 'bg-amber-100 text-amber-700' :
                                                    'bg-green-100 text-green-700'
                                                }`}>
                                                {row.risk_score?.toFixed(0)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Pagination Controls */}
                {!loading && data.length > ROWS_PER_PAGE && (
                    <div className="px-6 py-3 border-t border-gray-100 bg-slate-50/80 flex items-center justify-between">
                        <div className="text-xs text-slate-500">
                            Showing <span className="font-semibold text-slate-700">{startIdx + 1}–{endIdx}</span> of <span className="font-semibold text-slate-700">{data.length.toLocaleString()}</span> sessions
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(0)}
                                disabled={currentPage === 0}
                                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="First page"
                            >
                                <ChevronsLeft size={16} />
                            </button>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                disabled={currentPage === 0}
                                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="Previous page"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span className="px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md min-w-[80px] text-center">
                                {currentPage + 1} / {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={currentPage >= totalPages - 1}
                                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="Next page"
                            >
                                <ChevronRight size={16} />
                            </button>
                            <button
                                onClick={() => setCurrentPage(totalPages - 1)}
                                disabled={currentPage >= totalPages - 1}
                                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="Last page"
                            >
                                <ChevronsRight size={16} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
                        Close
                    </button>
                    <button
                        onClick={downloadCSV}
                        disabled={loading || data.length === 0}
                        className="px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-md hover:bg-slate-800 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={16} />
                        Download CSV ({data.length.toLocaleString()})
                    </button>
                </div>
            </div>
        </div>
    );
}
