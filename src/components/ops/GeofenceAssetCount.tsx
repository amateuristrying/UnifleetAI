import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useOps } from '@/context/OpsContext';
import {
    Lock,
    Loader2,
    BarChart3,
    Truck,
    MapPin,
    Navigation,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

/* ────────────── Type Definitions ────────────── */

interface ChildGeofence {
    internal_geofence: string;
    internal_geofence_type: string;
    vehicle_count: number;
    moving_count: number;
    parked_count: number;
    vehicles: string;
}

interface GeofenceDashboardRow {
    total_fleet: number;
    total_in_geofences: number;
    pct_in_geofence: number;
    main_geofence: string;
    main_geofence_type: string;
    has_children: boolean;
    total_vehicles: number;
    total_moving: number;
    total_parked: number;
    child_geofence_count: number;
    children: ChildGeofence[] | null;
}

/* ────────────── Helpers ────────────── */

function formatEAT(date: Date): string {
    // EAT = UTC+3
    const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    const h = String(eat.getUTCHours()).padStart(2, '0');
    const m = String(eat.getUTCMinutes()).padStart(2, '0');
    const s = String(eat.getUTCSeconds()).padStart(2, '0');
    return `${h}:${m}:${s} EAT`;
}

/* ────────────── Component ────────────── */

export default function GeofenceAssetCount() {
    const { ops } = useOps();
    const isTZ = ops === 'tanzania';

    const [rows, setRows] = useState<GeofenceDashboardRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('v_geofence_dashboard')
                .select('*');

            if (error) {
                console.error('Failed to fetch geofence dashboard:', error);
                return;
            }

            if (data) {
                setRows(data as GeofenceDashboardRow[]);
                setLastUpdated(new Date());
            }
        } catch (err) {
            console.error('Geofence dashboard fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch + auto-refresh every 60s
    useEffect(() => {
        if (!isTZ) return;

        fetchData();
        intervalRef.current = setInterval(fetchData, 60000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isTZ, fetchData]);

    const toggleParent = (name: string) => {
        setExpandedParents(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    /* ── Locked State for Zambia ── */
    if (!isTZ) {
        return (
            <div className="bg-surface-card rounded-[32px] border border-border shadow-sm p-6 w-full mt-6">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 size={14} className="text-muted-foreground" />
                    <h3 className="text-muted-foreground text-[10px] font-black uppercase tracking-widest">
                        Geofence Asset Count
                    </h3>
                </div>
                <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-xl bg-muted/10">
                    <Lock size={32} className="text-muted-foreground/30 mb-3" />
                    <p className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide text-center">
                        Geofence Asset Count is available for TZ Ops only
                    </p>
                </div>
            </div>
        );
    }

    /* ── Derive Metrics ── */
    const totalFleet = rows.length > 0 ? rows[0].total_fleet : 0;
    const totalInGeofences = rows.length > 0 ? rows[0].total_in_geofences : 0;
    const pctInGeofence = rows.length > 0 ? rows[0].pct_in_geofence : 0;
    const onRoad = totalFleet - totalInGeofences;
    const pctOnRoad = totalFleet > 0 ? Math.round((onRoad / totalFleet) * 100) : 0;

    /* ── Group Geofences ── */
    const activeRows = rows.filter(r => r.total_vehicles > 0);
    const parentGeofences = activeRows
        .filter(r => r.has_children)
        .sort((a, b) => b.total_vehicles - a.total_vehicles);
    const standaloneGeofences = activeRows
        .filter(r => !r.has_children)
        .sort((a, b) => b.total_vehicles - a.total_vehicles);

    return (
        <div className="bg-surface-card rounded-[32px] border border-border shadow-md p-6 w-full mt-6 animate-in fade-in duration-500">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                    <BarChart3 size={14} className="text-primary" />
                    <h3 className="text-muted-foreground text-[10px] font-black uppercase tracking-widest">
                        Geofence Asset Count
                    </h3>
                    {loading && (
                        <Loader2 size={12} className="animate-spin text-primary ml-2" />
                    )}
                </div>
                {lastUpdated && (
                    <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider">
                        Last updated: {formatEAT(lastUpdated)}
                    </span>
                )}
            </div>

            {/* Sub-section A — Metric Tiles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                {/* Total Fleet */}
                <div className="relative overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/50 dark:to-slate-900/50 rounded-2xl border border-border p-5 group hover:shadow-lg transition-all duration-300">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-slate-200/30 dark:bg-slate-700/20 rounded-full -translate-y-6 translate-x-6" />
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 bg-slate-200/50 dark:bg-slate-700/50 rounded-lg">
                            <Truck size={14} className="text-slate-600 dark:text-slate-400" />
                        </div>
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            Total Fleet
                        </span>
                    </div>
                    <p className="text-3xl font-black text-foreground tracking-tight leading-none">
                        {totalFleet.toLocaleString()}
                    </p>
                </div>

                {/* In Geofences */}
                <div className="relative overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 rounded-2xl border border-blue-200/50 dark:border-blue-800/30 p-5 group hover:shadow-lg transition-all duration-300">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200/20 dark:bg-blue-700/10 rounded-full -translate-y-6 translate-x-6" />
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 bg-blue-200/50 dark:bg-blue-700/30 rounded-lg">
                            <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            In Geofences
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <p className="text-3xl font-black text-blue-700 dark:text-blue-400 tracking-tight leading-none">
                            {totalInGeofences.toLocaleString()}
                        </p>
                        <span className="text-sm font-bold text-blue-500/70 dark:text-blue-500/60">
                            ({Math.round(pctInGeofence)}%)
                        </span>
                    </div>
                </div>

                {/* On Road */}
                <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-800/10 rounded-2xl border border-emerald-200/50 dark:border-emerald-800/30 p-5 group hover:shadow-lg transition-all duration-300">
                    <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200/20 dark:bg-emerald-700/10 rounded-full -translate-y-6 translate-x-6" />
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 bg-emerald-200/50 dark:bg-emerald-700/30 rounded-lg">
                            <Navigation size={14} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            On Road
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <p className="text-3xl font-black text-emerald-700 dark:text-emerald-400 tracking-tight leading-none">
                            {onRoad.toLocaleString()}
                        </p>
                        <span className="text-sm font-bold text-emerald-500/70 dark:text-emerald-500/60">
                            ({pctOnRoad}%)
                        </span>
                    </div>
                </div>
            </div>

            {/* Sub-section B — Geofence Tile Grid */}

            {/* Group 1 — Parent Geofences */}
            {parentGeofences.length > 0 && (
                <div className="mb-6">
                    <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Parent Geofences
                        <span className="text-[9px] font-black text-primary">({parentGeofences.length})</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {parentGeofences.map((gf) => {
                            const isExpanded = expandedParents.has(gf.main_geofence);
                            const children = (gf.children || [])
                                .filter(c => c.internal_geofence !== gf.main_geofence)
                                .sort((a, b) => b.vehicle_count - a.vehicle_count);
                            const selfRef = (gf.children || []).find(
                                c => c.internal_geofence === gf.main_geofence
                            );

                            return (
                                <div
                                    key={gf.main_geofence}
                                    className="bg-muted/20 dark:bg-muted/10 rounded-2xl border border-border overflow-hidden hover:shadow-lg transition-all duration-300 group/tile"
                                >
                                    {/* Tile Header */}
                                    <div
                                        className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                                        onClick={() => toggleParent(gf.main_geofence)}
                                    >
                                        <div className="flex items-start justify-between mb-1">
                                            <div className="flex-1 min-w-0 pr-3">
                                                <h5 className="text-sm font-black text-foreground uppercase tracking-tight truncate leading-tight">
                                                    {gf.main_geofence}
                                                </h5>
                                                <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">
                                                    {gf.main_geofence_type}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className="px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-black border border-primary/20">
                                                    {gf.total_vehicles} {gf.total_vehicles === 1 ? 'vehicle' : 'vehicles'}
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronUp size={14} className="text-muted-foreground" />
                                                ) : (
                                                    <ChevronDown size={14} className="text-muted-foreground" />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Children */}
                                    {isExpanded && (
                                        <div className="border-t border-border/50 animate-in slide-in-from-top-2 duration-300 max-h-[280px] overflow-y-auto custom-scrollbar">
                                            <div className="p-3 space-y-1.5">
                                                {children.map((child) => (
                                                    <div
                                                        key={child.internal_geofence}
                                                        className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-card/80 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            <div className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                                                            <span className="text-[11px] font-bold text-foreground truncate">
                                                                {child.internal_geofence}
                                                            </span>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-muted-foreground shrink-0 ml-2">
                                                            {child.vehicle_count} {child.vehicle_count === 1 ? 'vehicle' : 'vehicles'}
                                                        </span>
                                                    </div>
                                                ))}

                                                {/* Self-referencing row */}
                                                {selfRef && selfRef.vehicle_count > 0 && (
                                                    <>
                                                        <div className="border-t border-border/30 my-1" />
                                                        <div className="px-3 py-2">
                                                            <span className="text-[10px] font-medium text-red-500 italic">
                                                                {selfRef.vehicle_count} {selfRef.vehicle_count === 1 ? 'vehicle' : 'vehicles'} in zone · no specific depot
                                                            </span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Group 2 — Standalone Geofences */}
            {standaloneGeofences.length > 0 && (
                <div>
                    <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Standalone Geofences
                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400">({standaloneGeofences.length})</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {standaloneGeofences.map((gf) => (
                            <div
                                key={gf.main_geofence}
                                className="bg-muted/20 dark:bg-muted/10 rounded-2xl border border-border overflow-hidden hover:shadow-lg transition-all duration-300"
                            >
                                <div className="p-4">
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="flex-1 min-w-0 pr-3">
                                            <h5 className="text-sm font-black text-foreground uppercase tracking-tight truncate leading-tight">
                                                {gf.main_geofence}
                                            </h5>
                                            <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-wider">
                                                {gf.main_geofence_type}
                                            </span>
                                        </div>
                                        <div className="px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-black border border-primary/20 shrink-0">
                                            {gf.total_vehicles} {gf.total_vehicles === 1 ? 'vehicle' : 'vehicles'}
                                        </div>
                                    </div>
                                    <div className="border-t border-border/30 mt-3 pt-3">
                                        <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground">
                                            <span className="inline-flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                                {gf.total_moving} moving
                                            </span>
                                            <span className="text-muted-foreground/30">·</span>
                                            <span className="inline-flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                {gf.total_parked} parked
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {rows.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-xl bg-muted/10">
                    <BarChart3 size={32} className="text-muted-foreground/20 mb-3" />
                    <p className="text-xs font-bold text-muted-foreground/50 uppercase tracking-wide">
                        No geofence data available
                    </p>
                </div>
            )}

            {/* Loading skeleton */}
            {rows.length === 0 && loading && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="h-24 bg-muted/30 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[0, 1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="h-28 bg-muted/20 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
