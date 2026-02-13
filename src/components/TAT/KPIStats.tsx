import { ArrowUpRight, Clock, Truck, CheckCircle, AlertCircle } from "lucide-react";

interface TATStats {
    avg_waiting_hrs: number;
    avg_loading_hrs: number;
    avg_border_hrs: number;
    avg_offloading_hrs: number;
    trips_departed: number;
    trips_completed: number;
    trip_completion_rate: number;
}

interface KPIStatsProps {
    stats: TATStats | null;
    loading: boolean;
    onOpenModal: () => void;
}

export function KPIStats({ stats, loading, onOpenModal }: KPIStatsProps) {
    if (loading || !stats) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-24 bg-surface-card rounded-lg" />
                ))}
            </div>
        );
    }

    const cards = [
        {
            label: "Avg Waiting (Kurasini)",
            value: `${stats.avg_waiting_hrs.toFixed(1)} hrs`,
            icon: Clock,
            color: "text-orange-500",
        },
        {
            label: "Avg Loading Time",
            value: `${stats.avg_loading_hrs.toFixed(1)} hrs`,
            icon: Truck,
            color: "text-blue-500",
        },
        {
            label: "Avg Border Delay",
            value: `${stats.avg_border_hrs.toFixed(1)} hrs`,
            icon: AlertCircle,
            color: "text-red-500",
        },
        {
            label: "Avg Offloading Time",
            value: `${stats.avg_offloading_hrs.toFixed(1)} hrs`,
            icon: ArrowUpRight,
            color: "text-purple-500",
        },
        {
            label: "Trips Departed",
            value: stats.trips_departed.toString(),
            icon: Truck,
            color: "text-gray-400",
        },
        {
            label: "Trips Completed",
            value: stats.trips_completed.toString(),
            icon: CheckCircle,
            color: "text-green-500",
            onClick: onOpenModal,
            isAction: true
        },
        {
            label: "Completion Rate",
            value: `${stats.trip_completion_rate.toFixed(1)}%`,
            icon: CheckCircle,
            color: stats.trip_completion_rate > 90 ? "text-green-500" : "text-yellow-500",
        },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card, idx) => (
                <div
                    key={idx}
                    onClick={card.onClick}
                    className={`bg-surface-card p-4 rounded-lg border border-border flex items-center justify-between shadow-sm ${card.isAction ? "cursor-pointer hover:border-primary/50 transition-colors" : ""
                        }`}
                >
                    <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{card.label}</p>
                        <p className="text-2xl font-bold mt-1 text-white">{card.value}</p>
                    </div>
                    <div className={`p-2 rounded-full bg-surface-raised ${card.color.replace('text-', 'bg-')}/10`}>
                        <card.icon className={`w-5 h-5 ${card.color}`} />
                    </div>
                </div>
            ))}
        </div>
    );
}
