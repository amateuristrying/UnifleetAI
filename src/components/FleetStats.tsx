import { Gauge, TrendingUp, TrendingDown, Clock, Car, Moon } from 'lucide-react';
import type { FleetAnalysis } from '@/types/fleet-analysis';

interface FleetStatsProps {
    analysis: FleetAnalysis | null;
    loading?: boolean;
}

export function FleetStats({ analysis, loading = false }: FleetStatsProps) {
    if (loading || !analysis) return null;

    const stats = [
        {
            label: 'FLEET AVERAGE SPEED',
            value: `${analysis.avgSpeed} km/h`,
            icon: Gauge,
            color: 'text-blue-500',
            bg: 'bg-blue-50 dark:bg-blue-900/10',
        },
        {
            label: 'ASSETS ABOVE AVERAGE',
            value: analysis.aboveAvgSpeed.toString(),
            icon: TrendingUp,
            color: 'text-green-500',
            bg: 'bg-green-50 dark:bg-green-900/10',
        },
        {
            label: 'ASSETS BELOW AVERAGE',
            value: analysis.belowAvgSpeed.toString(),
            icon: TrendingDown,
            color: 'text-orange-500',
            bg: 'bg-orange-50 dark:bg-orange-900/10',
        },
        {
            label: 'TOTAL IDLING TIME',
            value: `${analysis.totalIdlingTime.toLocaleString()} hrs`,
            icon: Clock,
            color: 'text-red-500',
            bg: 'bg-red-50 dark:bg-red-900/10',
        },
        {
            label: 'AVG DRIVING HOURS/DAY',
            value: analysis.avgDrivingHours.toString(),
            icon: Car,
            color: 'text-purple-500',
            bg: 'bg-purple-50 dark:bg-purple-900/10',
        },
        {
            label: 'NIGHT DRIVING (HRS)',
            value: analysis.nightDrivingHrs.toLocaleString(),
            icon: Moon,
            color: 'text-indigo-500',
            bg: 'bg-indigo-50 dark:bg-indigo-900/10',
        },
    ];

    return (
        <div className="flex w-full max-w-[1400px] gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {stats.map((stat, i) => (
                <div
                    key={i}
                    className={`flex-1 min-w-[180px] flex flex-col justify-between p-4 rounded-2xl ${stat.bg} transition-all hover:bg-opacity-80`}
                >
                    <div className="flex items-start justify-between mb-2">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider line-clamp-2 h-8">
                            {stat.label}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <stat.icon className={`h-5 w-5 ${stat.color}`} />
                        <span className={`text-2xl font-bold ${stat.color}`}>
                            {stat.value}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
}
