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
    minor: number;
    major: number;
    severe: number;
}

interface Violator {
    vehicle: string;
    totalViolations: number;
    totalDurationHours: number;
    minor: number;
    major: number;
    severe: number;
    maxSpeedKmph: number;
}

const WINDOW_MAP: Record<string, '1d' | '7d' | '30d'> = {
    '1 day': '1d',
    '7 days': '7d',
    '30 days': '30d',
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
            minor: Number(r.minor ?? r.minor_count ?? 0),
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
            minor: Number(r.minor ?? r.minor_count ?? 0),
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
        const load = async () => {
            setLoading(true);
            try {
                const base = api(ops, 'speedViolations')?.replace(/\/+$/, '');
                if (!base) {
                    setByDay([]);
                    setViolators([]);
                    return;
                }

                const window = WINDOW_MAP[dateFilter] ?? '30d';
                const url = `${base}?window=${window}&limit=15`;

                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const raw = await res.json();
                console.log('[SpeedViolations] Raw response:', raw);

                // Handle nested body JSON (like UNIFLEET 3)
                const payload = raw?.status ? raw : (raw?.body ? JSON.parse(raw.body) : raw);
                console.log('[SpeedViolations] Parsed payload:', payload);

                const byDayRaw = payload?.by_day ?? payload?.byDay ?? payload?.violations_by_day ?? [];
                const violatorsRaw = payload?.violators ?? payload?.top_violators ?? payload?.topViolators ?? [];

                console.log('[SpeedViolations] byDay:', byDayRaw);
                console.log('[SpeedViolations] violators:', violatorsRaw);

                setByDay(coerceByDay(Array.isArray(byDayRaw) ? byDayRaw : []));
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
                            <Bar dataKey="minor" stackId="a" fill="#FCD34D" name="Minor" radius={[0, 0, 0, 0]} />
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
                                    <th className="text-right py-2 px-3 font-semibold text-yellow-600 dark:text-yellow-500">Minor</th>
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
                                        <td className="py-2 px-3 text-right text-yellow-700 dark:text-yellow-400">{v.minor}</td>
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
