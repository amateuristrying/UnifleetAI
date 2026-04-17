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
                
                // Use the same window params as the Reports section for better compatibility
                const windowType = dateFilter === "7 days" ? "last7days" : (dateFilter === "MTD" ? "mtd" : "last30days");
                const shortWin = windowType === "last7days" ? "7d" : "30d";
                
                // Try few common URL patterns as seen in Reports logic
                const tryUrls = [
                    `${endpoint}?window=${windowType}&_t=${Date.now()}`,
                    `${endpoint}?window=${shortWin}&_t=${Date.now()}`,
                    `${base}?window=${windowType}&_t=${Date.now()}`
                ];

                let json: any = null;
                let res: Response | null = null;
                
                for (const url of tryUrls) {
                    try {
                        const r = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
                        if (r.ok) {
                            res = r;
                            json = await r.json();
                            break;
                        }
                        if (r.status === 503) res = r; // Keep 503 for retry logic
                    } catch (e) {
                        console.warn(`[FuelExpense] Failed to fetch ${url}`, e);
                    }
                }

                if (!res) throw new Error("Could not reach any Fuel Expense endpoint");
                
                // Handle 503 with retry
                if (res.status === 503 && retryCount < 1) {
                    console.warn('[FuelExpense] 503 Service Unavailable, retrying...');
                    await new Promise(r => setTimeout(r, 1000));
                    return fetchFuelExpense(retryCount + 1);
                }

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                // Extraction logic mirroring Reports.tsx for maximum accuracy
                const extractList = (raw: any): any[] => {
                    if (!raw) return [];
                    if (Array.isArray(raw)) return raw;
                    const dashList = windowType === "last7days" ? raw?.results?.last7days?.fuel_expense : raw?.results?.last30days?.fuel_expense;
                    if (Array.isArray(dashList)) return dashList;
                    if (Array.isArray(raw?.fuel_expense)) return raw.fuel_expense;
                    if (Array.isArray(raw?.data?.fuel_expense)) return raw.data.fuel_expense;
                    if (Array.isArray(raw?.data)) return raw.data;
                    return [];
                };

                let windowData = extractList(json);

                // For MTD, ensure data starts from 1st of current month
                if (dateFilter === "MTD" && Array.isArray(windowData)) {
                    if (windowData.length > 31) {
                        const now = new Date();
                        const y = now.getFullYear();
                        const m = String(now.getMonth() + 1).padStart(2, '0');
                        const startOfMonth = `${y}-${m}-01`;
                        windowData = windowData.filter((d: any) => String(d.date ?? d.day ?? '') >= startOfMonth);
                    }
                } else if (dateFilter === "30 days" && Array.isArray(windowData)) {
                    // Strip leading zero-value entries
                    while (windowData.length > 0) {
                        const first = windowData[0];
                        const m = Number(first?.motion_usd ?? first?.motionUSD ?? first?.motion ?? 0);
                        const i = Number(first?.idle_usd ?? first?.idleUSD ?? first?.idle ?? 0);
                        if (m === 0 && i === 0) {
                            windowData = windowData.slice(1);
                        } else {
                            break;
                        }
                    }
                }

                const processed: FuelExpensePoint[] = Array.isArray(windowData)
                    ? windowData.map((d: any) => ({
                        date: d.date ?? d.day ?? '',
                        motionExpense: Number(d.motion_usd ?? d.motionUSD ?? d.motion ?? 0),
                        idlingExpense: Number(d.idle_usd ?? d.idleUSD ?? d.idle ?? 0),
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
