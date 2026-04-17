import type { DriverScoreVehicleSummary } from "@/types/driverScoresV2";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, MapPin, Hash } from "lucide-react";
import { DriverScoresVehicleExpandedPanel } from "./DriverScoresVehicleExpandedPanel";

interface Props {
  vehicle: DriverScoreVehicleSummary;
  isExpanded: boolean;
  onToggle: () => void;
}

export function DriverScoresVehicleRow({ vehicle, isExpanded, onToggle }: Props) {
  return (
    <div className={cn(
      "group transition-all duration-300 mb-4 bg-surface-card rounded-2xl border border-border shadow-sm hover:shadow-md hover:border-primary/20",
      isExpanded && "ring-2 ring-primary/10 border-primary/20 bg-muted/10 shadow-lg"
    )}>
      {/* Clickable Header Row */}
      <div 
        onClick={onToggle}
        className="flex items-center px-6 py-4 cursor-pointer select-none"
      >
        {/* Tracker Info */}
        <div className="flex-[3] flex flex-col min-w-0">
          <span className="font-bold text-lg leading-tight truncate">{vehicle.tracker_name}</span>
          <div className="flex items-center gap-3 mt-1 text-muted-foreground">
            <span className="flex items-center gap-1 text-xs">
              <Hash className="w-3 h-3" />
              {vehicle.tracker_id}
            </span>
            <span className="flex items-center gap-1 text-xs">
              <MapPin className="w-3 h-3" />
              {vehicle.ops_region}
            </span>
          </div>
        </div>

        {/* Scores Grid */}
        <div className="flex-[4] grid grid-cols-3 gap-8">
          <ScoreMetric label="Latest" value={vehicle.latest_score} trend={vehicle.score_trend} status={vehicle.latest_status} />
          <ScoreMetric label="Avg 7d" value={vehicle.avg_score_7d} />
          <ScoreMetric label="Avg 30d" value={vehicle.avg_score_30d} />
        </div>

        {/* Top Issues */}
        <div className="flex-[3] flex flex-col gap-1.5 px-4 min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground opacity-60">Recent Issues</span>
          <div className="flex flex-wrap gap-1">
            {vehicle.latest_top_issues && vehicle.latest_top_issues.length > 0 ? (
              vehicle.latest_top_issues.slice(0, 2).map((issue, idx) => (
                <span key={idx} className="bg-muted px-2 py-0.5 rounded text-[10px] font-medium truncate max-w-[120px]">
                  {issue}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground italic">No issues detected</span>
            )}
            {vehicle.latest_top_issues && vehicle.latest_top_issues.length > 2 && (
              <span className="text-[10px] font-bold text-muted-foreground">+{vehicle.latest_top_issues.length - 2}</span>
            )}
          </div>
        </div>

        {/* Expand Toggle */}
        <div className="flex items-center justify-end w-10">
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="px-6 pb-6 pt-2">
          <DriverScoresVehicleExpandedPanel vehicle={vehicle} />
        </div>
      )}
    </div>
  );
}

function ScoreMetric({ label, value, trend, status }: { label: string, value: number | null, trend?: 'up' | 'down' | 'stable' | null, status?: string }) {
  const getStatusColor = (val: number | null, s?: string) => {
    if (s === 'red') return "text-red-600 dark:text-red-400";
    if (s === 'yellow') return "text-amber-600 dark:text-amber-400";
    if (s === 'green') return "text-emerald-600 dark:text-emerald-400";
    if (val === null) return "text-muted-foreground";
    if (val < 70) return "text-red-600 dark:text-red-400";
    if (val < 90) return "text-amber-600 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
  };

  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground opacity-60">{label}</span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className={cn("text-lg font-black tabular-nums", getStatusColor(value, status))}>
          {value !== null ? Math.round(value) : "—"}
        </span>
        {trend && (
          <span className="text-muted-foreground">
            {trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
            {trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
            {trend === 'stable' && <Minus className="w-3.5 h-3.5 text-muted-foreground opacity-30" />}
          </span>
        )}
      </div>
    </div>
  );
}
