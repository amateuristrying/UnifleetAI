// src/components/dashboards/FuelExpenseDashboard.tsx
import { useEffect, useState } from 'react';
import { LineChart, Line, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { LimitedDateFilter } from './common/LimitedDateFilter';
import { CustomTooltip } from './common/CustomTooltip';
import { SmartDateXAxis } from '@/components/SmartDateXAxis';
import { useOps } from '@/context/OpsContext';
import { api } from '@/context/config';

interface FuelExpenseDashboardProps {
    dateFilter: string;
    setDateFilter: (filter: string) => void;
    onLoadingChange?: (loading: boolean) => void;
}

interface FuelExpensePoint {
    date: string;
    motionExpense: number;
    idlingExpense: number;
}

export const FuelExpenseDashboard: React.FC<FuelExpenseDashboardProps> = ({
    dateFilter,
    setDateFilter,
    onLoadingChange,
}) => {
    const { ops } = useOps();
    const [data, setData] = useState<FuelExpensePoint[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    useEffect(() => {
        const fetchFuelExpense = async (retryCount = 0) => {
            setLoading(true);
            try {
                const base = api(ops, 'fuelExpense').replace(/\/+$/, '');
                const endpoint = /\/fuel-expense$/.test(base) ? base : `${base}/fuel-expense`;
                const windowType = dateFilter === "7 days" ? "7d" : dateFilter === "MTD" ? "mtd" : "30d";
                const url = `${endpoint}?window=${windowType}`;

                const res = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
                
                // Handle 503 with retry
                if (res.status === 503 && retryCount < 1) {
                    console.warn('[FuelExpense] 503 Service Unavailable, retrying...');
                    await new Promise(r => setTimeout(r, 1000));
                    return fetchFuelExpense(retryCount + 1);
                }

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();

                console.log(`[FuelExpense] URL: ${url}`, json);

                // New flat format: json.fuel_expense  |  Legacy: json.results.lastXdays.fuel_expense
                const legacyKey = windowType === '7d' ? 'last7days' : 'last30days';
                let windowData = json?.fuel_expense
                    ?? json?.results?.[legacyKey]?.fuel_expense
                    ?? [];

                // For MTD, ensure data starts from 1st of current month
                if (dateFilter === "MTD" && Array.isArray(windowData)) {
                    // Only filter if we have more than 31 days (trimming excess)
                    if (windowData.length > 31) {
                        const now = new Date();
                        const y = now.getFullYear();
                        const m = String(now.getMonth() + 1).padStart(2, '0');
                        const startOfMonth = `${y}-${m}-01`;
                        windowData = windowData.filter((d: any) => String(d.date) >= startOfMonth);
                    }
                } else if (dateFilter === "30 days" && Array.isArray(windowData)) {
                    // Strip leading zero-value entries (e.g. ZM backend returning Jan 31 with zeros)
                    while (windowData.length > 0 && Number(windowData[0]?.motion_usd ?? 0) === 0 && Number(windowData[0]?.idle_usd ?? 0) === 0) {
                        windowData = windowData.slice(1);
                    }
                }

                const processed: FuelExpensePoint[] = Array.isArray(windowData)
                    ? windowData.map((d: { date: string; motion_usd?: number; idle_usd?: number }) => ({
                        date: d.date,
                        motionExpense: Number(d.motion_usd ?? 0),
                        idlingExpense: Number(d.idle_usd ?? 0),
                    }))
                    : [];

                setData(processed);
            } catch (err) {
                console.error('Failed to fetch fuel expense', err);
                setData([]);
            } finally {
                setLoading(false);
            }
        };

        fetchFuelExpense();
    }, [dateFilter, ops]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/filter hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-block mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-wide">FUEL EXPENSE OVER TIME</h3>
                </div>
                <LimitedDateFilter title="Fuel Expense" dateFilter={dateFilter} setDateFilter={setDateFilter} />
            </div>

            {loading ? (
                <p className="text-muted-foreground italic text-sm">Loading chart...</p>
            ) : (
                <ResponsiveContainer width="100%" height={420}>
                    <LineChart data={data} margin={{ top: 8, right: 60, left: 60, bottom: 44 }}>
                        <CartesianGrid strokeWidth={1} stroke="hsl(var(--border))" strokeDasharray="none" />
                        <SmartDateXAxis data={data} dataKey="date" maxTicks={8} height={70} />

                        <YAxis
                            yAxisId="left"
                            width={72}
                            tickMargin={8}
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                            tickFormatter={(v: number) => Math.round(v).toLocaleString()}
                            label={{ value: 'In Motion (USD)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
                        />

                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            width={72}
                            tickMargin={8}
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                            tickFormatter={(v: number) => Math.round(v).toLocaleString()}
                            label={{ value: 'Idling (USD)', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
                        />

                        <Tooltip content={<CustomTooltip />} />
                        <Legend />

                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="motionExpense"
                            stroke="#1F2937"
                            strokeWidth={2.5}
                            dot={{ fill: '#1F2937', strokeWidth: 0, r: 3 }}
                            name="Fuel (Motion)"
                        />

                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="idlingExpense"
                            stroke="#DC2626"
                            strokeWidth={2.5}
                            dot={{ fill: '#DC2626', strokeWidth: 0, r: 3 }}
                            name="Fuel (Idling)"
                        />
                    </LineChart>
                </ResponsiveContainer>
            )}

            <div className="flex flex-wrap gap-4 mt-4 text-xs">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-gray-800 dark:bg-gray-200 rounded" />
                    <span className="font-medium text-foreground">Fuel Expense (Motion)</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-red-600 dark:bg-red-500 rounded" />
                    <span className="font-medium text-foreground">Fuel Expense (Idling)</span>
                </div>
            </div>
        </div>
    );
};
