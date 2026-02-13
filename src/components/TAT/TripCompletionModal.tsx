import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface TATTrip {
    trip_id: string;
    truck_reg: string;
    driver_name: string;
    destination: string;
    status: string;
    start_time: string; // ISO string
    end_time: string | null;
    loading_duration_hrs: number;
    border_duration_hrs: number | null;
    offloading_duration_hrs: number | null;
    total_duration_days: number | null;
}

interface TripCompletionModalProps {
    isOpen: boolean;
    onClose: () => void;
    trips: TATTrip[];
    loading: boolean;
    page: number;
    hasMore: boolean;
    onPageChange: (newPage: number) => void;
}

export function TripCompletionModal({ isOpen, onClose, trips, loading, page, hasMore, onPageChange }: TripCompletionModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-6xl max-h-[90vh] bg-surface-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-xl font-bold text-foreground">Completed Trips Details</h2>
                    <button onClick={onClose} className="p-2 hover:bg-surface-raised rounded-full transition-colors text-muted-foreground hover:text-foreground">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4">
                    {loading && trips.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground">Loading trip details...</div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-surface-raised text-muted-foreground font-medium sticky top-0">
                                <tr>
                                    <th className="p-3">Trip ID</th>
                                    <th className="p-3">Truck / Driver</th>
                                    <th className="p-3">Destination</th>
                                    <th className="p-3">Status</th>
                                    <th className="p-3 text-right">Loading (Hrs)</th>
                                    <th className="p-3 text-right">Border (Hrs)</th>
                                    <th className="p-3 text-right">Total (Days)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {trips.map((trip) => (
                                    <tr key={trip.trip_id} className="hover:bg-surface-raised/50 transition-colors">
                                        <td className="p-3 font-medium text-foreground">{trip.trip_id}</td>
                                        <td className="p-3">
                                            <div className="text-foreground">{trip.truck_reg}</div>
                                            <div className="text-xs text-muted-foreground">{trip.driver_name}</div>
                                        </td>
                                        <td className="p-3 text-muted-foreground">{trip.destination}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${trip.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                                                    trip.status === 'in_transit' ? 'bg-blue-500/10 text-blue-500' :
                                                        'bg-gray-500/10 text-gray-500'
                                                }`}>
                                                {trip.status.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td className="p-3 text-right text-muted-foreground">{trip.loading_duration_hrs?.toFixed(1) ?? '-'}</td>
                                        <td className="p-3 text-right text-muted-foreground">{trip.border_duration_hrs?.toFixed(1) ?? '-'}</td>
                                        <td className="p-3 text-right font-medium text-foreground">{trip.total_duration_days?.toFixed(2) ?? '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Pagination Footer */}
                <div className="p-4 border-t border-border flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                        Page {page + 1}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onPageChange(page - 1)}
                            disabled={page === 0 || loading}
                            className="p-2 border border-border rounded hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed text-foreground"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onPageChange(page + 1)}
                            disabled={!hasMore || loading}
                            className="p-2 border border-border rounded hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed text-foreground"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
