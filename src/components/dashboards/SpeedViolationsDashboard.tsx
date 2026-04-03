// src/components/dashboards/SpeedViolationsDashboard.tsx
import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DateFilter } from './common/DateFilter';
import { CustomTooltip } from './common/CustomTooltip';
import { SmartDateXAxis } from '@/components/SmartDateXAxis';
import { useOps } from '@/context/OpsContext';
import { api } from '@/context/config';

interface SpeedViolationsDashboardProps {
    dateFilter: string;
    setDateFilter: (filter: string) => void;
    onLoadingChange?: (loading: boolean) => void;
}

interface ByDay {
    date: string;
    major: number;
    severe: number;
}

interface Violator {
    vehicle: string;
    totalViolations: number;
    totalDurationHours: number;
    major: number;
    severe: number;
    maxSpeedKmph: number;
}

const WINDOW_MAP: Record<string, '1d' | '7d' | '30d' | 'mtd'> = {
    '1 day': '1d',
    '7 days': '7d',
    '30 days': '30d',
    'MTD': 'mtd',
};

function fmtDayLabel(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function coerceByDay(arr: unknown[]): ByDay[] {
    return arr.map((row: unknown) => {
        const r = row as Record<string, unknown>;
        return {
            date: fmtDayLabel(String(r.date ?? '')),
            major: Number(r.major ?? r.major_count ?? 0),
            severe: Number(r.severe ?? r.severe_count ?? 0),
        };
    });
}

function coerceViolators(arr: unknown[]): Violator[] {
    return arr.map((row: unknown) => {
        const r = row as Record<string, unknown>;
        return {
            vehicle: String(r.vehicle_number ?? r.vehicle ?? ''),
            totalViolations: Number(r.total_violations ?? r.totalViolations ?? 0),
            totalDurationHours: Number(r.total_duration_hours ?? r.totalDurationHours ?? 0),
            major: Number(r.major ?? r.major_count ?? 0),
            severe: Number(r.severe ?? r.severe_count ?? 0),
            maxSpeedKmph: Number(r.max_speed_kmph ?? r.maxSpeedKmph ?? 0),
        };
    });
}

export const SpeedViolationsDashboard: React.FC<SpeedViolationsDashboardProps> = ({
    dateFilter,
    setDateFilter,
    onLoadingChange,
}) => {
    const { ops } = useOps();
    const [byDay, setByDay] = useState<ByDay[]>([]);
    const [violators, setViolators] = useState<Violator[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    useEffect(() => {
        const load = async (retryCount = 0) => {
            setLoading(true);
            try {
                const base = api(ops, 'speedViolations');
                const windowVal = WINDOW_MAP[dateFilter] ?? '30d';
                let url = `${base}?window=${windowVal}&limit=15&_t=${Date.now()}`;

                let res = await fetch(url, { cache: 'no-store' });
                
                // Handle 503 with a single retry
                if (res.status === 503 && retryCount < 1) {
                    console.warn('[SpeedViolations] 503 Service Unavailable, retrying...');
                    await new Promise(r => setTimeout(r, 1000));
                    return load(retryCount + 1);
                }

                let raw: any;
                if (res.ok) {
                    raw = await res.json();
                } else {
                    raw = null;
                }

                // If MTD not supported by this backend, fallback to 30d
                if (windowVal === 'mtd' && (!res.ok || raw?.message || raw?.error)) {
                    console.warn('[SpeedViolations] MTD not available, falling back to 30d');
                    url = `${base}?window=30d&limit=15&_t=${Date.now()}`;
                    res = await fetch(url, { cache: 'no-store' });
                    raw = await res.json();
                }

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                // Handle nested body JSON (like UNIFLEET 3)
                const payload = raw?.status ? raw : (raw?.body ? JSON.parse(raw.body) : raw);
                
                const byDayRaw = payload?.by_day ?? payload?.byDay ?? payload?.violations_by_day ?? [];
                const violatorsRaw = payload?.violators ?? payload?.top_violators ?? payload?.topViolators ?? [];

                let byDayArr = Array.isArray(byDayRaw) ? byDayRaw : [];
                
                // --- FIXED MTD FILTERING ---
                // Previously, we strictly filtered for the 1st of the month.
                // If today is the 1st and no data is back from API for today yet, the chart was empty.
                // We now only filter if the backend didn't already filter (i.e. if it returns more than 31 days)
                // or we just trust the backend for MTD window.
                if (windowVal === 'mtd' && byDayArr.length > 31) {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = String(now.getMonth() + 1).padStart(2, '0');
                    const startOfMonth = `${y}-${m}-01`;
                    byDayArr = byDayArr.filter((d: any) => String(d.date) >= startOfMonth);
                }

                setByDay(coerceByDay(byDayArr));
                setViolators(coerceViolators(Array.isArray(violatorsRaw) ? violatorsRaw : []));
            } catch (e) {
                console.error('Speed violations fetch failed:', e);
                setByDay([]);
                setViolators([]);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [dateFilter, ops]);

    const chartData = useMemo(() => byDay, [byDay]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/filter hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-block mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-wide">SPEED VIOLATIONS</h3>
                </div>
                <DateFilter
                    title="Speed Violations"
                    dateFilter={dateFilter}
                    setDateFilter={setDateFilter}
                />
            </div>

            {/* Chart Section */}
            <div className="bg-muted/30 rounded-xl p-5 border border-border mb-6">
                <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Violations by Day</h4>
                {loading ? (
                    <p className="text-muted-foreground italic text-sm">Loading chart...</p>
                ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                        <BarChart data={chartData} margin={{ top: 8, right: 24, left: 24, bottom: 44 }}>
                            <CartesianGrid strokeWidth={1} stroke="hsl(var(--border))" />
                            <SmartDateXAxis data={chartData} dataKey="date" maxTicks={8} height={60} />
                            <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: '12px' }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend />
                            <Bar dataKey="major" stackId="a" fill="#F97316" name="Major" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="severe" stackId="a" fill="#DC2626" name="Severe" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-sm italic text-muted-foreground">No data for this window.</p>
                )}
            </div>

            {/* Top Violators Table */}
            <div className="bg-muted/30 rounded-xl p-5 border border-border">
                <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Top Violators</h4>
                {loading ? (
                    <p className="text-muted-foreground italic text-sm">Loading...</p>
                ) : violators.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Vehicle</th>
                                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Total</th>
                                    <th className="text-right py-2 px-3 font-semibold text-orange-600 dark:text-orange-500">Major</th>
                                    <th className="text-right py-2 px-3 font-semibold text-red-600 dark:text-red-500">Severe</th>
                                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Max Speed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {violators.slice(0, 10).map((v, i) => (
                                    <tr key={i} className="border-b border-border hover:bg-muted/30 transition-colors">
                                        <td className="py-2 px-3 font-medium text-foreground">{v.vehicle}</td>
                                        <td className="py-2 px-3 text-right font-bold text-foreground">{v.totalViolations}</td>
                                        <td className="py-2 px-3 text-right text-orange-700 dark:text-orange-400">{v.major}</td>
                                        <td className="py-2 px-3 text-right text-red-700 dark:text-red-400">{v.severe}</td>
                                        <td className="py-2 px-3 text-right text-muted-foreground">{v.maxSpeedKmph} km/h</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-sm italic text-muted-foreground">No violator data for this window.</p>
                )}
            </div>
        </div>
    );
};
