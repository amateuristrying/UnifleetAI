'use client';
import { format } from 'date-fns';
import { Truck, MapPin, Clock, Zap, AlertCircle, CheckCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility for Cleaner Classes ---
function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export interface ActivityRow {
    id: string;
    vehicleName: string;
    vehicleBrand: string;
    startTime: string;
    endTime: string;
    startAddress: string;
    endAddress: string;
    distanceKm: number;
    maxSpeed: number;
    avgSpeed: number;
}

// --- Sub-Components (The "Clean Code" Way) ---
const Badge = ({ children, color }: { children: React.ReactNode; color: 'green' | 'red' | 'amber' | 'gray' }) => {
    const styles = {
        green: 'bg-green-50 text-green-700 border-green-200',
        red: 'bg-red-50 text-red-700 border-red-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
        gray: 'bg-slate-100 text-slate-600 border-slate-200',
    };
    return (
        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide border", styles[color])}>
            {children}
        </span>
    );
};

const VehicleCell = ({ name, brand }: { name: string; brand: string }) => (
    <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Truck size={18} />
        </div>
        <div>
            <div className="font-bold text-slate-900">{name}</div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{brand || 'Vehicle'}</div>
        </div>
    </div>
);

const TimelineCell = ({ start, end }: { start: string; end: string }) => {
    let startFormatted = start;
    let endFormatted = end;
    try {
        startFormatted = format(new Date(start), 'MMM dd, HH:mm');
        endFormatted = format(new Date(end), 'MMM dd, HH:mm');
    } catch {
        // Fallback if parsing fails
    }

    return (
        <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200"></div>
                <span className="font-medium text-slate-700">{startFormatted}</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-red-400"></div>
                <span className="text-slate-500">{endFormatted}</span>
            </div>
        </div>
    );
};

// --- Main Table Component ---
export default function ActivityTable({ data }: { data: ActivityRow[] }) {
    if (!data || data.length === 0) {
        return <div className="p-8 text-center text-gray-500 border rounded-xl border-dashed bg-gray-50">No recent activity found.</div>;
    }

    return (
        <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[600px] overflow-auto scrollbar-thin"> {/* Sticky Header Container */}
                <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Vehicle</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Timeline</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Route</th>
                            <th className="px-6 py-4 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">Stats</th>
                            <th className="px-6 py-4 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.map((row) => (
                            <tr
                                key={row.id}
                                className="group transition-all hover:bg-slate-50/80 cursor-default"
                            >
                                <td className="px-6 py-4"><VehicleCell name={row.vehicleName || 'Unknown'} brand={row.vehicleBrand} /></td>

                                <td className="px-6 py-4"><TimelineCell start={row.startTime} end={row.endTime} /></td>

                                <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1 max-w-[200px]">
                                        <div className="truncate text-xs text-slate-600 flex items-center gap-1.5" title={row.startAddress}>
                                            <MapPin size={12} className="text-slate-400" /> {row.startAddress || 'Loading...'}
                                        </div>
                                        <div className="truncate text-xs text-slate-600 flex items-center gap-1.5" title={row.endAddress}>
                                            <MapPin size={12} className="text-slate-400" /> {row.endAddress || 'Loading...'}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-4">
                                        <div className="text-center">
                                            <div className="text-lg font-bold text-slate-900">{Math.round(row.distanceKm || 0)} <span className="text-xs text-slate-400 font-normal">km</span></div>
                                        </div>
                                        <div className="h-8 w-px bg-slate-100"></div>
                                        <div className="flex flex-col items-center">
                                            {/* Duration calculation would happen in data processing */}
                                            <div className="text-xs font-bold text-slate-700 flex items-center gap-1"><Clock size={12} /> -- h</div>
                                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><Zap size={12} /> {Math.round(row.avgSpeed || 0)} km/h</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {/* Logic for simple speed check since we don't have complex score */}
                                    {(row.maxSpeed > 85) ? (
                                        <Badge color="red">
                                            <AlertCircle size={12} /> Speeding
                                        </Badge>
                                    ) : (
                                        <Badge color="green">
                                            <CheckCircle size={12} /> Normal
                                        </Badge>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
