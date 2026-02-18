// src/components/dashboards/DailyAssetsActiveDashboard.tsx
import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LimitedDateFilter } from './common/LimitedDateFilter';
import { CustomTooltip } from './common/CustomTooltip';
import { SmartDateXAxis } from '@/components/SmartDateXAxis';
import { useOps } from '@/context/OpsContext';
import { api } from '@/context/config';

interface DailyAssetsActiveDashboardProps {
    dateFilter: string;
    setDateFilter: (filter: string) => void;
    onLoadingChange?: (loading: boolean) => void;
}

interface AssetPoint {
    date: string;
    assets: number;
    status?: 'normal' | 'warning' | 'critical';
}

function smoothSeries(points: AssetPoint[], windowSize = 3): AssetPoint[] {
    if (points.length < 3 || windowSize <= 1) return points;

    const half = Math.floor(windowSize / 2);
    return points.map((p, i) => {
        let sum = 0;
        let count = 0;

        for (let k = i - half; k <= i + half; k++) {
            if (k >= 0 && k < points.length) {
                sum += points[k].assets;
                count++;
            }
        }

        const smoothed = Math.round(sum / Math.max(count, 1));
        return { ...p, assets: smoothed };
    });
}

export function DailyAssetsActiveDashboard({
    dateFilter,
    setDateFilter,
    onLoadingChange,
}: DailyAssetsActiveDashboardProps) {
    const { ops } = useOps();
    const [rawAssets, setRawAssets] = useState<AssetPoint[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    useEffect(() => {
        const controller = new AbortController();

        const fetchAssetsActive = async () => {
            setLoading(true);
            try {
                const url = api(ops, 'assetsActive');
                console.log('[DailyAssets] Fetching:', url);
                const res = await fetch(url, { method: 'GET', signal: controller.signal });
                const data = await res.json();
                console.log('[DailyAssets] Response:', data);

                const list: AssetPoint[] = Array.isArray(data?.assets_active)
                    ? data.assets_active.map((d: { date: string; assets: number }) => {
                        let status: 'normal' | 'warning' | 'critical' = 'normal';
                        if (d.assets < 30) status = 'critical';
                        else if (d.assets < 45) status = 'warning';
                        return { date: d.date, assets: Number(d.assets) || 0, status };
                    })
                    : [];

                setRawAssets(list);
            } catch (err: unknown) {
                if ((err as Error)?.name !== 'AbortError') {
                    console.error('Failed to fetch assets active', err);
                    setRawAssets([]);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchAssetsActive();
        return () => controller.abort();
    }, [ops]);

    const filteredData = useMemo(() => {
        if (dateFilter === '7 days') return rawAssets.slice(-7);
        return rawAssets;
    }, [rawAssets, dateFilter]);

    const chartData = useMemo(() => smoothSeries(filteredData, 3), [filteredData]);

    const tableData = useMemo(() => {
        const rows = dateFilter === '7 days' ? 7 : 15;
        return filteredData.slice(-rows);
    }, [filteredData, dateFilter]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/filter hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-block mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-wide">DAILY ASSETS ACTIVE</h3>
                </div>
                <LimitedDateFilter title="Daily Assets Active" dateFilter={dateFilter} setDateFilter={setDateFilter} />
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Chart */}
                <div className="lg:col-span-2">
                    {loading ? (
                        <p className="text-muted-foreground italic text-sm">Loading chart...</p>
                    ) : (
                        <div style={{ width: '100%', height: 400 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeWidth={1} stroke="hsl(var(--border))" strokeDasharray="none" />
                                    <SmartDateXAxis data={chartData} dataKey="date" maxTicks={8} height={70} />
                                    <YAxis
                                        stroke="hsl(var(--muted-foreground))"
                                        strokeWidth={1}
                                        style={{ fontSize: '12px', fontWeight: 500 }}
                                        allowDecimals={false}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Line
                                        type="monotoneX"
                                        dataKey="assets"
                                        stroke="#3B82F6"
                                        strokeWidth={2.5}
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        connectNulls
                                        dot={{ fill: '#3B82F6', strokeWidth: 0, r: 3 }}
                                        activeDot={{ r: 5 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                {/* Table */}
                <div className="bg-muted/30 rounded-xl p-4 border border-border">
                    <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Recent Data</h4>
                    {loading ? (
                        <p className="text-xs italic text-muted-foreground">Loading...</p>
                    ) : (
                        <div className="text-xs space-y-1 max-h-[350px] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-2 font-bold border-b border-border pb-1 sticky top-0 bg-muted/30 backdrop-blur-sm">
                                <span className="text-foreground">Date</span>
                                <span className="text-foreground">Assets</span>
                            </div>
                            {tableData.map((item) => (
                                <div
                                    key={item.date}
                                    className={`grid grid-cols-2 gap-2 py-1.5 px-1 rounded ${item.status === 'critical'
                                        ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                                        : item.status === 'warning'
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                                            : 'bg-surface-card text-foreground'
                                        }`}
                                >
                                    <span className="text-foreground">{item.date}</span>
                                    <span className="font-medium text-foreground">{item.assets}</span>
                                </div>
                            ))}
                            {tableData.length === 0 && (
                                <div className="italic text-muted-foreground py-2">No data</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
