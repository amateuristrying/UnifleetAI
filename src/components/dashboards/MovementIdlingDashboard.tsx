// src/components/dashboards/MovementIdlingDashboard.tsx
import { useEffect, useState } from "react";
import {
    LineChart,
    Line,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";
import { LimitedDateFilter } from "./common/LimitedDateFilter";
import { CustomTooltip } from "./common/CustomTooltip";
import { SmartDateXAxis } from "@/components/SmartDateXAxis";
import { useOps } from "@/context/OpsContext";
import { api } from "@/context/config";

interface MovementIdlingDashboardProps {
    dateFilter: string;
    setDateFilter: (filter: string) => void;
    onLoadingChange?: (loading: boolean) => void;
}

interface DataPoint {
    date: string;
    totalIdling: number;
    totalMovement: number;
}

export const MovementIdlingDashboard: React.FC<MovementIdlingDashboardProps> = ({
    dateFilter,
    setDateFilter,
    onLoadingChange,
}) => {
    const { ops } = useOps();
    const [data, setData] = useState<DataPoint[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    useEffect(() => {
        const run = async () => {
            setLoading(true);
            try {
                const base = api(ops, "inMovementVsIdling").replace(/\/+$/, "");
                const windowType = dateFilter === "7 days" ? "7d" : dateFilter === "MTD" ? "mtd" : "30d";
                const url = `${base}?window=${windowType}`;

                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();

                console.log(`[MovementIdling] URL: ${url}`, json);

                // New flat format: json.data  |  Legacy: json.results.lastXdays.data
                const legacyKey = windowType === '7d' ? 'last7days' : 'last30days';
                let series = json?.data
                    ?? json?.results?.[legacyKey]?.data
                    ?? [];
                if (dateFilter === "MTD" && Array.isArray(series)) {
                    const now = new Date();
                    const y = now.getFullYear();
                    const m = String(now.getMonth() + 1).padStart(2, '0');
                    const startOfMonth = `${y}-${m}-01`;
                    series = series.filter((d: any) => d.date >= startOfMonth);
                }
                setData(Array.isArray(series) ? series : []);
            } catch (e) {
                console.error("Failed to fetch movement vs idling", e);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        run();
    }, [dateFilter, ops]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/filter hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-block mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-wide">
                        IN MOVEMENT VS IDLING
                    </h3>
                </div>
                <LimitedDateFilter
                    title="Movement vs Idling"
                    dateFilter={dateFilter}
                    setDateFilter={setDateFilter}
                />
            </div>

            {loading ? (
                <p className="text-muted-foreground italic text-sm">Loading chart...</p>
            ) : (
                <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={data} margin={{ top: 8, right: 60, left: 60, bottom: 44 }}>
                        <CartesianGrid strokeWidth={1} stroke="hsl(var(--border))" strokeDasharray="none" />
                        <SmartDateXAxis data={data} dataKey="date" maxTicks={8} height={70} />

                        <YAxis
                            yAxisId="left"
                            orientation="left"
                            width={60}
                            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            tickMargin={8}
                            label={{ value: "Idling (hrs)", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
                        />

                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            width={60}
                            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            tickMargin={8}
                            label={{ value: "Movement (hrs)", angle: 90, position: "insideRight", style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
                        />

                        <Tooltip content={<CustomTooltip />} />
                        <Legend />

                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="totalIdling"
                            stroke="#3B82F6"
                            strokeWidth={2.5}
                            dot={{ fill: "#3B82F6", strokeWidth: 0, r: 3 }}
                            name="Total Idling Hours"
                        />
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="totalMovement"
                            stroke="#F97316"
                            strokeWidth={2.5}
                            dot={{ fill: "#F97316", strokeWidth: 0, r: 3 }}
                            name="Total Movement Hours"
                        />
                    </LineChart>
                </ResponsiveContainer>
            )}

            <div className="flex flex-wrap gap-4 mt-4 text-xs">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-blue-500 rounded" />
                    <span className="font-medium text-foreground">Total Idling Hours</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-orange-500 rounded" />
                    <span className="font-medium text-foreground">Total Movement Hours</span>
                </div>
            </div>
        </div>
    );
};
