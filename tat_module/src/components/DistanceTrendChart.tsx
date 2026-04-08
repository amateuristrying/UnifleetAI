'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Area
} from 'recharts';
import { useState, useEffect } from 'react';

interface TrendData {
  day: string;
  total_km: number | string;
  day_km: number | string;
  night_km: number | string;
  trip_count: number | string;
  avg_speed: number | string;
}

interface FilterState {
  brands: string[];
  vehicles: string[];
}

interface DateRange {
  start: string;
  end: string;
}

export default function DistanceTrendChart({
  data,
  filters,
  dateRange
}: {
  data: TrendData[];
  filters?: FilterState;
  dateRange?: DateRange;
}) {
  // State to toggle lines visibility
  const [showSpeed, setShowSpeed] = useState(true);
  const [showTrips, setShowTrips] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 1. Process Data & Aggregates
  const processedData = data?.map(item => ({
    ...item,
    day_str: new Date(item.day).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
    total_km: Number(item.total_km),
    day_km: Number(item.day_km),
    night_km: Number(item.night_km),
    trip_count: Number(item.trip_count),
    avg_speed: Number(item.avg_speed),
  })) || [];

  if (!mounted) {
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-6 h-[450px] flex items-center justify-center">
        <div className="animate-pulse text-slate-300 text-sm">Loading Trend Chart...</div>
      </div>
    );
  }

  if (!processedData || processedData.length === 0) {
    return (
      <div className="h-96 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center justify-center text-gray-400 text-sm">
        No analytical data available for this range.
      </div>
    );
  }

  // Calculate Chart Max Summary
  const totalRangeKm = processedData.reduce((acc, curr) => acc + curr.total_km, 0);
  const totalNightKm = processedData.reduce((acc, curr) => acc + curr.night_km, 0);
  const nightRatio = totalRangeKm > 0 ? (totalNightKm / totalRangeKm) * 100 : 0;

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-6">

      {/* Header with Quick Insights */}
      <div className="flex flex-wrap items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-lg font-bold text-slate-800">Operational Efficiency & Risk</h3>
            {(filters?.brands?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium border border-slate-200 uppercase tracking-wide">
                {filters!.brands.length > 1 ? `${filters!.brands.length} Brands` : filters!.brands[0]}
              </span>
            )}
            {(filters?.vehicles?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium border border-slate-200 uppercase tracking-wide">
                {filters!.vehicles.length > 1 ? `${filters!.vehicles.length} Vehicles` : filters!.vehicles[0]}
              </span>
            )}
            {(dateRange?.start || dateRange?.end) && (
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-medium border border-blue-100 uppercase tracking-wide">
                {dateRange?.start ? new Date(dateRange.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Start'}
                {' - '}
                {dateRange?.end ? new Date(dateRange.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'End'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">Distance vs Speed vs Utilization intensity</p>
        </div>

        <div className="flex gap-4">
          <div className="text-right">
            <p className="text-xs text-slate-400 uppercase font-semibold">Total Vol</p>
            <p className="text-sm font-bold text-slate-700">{totalRangeKm.toLocaleString()} km</p>
          </div>
          <div className="text-right border-l pl-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Night Risk</p>
            <p className={`text-sm font-bold ${nightRatio > 15 ? 'text-red-500' : 'text-green-600'}`}>
              {nightRatio.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      {/* Control Toggles */}
      <div className="flex gap-3 mb-2 text-xs">
        <button
          onClick={() => setShowSpeed(!showSpeed)}
          className={`px-3 py-1 rounded-full border transition-colors ${showSpeed ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 text-gray-400'}`}
        >
          {showSpeed ? 'Hide' : 'Show'} Speed
        </button>
        <button
          onClick={() => setShowTrips(!showTrips)}
          className={`px-3 py-1 rounded-full border transition-colors ${showTrips ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 text-gray-400'}`}
        >
          {showTrips ? 'Hide' : 'Show'} Trips
        </button>
      </div>

      <div className="h-[350px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <ComposedChart data={processedData} margin={{ top: 10, right: 0, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />

            <XAxis
              dataKey="day_str"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
              dy={10}
            />

            {/* Left Axis: Distance */}
            <YAxis
              yAxisId="left"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
              label={{ value: 'Distance (km)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: '10px' } }}
            />

            {/* Right Axis: Speed / Count */}
            <YAxis
              yAxisId="right"
              orientation="right"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b' }}
            />

            <Tooltip
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              cursor={{ fill: '#f8fafc' }}
              labelStyle={{ color: '#1e293b', fontWeight: 'bold', marginBottom: '8px' }}
            />

            <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />

            {/* Stacked Bars for Distance */}
            <Bar yAxisId="left" name="Day Driving" dataKey="day_km" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} barSize={30} />
            <Bar yAxisId="left" name="Night Driving" dataKey="night_km" stackId="a" fill="#1e1b4b" radius={[4, 4, 0, 0]} barSize={30} />

            {/* Lines for Insights */}
            {showSpeed && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avg_speed"
                name="Avg Speed (km/h)"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: '#f59e0b' }}
              />
            )}

            {showTrips && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="trip_count"
                name="Trip Count"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: '#10b981' }}
              />
            )}

          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}