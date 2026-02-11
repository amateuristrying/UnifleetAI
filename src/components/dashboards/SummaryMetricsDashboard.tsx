// src/components/dashboards/SummaryMetricsDashboard.tsx
import { useEffect, useState } from 'react';
import { DateFilter } from './common/DateFilter';
import { useOps } from '@/context/OpsContext';
import { api } from '@/context/config';

interface SummaryMetricsDashboardProps {
    dateFilter: string;
    setDateFilter: (filter: string) => void;
}

interface KPIReports {
    totalTripsLengthKm: number;
    numberOfTrips: number;
    avgDistancePerTrip: number;
    avgSpeedWhenInMotion: number;
    avgSpeedInTrip: number;
    totalDrivingHours: number;
    avgDrivingHoursPerTrip: number;
    avgDrivingHoursPerDay: number;
    vehiclesAbove5km: number;
    totalNightDrivingHours: number;
}

interface FleetKpis {
    totalEngineHours: number;
    totalInMovementHours: number;
    totalIdlingHours: number;
    totalIgnitionHours: number;
    fuelIdleLitres: number;
    fuelMotionLitres: number;
    fuelTotalLitres: number;
    fuelMotionDollars: number | null;
    fuelIdleDollars: number;
    fuelTotalDollars: string;
    mileageKmpl: number;
    co2eqMt: number;
}

type MetricValue = number | string | null | undefined;
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const fmt = (v: MetricValue): string => {
    if (typeof v === 'number' && isFinite(v)) return nf.format(v);
    if (typeof v === 'string') return v;
    return '—';
};

function MetricRow({ label, value }: { label: string; value: MetricValue }) {
    return (
        <div className="flex justify-between items-center py-2 border-b border-border last:border-b-0">
            <span className="text-muted-foreground text-sm">{label}</span>
            <span className="text-foreground font-semibold text-sm">{fmt(value)}</span>
        </div>
    );
}

function buildSummaryUrl(base: string, table: 's1' | 's2', period: 'latest' | '7d' | '30d') {
    const root = base.replace(/\/$/, '');
    const withPath = root.endsWith('/summary') ? root : `${root}/summary`;
    return `${withPath}?table=${table}&period=${period}`;
}

export function SummaryMetricsDashboard({
    dateFilter,
    setDateFilter,
}: SummaryMetricsDashboardProps) {
    const { ops } = useOps();
    const [kpiReports, setKpiReports] = useState<KPIReports | null>(null);
    const [fleetKpis, setFleetKpis] = useState<FleetKpis | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        const fetchSummaries = async () => {
            setLoading(true);
            try {
                const periodMap: Record<string, 'latest' | '7d' | '30d'> = {
                    '1 day': 'latest',
                    '7 days': '7d',
                    '30 days': '30d',
                };
                const period = periodMap[dateFilter] ?? 'latest';

                const base = api(ops, 'summaryMetrics');

                const s1Url = buildSummaryUrl(base, 's1', period);
                const s2Url = buildSummaryUrl(base, 's2', period);

                console.log('[SummaryMetrics] Fetching:', { s1Url, s2Url });

                const [res1, res2] = await Promise.all([
                    fetch(s1Url, { signal: controller.signal }),
                    fetch(s2Url, { signal: controller.signal }),
                ]);
                const [data1, data2] = await Promise.all([res1.json(), res2.json()]);

                console.log('[SummaryMetrics] S1 Response:', data1);
                console.log('[SummaryMetrics] S2 Response:', data2);

                // Parse S1 - using exact keys from UNIFLEET 3 API (values are strings)
                const m1 = data1?.metrics ?? {};
                setKpiReports({
                    totalTripsLengthKm: parseFloat(m1['Total Trips Length (km)']) || 0,
                    numberOfTrips: parseFloat(m1['Number of Trips']) || 0,
                    avgDistancePerTrip: parseFloat(m1['Average Distance Travelled per Trip']) || 0,
                    avgSpeedWhenInMotion: parseFloat(m1['Average Speed when in motion']) || 0,
                    avgSpeedInTrip: parseFloat(m1['Average Speed in Trip']) || 0,
                    totalDrivingHours: parseFloat(m1['Total Driving Duration (hrs)']) || 0,
                    avgDrivingHoursPerTrip: parseFloat(m1['Average Driving Hours per Trip']) || 0,
                    avgDrivingHoursPerDay: parseFloat(m1['Average Driving Hours per Day']) || 0,
                    vehiclesAbove5km: parseFloat(m1['Vehicles ≥5 km']) || 0,
                    totalNightDrivingHours: parseFloat(m1['Total Night Driving Duration (hrs)']) || 0,
                });

                // Parse S2 - using exact keys from UNIFLEET 3 API (values are strings)
                const m2 = data2?.metrics ?? {};
                setFleetKpis({
                    totalEngineHours: parseFloat(m2['Total Engine Hours (hrs)']) || 0,
                    totalInMovementHours: parseFloat(m2['Total In Movement Duration (hrs)']) || 0,
                    totalIdlingHours: parseFloat(m2['Total Idling Hours (hrs)']) || 0,
                    totalIgnitionHours: parseFloat(m2['Total Ignition Duration (hrs)']) || 0,
                    fuelIdleLitres: parseFloat(m2['Fuel Consumption while idling (in litres)']) || 0,
                    fuelMotionLitres: parseFloat(m2['Fuel Consumption while in motion (in litres)']) || 0,
                    fuelTotalLitres: parseFloat(m2['Total Fuel Consumption (in litres)']) || 0,
                    fuelMotionDollars: parseFloat(m2['Fuel Expense while motion (in dollars)']) || null,
                    fuelIdleDollars: parseFloat(m2['Fuel Expense while Idling (in dollars)']) || 0,
                    fuelTotalDollars: data2?.raw?.['Fuel Expense (in dollars)'] ?? m2['Fuel Expense (in dollars)'] ?? '—',
                    mileageKmpl: parseFloat(m2['Mileage (in kmpl)']) || 0,
                    co2eqMt: parseFloat(m2['mtCO2eq emissions (in MT)']) || 0,
                });
            } catch (err: unknown) {
                if ((err as Error)?.name !== 'AbortError') {
                    console.error('❌ Failed to fetch Summary Metrics', err);
                    setKpiReports(null);
                    setFleetKpis(null);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchSummaries();
        return () => controller.abort();
    }, [dateFilter, ops]);

    return (
        <div className="bg-surface-card rounded-[24px] shadow-lg border border-border p-6 mb-6 pdf-content">
            {/* Header and DateFilter - hidden in PDF */}
            <div data-pdf-hide="true" className="pdf-hide">
                <div className="bg-muted text-foreground px-4 py-3 rounded-xl inline-block mb-6">
                    <h3 className="text-lg font-bold uppercase tracking-wide">SUMMARY METRICS</h3>
                </div>
                <DateFilter title="Summary Metrics" dateFilter={dateFilter} setDateFilter={setDateFilter} />
            </div>

            {loading ? (
                <p className="text-muted-foreground italic">Loading summary...</p>
            ) : (
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Left: Trip KPIs */}
                    <div className="bg-muted/30 rounded-xl p-5 border border-border">
                        <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Trip Statistics</h4>
                        <MetricRow label="Total Trips Distance (km)" value={kpiReports?.totalTripsLengthKm} />
                        <MetricRow label="Number of Trips" value={kpiReports?.numberOfTrips} />
                        <MetricRow label="Avg Distance/Trip (km)" value={kpiReports?.avgDistancePerTrip} />
                        <MetricRow label="Avg Speed in Motion (km/h)" value={kpiReports?.avgSpeedWhenInMotion} />
                        <MetricRow label="Total Driving Hours" value={kpiReports?.totalDrivingHours} />
                        <MetricRow label="Avg Driving Hours/Day" value={kpiReports?.avgDrivingHoursPerDay} />
                        <MetricRow label="Vehicles >5km" value={kpiReports?.vehiclesAbove5km} />
                        <MetricRow label="Night Driving Hours" value={kpiReports?.totalNightDrivingHours} />
                    </div>

                    {/* Right: Fleet KPIs */}
                    <div className="bg-muted/30 rounded-xl p-5 border border-border">
                        <h4 className="text-sm font-bold uppercase text-muted-foreground mb-4">Fleet Statistics</h4>
                        <MetricRow label="Total Engine Hours" value={fleetKpis?.totalEngineHours} />
                        <MetricRow label="In Movement Hours" value={fleetKpis?.totalInMovementHours} />
                        <MetricRow label="Total Idling Hours" value={fleetKpis?.totalIdlingHours} />
                        <MetricRow label="Fuel (Motion) Litres" value={fleetKpis?.fuelMotionLitres} />
                        <MetricRow label="Fuel (Idle) Litres" value={fleetKpis?.fuelIdleLitres} />
                        <MetricRow label="Total Fuel Litres" value={fleetKpis?.fuelTotalLitres} />
                        <MetricRow label="Fuel Cost (USD)" value={fleetKpis?.fuelTotalDollars} />
                        <MetricRow label="Mileage (km/L)" value={fleetKpis?.mileageKmpl} />
                        <MetricRow label="CO₂ Equivalent (MT)" value={fleetKpis?.co2eqMt} />
                    </div>
                </div>
            )}
        </div>
    );
}
