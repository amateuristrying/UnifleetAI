'use client';

import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Label
} from 'recharts';
import { useEffect, useState } from 'react'; // 1. Import hooks

interface ScatterData {
  tracker_name: string;
  tracker_brand: string;
  total_km: number;
  total_hours: number;
  avg_speed: number;
  trip_count: number;
  avg_volatility?: number;
  avg_fatigue?: number;
  avg_grade?: number;
  total_co2?: number;
}

interface FilterState {
  brands: string[];
  vehicles: string[];
}

interface DateRange {
  start: string;
  end: string;
}

export default function EfficiencyScatterChart({
  data,
  filters,
  dateRange
}: {
  data: ScatterData[];
  filters?: FilterState;
  dateRange?: DateRange;
}) {
  // 2. Add Mounted State
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const processedData = data?.map(d => ({
    ...d,
    total_km: Number(d.total_km || 0),
    total_hours: Number(d.total_hours || 0),
    // Fallback for avg_speed if RPC returns different column name
    avg_speed: Number(d.avg_speed !== undefined ? d.avg_speed : (d as any).avg_speed_kmh || 0),
    avg_volatility: d.avg_volatility ? Number(d.avg_volatility) : undefined,
    avg_fatigue: d.avg_fatigue ? Number(d.avg_fatigue) : undefined,
    avg_grade: d.avg_grade ? Number(d.avg_grade) : undefined,
    total_co2: d.total_co2 ? Number(d.total_co2) : undefined,
  })).filter(d => !isNaN(d.total_km) && !isNaN(d.total_hours) && !isNaN(d.avg_speed));

  // 3. Render a loading placeholder until mounted to prevent Recharts -1 error
  if (!mounted) {
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-6 h-[500px] flex items-center justify-center">
        <div className="animate-pulse text-slate-300 text-sm">Loading Chart...</div>
      </div>
    );
  }

  if (processedData.length === 0) {
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-6 h-[480px] flex flex-col items-center justify-center text-gray-400 text-sm">
        <p>No fleet data available for analysis.</p>
        <p className="text-xs mt-2 text-gray-300">Try adjusting your filters</p>
      </div>
    );
  }

  const maxKmVal = Math.max(...processedData.map(d => d.total_km));
  const maxKm = maxKmVal > 0 ? maxKmVal * 1.1 : 100;
  const maxHoursVal = Math.max(...processedData.map(d => d.total_hours));
  const maxHours = maxHoursVal > 0 ? maxHoursVal * 1.1 : 10;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const v = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-xl rounded-lg text-xs z-50 min-w-[200px]">
          <p className="font-bold text-slate-800 mb-1 text-sm border-b pb-1 border-slate-100">{v.tracker_name}</p>
          <div className="space-y-1 pt-1">
            <div className="flex justify-between"><span className="text-gray-500">Brand:</span> <span className="text-slate-700">{v.tracker_brand}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Dist:</span> <span className="font-mono">{Number(v.total_km).toFixed(1)} km</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Time:</span> <span className="font-mono">{Number(v.total_hours).toFixed(1)} hrs</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Avg Spd:</span> <span className="font-mono font-bold">{Number(v.avg_speed).toFixed(1)} km/h</span></div>

            {v.avg_grade !== undefined && (
              <div className="flex justify-between mt-2 pt-2 border-t border-slate-100">
                <span className="text-gray-500">Score:</span>
                <span className={`font-mono font-bold ${v.avg_grade >= 80 ? 'text-green-600' : v.avg_grade >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                  {Math.round(v.avg_grade)}/100
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-6 flex flex-col">
      <div className="mb-6">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className="text-lg font-bold text-slate-800">Fleet Efficiency Matrix</h3>

          {filters?.brands && filters.brands.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium border border-slate-200 uppercase tracking-wide">
              {filters.brands.length > 1 ? `${filters.brands.length} Brands` : filters.brands[0]}
            </span>
          )}
          {filters?.vehicles && filters.vehicles.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium border border-slate-200 uppercase tracking-wide">
              {filters.vehicles.length > 1 ? `${filters.vehicles.length} Vehicles` : filters.vehicles[0]}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          X: Distance vs Y: Duration. Size = Trip Count.
        </p>
      </div>

      <div className="h-[400px] w-full">
        {/* 4. Use 99% width as a hack to force recalc, or standard 100% with mounted check */}
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />

            <XAxis
              type="number"
              dataKey="total_km"
              name="Distance"
              unit="km"
              domain={[0, maxKm]}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
            >
              <Label value="Total Distance (km)" offset={-10} position="insideBottom" style={{ fontSize: 12, fill: '#64748b' }} />
            </XAxis>

            <YAxis
              type="number"
              dataKey="total_hours"
              name="Time"
              unit="hrs"
              domain={[0, maxHours]}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
            >
              <Label value="Duration (hrs)" angle={-90} position="insideLeft" style={{ fontSize: 12, fill: '#64748b' }} />
            </YAxis>

            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />

            <Scatter name="Vehicles" data={processedData} fill="#3b82f6" animationDuration={1000}>
              {processedData.map((entry, index) => {
                let color = '#3b82f6';
                if (entry.avg_grade !== undefined) {
                  if (entry.avg_grade >= 85) color = '#10b981';
                  else if (entry.avg_grade >= 70) color = '#f59e0b';
                  else color = '#ef4444';
                }
                return <Cell key={`cell-${index}`} fill={color} stroke={color} fillOpacity={0.6} />;
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}