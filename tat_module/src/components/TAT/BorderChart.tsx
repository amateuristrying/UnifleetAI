'use client';

import React from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from 'recharts';

interface BorderChartProps {
    data: Array<{
        day_date: string;
        avg_wait_hours: number;
        truck_count: number;
    }>;
    title: string;
}

export function BorderChart({ data, title }: BorderChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl h-96 flex items-center justify-center">
                <p className="text-gray-500">No data available for {title}</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
            <h3 className="text-lg font-semibold text-white mb-6">{title}</h3>
            <div className="h-80 w-full min-h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                            dataKey="day_date"
                            tickFormatter={(date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            stroke="#9CA3AF"
                        />
                        <YAxis stroke="#9CA3AF" label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#fff' }}
                            itemStyle={{ color: '#fff' }}
                            labelFormatter={(label) => new Date(label).toDateString()}
                        />
                        <Legend />
                        <Bar dataKey="avg_wait_hours" name="Avg Wait (Hours)" fill="#EF4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
