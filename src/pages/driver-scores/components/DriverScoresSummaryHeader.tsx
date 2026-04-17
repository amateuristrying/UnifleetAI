import React from "react";
import type { DriverScoreVehicleSummary } from "@/types/driverScoresV2";
import { cn } from "@/lib/utils";

interface Props {
  vehicles: DriverScoreVehicleSummary[];
  isLoading: boolean;
}

export function DriverScoresSummaryHeader({ vehicles, isLoading }: Props) {
  const stats = React.useMemo(() => {
    const total = vehicles.length;
    const counts = {
      Critical: 0,
      Watchlist: 0,
      Stable: 0,
      Inactive: 0,
    };

    vehicles.forEach(v => {
      if (v.ui_bucket in counts) {
        counts[v.ui_bucket as keyof typeof counts]++;
      }
    });

    return { total, ...counts };
  }, [vehicles]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-surface-card rounded-2xl border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <KPICard label="Total Vehicles" value={stats.total} className="border-l-4 border-l-primary" />
      <KPICard label="Critical" value={stats.Critical} color="red" />
      <KPICard label="Watchlist" value={stats.Watchlist} color="yellow" />
      <KPICard label="Stable" value={stats.Stable} color="green" />
      <KPICard label="Inactive" value={stats.Inactive} color="gray" />
    </div>
  );
}

function KPICard({ label, value, color, className }: { label: string, value: number, color?: 'red' | 'yellow' | 'green' | 'gray', className?: string }) {
  const colorClasses = {
    red: "text-red-600 dark:text-red-400 border-l-4 border-l-red-500",
    yellow: "text-amber-600 dark:text-amber-400 border-l-4 border-l-amber-500",
    green: "text-emerald-600 dark:text-emerald-400 border-l-4 border-l-emerald-500",
    gray: "text-slate-500 dark:text-slate-400 border-l-4 border-l-slate-400",
  };

  return (
    <div className={cn(
      "bg-surface-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between transition-all hover:shadow-md",
      color ? colorClasses[color] : className
    )}>
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-70">
        {label}
      </span>
      <span className="text-3xl font-black mt-1">
        {value.toLocaleString()}
      </span>
    </div>
  );
}
