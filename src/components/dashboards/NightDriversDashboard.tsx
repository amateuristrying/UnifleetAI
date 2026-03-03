// src/components/dashboards/NightDriversDashboard.tsx
import { useEffect, useState } from "react";
import {
    BarChart, Bar, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend
} from "recharts";
import { SmartDateXAxis } from "@/components/SmartDateXAxis";
import { useOps } from "@/context/OpsContext";
import { api } from "@/context/config";

type Period = "1d" | "7d" | "30d" | "mtd";
type TF = "1 day" | "7 days" | "30 days" | "MTD";

interface Rank { rank: number; vehicle_number: string; night_driving_hours: number; }
interface DailyTotal { date: string; total_night_hours: number; }

interface NightDriversDashboardProps {
    dateFilter?: TF;
    setDateFilter?: (filter: string) => void;
    onLoadingChange?: (loading: boolean) => void;
}

const tfToPeriod = (tf: TF): Period =>
    tf === "1 day" ? "1d" : tf === "7 days" ? "7d" : tf === "MTD" ? "mtd" : "30d";

const periodToTf = (p: Period): TF =>
    p === "1d" ? "1 day" : p === "7d" ? "7 days" : p === "mtd" ? "MTD" : "30 days";

export const NightDriversDashboard: React.FC<NightDriversDashboardProps> = ({
    dateFilter,
    setDateFilter,
    onLoadingChange,
}) => {
    const { ops } = useOps();
    const [filter, setFilter] = useState<Period>("30d");

    useEffect(() => {
        if (!dateFilter) return;
        const next = tfToPeriod(dateFilter);
        setFilter(next);
    }, [dateFilter]);

    const [ranks, setRanks] = useState<Rank[]>([]);
    const [totals, setTotals] = useState<DailyTotal[]>([]);
    const [loading, setLoading] = useState(false);
    const [dateRangeStr, setDateRangeStr] = useState({ start: "", end: "" });

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    useEffect(() => {
        const run = async () => {
            setLoading(true);
            try {
                const base = api(ops, "nightDriving").replace(/\/+$/, "");
                const endpoint = /\/night-driving$/.test(base) ? base : `${base}/night-driving`;
                // The filter state values are exactly "1d", "7d", "30d", "mtd".
                const winParam = filter;
                const url = `${endpoint}?window=${winParam}&_t=${Date.now()}`;

                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();

                if (json?.window && json.window !== "latest" && json.window !== winParam && json.window !== `${winParam}d`) {
                    console.warn(`[NightDrivers] API returned window ${json.window} but requested ${winParam}`);
                }

                setDateRangeStr({ start: json?.start_date || "", end: json?.end_date || "" });

                const payload = json?.results ?? json;
                const r: Rank[] = Array.isArray(payload?.ranks) ? payload.ranks as Rank[] : [];
                setRanks(r);

                let t: DailyTotal[] = Array.isArray(payload?.daily_totals) ? payload.daily_totals as DailyTotal[] : [];
                if ((!t || t.length === 0) && r.length > 0) {
                    const sum = r.reduce((s, it) => s + (Number(it.night_driving_hours) || 0), 0);
                    const anchor = (payload?.anchor_date as string) || (json?.anchor_date as string) || new Date().toISOString().slice(0, 10);
                    t = [{ date: String(anchor), total_night_hours: Number(sum.toFixed(2)) }];
                }
                // For MTD, ensure chart starts from 1st of current month
                if (filter === "mtd" && t.length > 0) {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = String(now.getMonth() + 1).padStart(2, '0');
                    const startOfMonth = `${y}-${m}-01`;
                    t = t.filter(d => d.date >= startOfMonth);
                }
                setTotals(t || []);
            } catch (e) {
                console.error("Night driving fetch failed:", e);
                setRanks([]); setTotals([]);
            } finally {
                setLoading(false);
            }
        };
        run();
    }, [ops, filter]);

    const onClickFilter = (p: Period) => {
        setFilter(p);
        if (setDateFilter) {
            setDateFilter(periodToTf(p));
        }
    };

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/filter hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl flex items-center gap-4 mb-6 w-fit">
                    <h3 className="text-lg font-bold uppercase tracking-wide">NIGHT DRIVERS ANALYSIS</h3>
                    {dateRangeStr.start && dateRangeStr.end && (
                        <div className="text-sm font-semibold text-muted-foreground bg-surface-main/40 px-3 py-1 rounded-md border border-border">
                            {dateRangeStr.start === dateRangeStr.end
                                ? dateRangeStr.start
                                : `${dateRangeStr.start} – ${dateRangeStr.end}`}
                        </div>
                    )}
                </div>
                <div className="flex gap-2 mb-6">
                    {(["1d", "7d", "mtd", "30d"] as const).map(f => (
                        <button
                            key={f}
                            className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${f === filter
                                ? "bg-blue-500 text-white shadow-sm"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                                }`}
                            onClick={() => onClickFilter(f)}
                        >
                            {f === "1d" ? "1 Day" : f === "7d" ? "7 Days" : f === "mtd" ? "MTD" : "30 Days"}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart Section */}
            <div className="bg-muted/30 rounded-xl p-5 border border-border mb-6">
                <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Night Driving Hours Over Time</h4>
                {totals.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                        <BarChart data={totals} margin={{ top: 8, right: 24, left: 24, bottom: 44 }}>
                            <CartesianGrid strokeWidth={1} stroke="hsl(var(--border))" />
                            <SmartDateXAxis data={totals} dataKey="date" maxTicks={8} height={60} />
                            <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                style={{ fontSize: "12px", fontWeight: 500 }}
                                label={{ value: "Night Driving Hours", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
                            />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="total_night_hours" fill="#3B82F6" name="Night Driving Hours" barSize={28} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-sm italic text-muted-foreground">No time-series data for this window.</p>
                )}
            </div>

            {/* Table Section */}
            <div className="bg-muted/30 rounded-xl p-5 border border-border">
                <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Top Night Drivers</h4>
                {loading ? (
                    <p className="text-muted-foreground italic text-sm">Loading...</p>
                ) : ranks.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Rank</th>
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Vehicle</th>
                                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Night Hours</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranks.slice(0, 10).map(r => (
                                    <tr key={r.rank} className="border-b border-border hover:bg-muted/30 transition-colors">
                                        <td className="py-2 px-3 font-bold text-foreground">{r.rank}</td>
                                        <td className="py-2 px-3 text-muted-foreground">{r.vehicle_number}</td>
                                        <td className="py-2 px-3 text-right font-semibold text-foreground">{r.night_driving_hours}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-sm italic text-muted-foreground">No ranking data for this window.</p>
                )}
            </div>
        </div>
    );
};
