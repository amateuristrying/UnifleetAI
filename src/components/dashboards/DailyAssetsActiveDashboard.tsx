// src/components/dashboards/DailyAssetsActiveDashboard.tsx
import { useEffect, useState, useRef } from 'react';
import { LineChart, Line, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LimitedDateFilter } from './common/LimitedDateFilter';
import { CustomTooltip } from './common/CustomTooltip';
import { SmartDateXAxis } from '@/components/SmartDateXAxis';
import { useOps } from '@/context/OpsContext';


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



export function DailyAssetsActiveDashboard({
    dateFilter,
    setDateFilter,
    onLoadingChange,
}: DailyAssetsActiveDashboardProps) {
    const { ops } = useOps();
    const [rawAssets, setRawAssets] = useState<AssetPoint[]>([]);
    const [metadata, setMetadata] = useState<{dataAvailableThrough?: string, anchorDate?: string}>({});
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);

    useEffect(() => {
        const controller = new AbortController();

        const fetchAssetsActive = async (retryCount = 0) => {
            setLoading(true);
            try {
                let windowParam = 'last30days';
                if (dateFilter === '7 days') windowParam = 'last7days';
                if (dateFilter === 'MTD') windowParam = 'mtd';
                if (dateFilter === '30 days') windowParam = 'last30days';

                const baseUrl = ops === 'tanzania' 
                    ? 'https://pjagc4397d.execute-api.ap-south-1.amazonaws.com/assets-active'
                    : 'https://ds16ac8znh.execute-api.ap-south-1.amazonaws.com/assets-active';
                const url = new URL(baseUrl);
                url.searchParams.set('window', windowParam);
                url.searchParams.set('t', Date.now().toString());

                const res = await fetch(url.toString(), { 
                    method: 'GET', 
                    signal: controller.signal
                });
                
                // Handle 503 with retry
                if (res.status === 503 && retryCount < 1) {
                    console.warn('[DailyAssets] 503 Service Unavailable, retrying...');
                    await new Promise(r => setTimeout(r, 1000));
                    return fetchAssetsActive(retryCount + 1);
                }

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                console.log("ASSETS API RESPONSE:", data);
                
                setMetadata({
                    dataAvailableThrough: data.data_available_through,
                    anchorDate: data.anchor_date
                });

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
                    setMetadata({});
                }
            } finally {
                setLoading(false);
            }
        };

        fetchAssetsActive();
        return () => controller.abort();
    }, [ops, dateFilter]);

    const chartData = rawAssets;
    const tableData = rawAssets;

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [tableData]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header/filter hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide mb-6 relative">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-flex flex-col mb-4">
                    <h3 className="text-lg font-bold uppercase tracking-wide">DAILY ASSETS ACTIVE</h3>
                    {metadata.dataAvailableThrough && (
                        <span className="text-xs text-muted-foreground mt-1 capitalize font-medium">
                            Data through {new Date(metadata.dataAvailableThrough).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                    )}
                </div>
                <div className="block">
                    <LimitedDateFilter title="Daily Assets Active" dateFilter={dateFilter} setDateFilter={setDateFilter} />
                </div>
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
                <div className="bg-muted/30 rounded-xl p-4 border border-border flex flex-col h-[400px]">
                    <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4 shrink-0">Recent Data</h4>
                    {loading ? (
                        <p className="text-xs italic text-muted-foreground">Loading...</p>
                    ) : (
                        <div className="text-xs flex flex-col flex-1 overflow-hidden">
                            <div className="grid grid-cols-2 gap-2 font-bold border-b border-border pb-2 shrink-0 mb-2">
                                <span className="text-foreground">Date</span>
                                <span className="text-foreground">Assets</span>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar" ref={scrollRef}>
                                {tableData.map((item) => (
                                    <div
                                        key={item.date}
                                        className="grid grid-cols-2 gap-2 py-1.5 px-1 rounded bg-surface-card text-foreground"
                                    >
                                        <span className="text-foreground">{item.date}</span>
                                        <span className="font-medium text-foreground">{item.assets}</span>
                                    </div>
                                ))}
                                {tableData.length === 0 && (
                                    <div className="italic text-muted-foreground py-2">No data</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
