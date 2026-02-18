// src/components/dashboards/GeofenceDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useOps } from "@/context/OpsContext";
import { api } from "@/context/config";
import { RefreshCw } from "lucide-react";

type GeofenceRow = {
    vehicleNumber: string;
    currentGeofence: string;
    entryDatetime: string;
    exitDatetime: string;
    dwellHours: number | null;
    dwellDays: number | null;
};

interface GeofenceDashboardProps {
    onLoadingChange?: (loading: boolean) => void;
}

export const GeofenceDashboard: React.FC<GeofenceDashboardProps> = ({ onLoadingChange }) => {
    const { ops } = useOps();
    const [rows, setRows] = useState<GeofenceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    const load = async () => {
        setLoading(true);
        setErr(null);
        try {
            const base = api(ops, "geofjson")?.replace(/\/+$/, "");
            if (!base) {
                setRows([]);
                return;
            }
            const url = `${base}?limit=50&_t=${Date.now()}`;

            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const rawData = Array.isArray(data?.data) ? data.data : [];
            setRows(rawData.map((r: Record<string, unknown>) => ({
                vehicleNumber: String(r.vehicleNumber ?? r.vehicle_number ?? ''),
                currentGeofence: String(r.currentGeofence ?? r.current_geofence ?? ''),
                entryDatetime: String(r.entryDatetime ?? r.entry_datetime ?? ''),
                exitDatetime: String(r.exitDatetime ?? r.exit_datetime ?? ''),
                dwellHours: r.dwellHours != null ? Number(r.dwellHours) : (r.dwell_hours != null ? Number(r.dwell_hours) : null),
                dwellDays: r.dwellDays != null ? Number(r.dwellDays) : (r.dwell_days != null ? Number(r.dwell_days) : null),
            })));
        } catch (e: unknown) {
            console.error("[geofence] fetch failed", e);
            setErr((e as Error)?.message || "Failed to fetch");
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [ops]);

    const top10 = useMemo(() => {
        const copy = [...rows];
        copy.sort((a, b) => (b.dwellHours ?? -Infinity) - (a.dwellHours ?? -Infinity));
        return copy.slice(0, 10);
    }, [rows]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/refresh hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide flex items-center justify-between mb-6">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-block">
                    <h3 className="text-lg font-bold uppercase tracking-wide">GEOFENCE TABLE</h3>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {loading && <div className="text-sm text-muted-foreground italic">Loading geofence snapshot…</div>}
            {err && !loading && <div className="text-sm text-red-500">Error: {err}</div>}

            {!loading && !err && (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Vehicle</th>
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Geofence</th>
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Entry</th>
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Exit</th>
                                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Dwell (hrs)</th>
                                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Dwell (days)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {top10.map((r, i) => (
                                    <tr key={`${r.vehicleNumber}-${r.entryDatetime}-${i}`} className="border-b border-border hover:bg-muted/30 transition-colors">
                                        <td className="py-2 px-3 font-medium text-foreground">{r.vehicleNumber}</td>
                                        <td className="py-2 px-3 text-muted-foreground">{r.currentGeofence}</td>
                                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{r.entryDatetime}</td>
                                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{r.exitDatetime || "—"}</td>
                                        <td className="py-2 px-3 text-right font-semibold text-foreground">
                                            {r.dwellHours == null ? "—" : r.dwellHours.toFixed(2)}
                                        </td>
                                        <td className="py-2 px-3 text-right text-muted-foreground">
                                            {r.dwellDays == null ? "—" : r.dwellDays.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                                {top10.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="text-center py-6 text-sm text-muted-foreground italic">
                                            No data in snapshot.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};
