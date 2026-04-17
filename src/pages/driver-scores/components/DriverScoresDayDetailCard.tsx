import type { VehicleScoreDayDetail } from "@/types/driverScoresV2";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { 
  Navigation, Zap, Clock, Moon, 
  Brain, Route, Activity, AlertTriangle 
} from "lucide-react";

interface Props {
  detail: VehicleScoreDayDetail;
}

export function DriverScoresDayDetailCard({ detail }: Props) {
  const dateStr = format(parseISO(detail.score_date), "MMMM d, yyyy");

  const renderComponent = (label: string, value: number | null, icon: React.ReactNode, sub: string) => {
    const scoreColor = (v: number | null) => {
      if (v === null) return "text-muted-foreground/40";
      if (v < 70) return "text-red-500";
      if (v < 90) return "text-amber-500";
      return "text-emerald-500";
    };

    return (
      <div className="bg-muted/5 p-4 rounded-xl border border-border/50 flex items-center gap-4 transition-all hover:bg-muted/10 group">
        <div className="bg-surface-card p-2.5 rounded-lg border border-border group-hover:border-primary/20 transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">{label}</div>
          <div className="text-xs font-bold text-foreground truncate mt-0.5">{sub}</div>
        </div>
        <div className="flex flex-col items-end">
          <span className={cn("text-lg font-black tabular-nums tracking-tighter", scoreColor(value))}>
            {value !== null ? Math.round(value) : "—"}
          </span>
          <span className="text-[8px] text-muted-foreground/40 uppercase font-black tracking-tighter">pts</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-500">
      {/* Premium Header */}
      <div className="p-6 pb-2 border-b border-border/50 bg-muted/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex flex-col">
            <h4 className="text-xl font-black tracking-tight text-foreground">{dateStr}</h4>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] shadow-sm",
                detail.status === 'red' ? "bg-red-500 text-white" :
                detail.status === 'yellow' ? "bg-amber-500 text-white" :
                detail.status === 'green' ? "bg-emerald-500 text-white" :
                "bg-muted text-muted-foreground"
              )}>
                {detail.risk_bucket || detail.status}
              </span>
              <span className="text-[10px] text-muted-foreground font-bold flex items-center gap-1.5 opacity-60">
                <Navigation className="w-3 h-3" />
                {detail.total_trips} Trips
                <span className="opacity-30">•</span>
                {detail.total_distance_km.toFixed(1)} km
              </span>
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className={cn(
               "w-16 h-16 rounded-2xl flex flex-col items-center justify-center border-2 shadow-sm transition-all rotate-3",
               detail.status === 'red' ? "bg-red-500/10 border-red-500 text-red-500" :
               detail.status === 'yellow' ? "bg-amber-500/10 border-amber-500 text-amber-500" :
               detail.status === 'green' ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" :
               "bg-muted/10 border-border text-muted-foreground"
            )}>
              <span className="text-[9px] font-black uppercase tracking-tighter opacity-70">Day</span>
              <span className="text-2xl font-black leading-none">{detail.score !== null ? Math.round(detail.score) : "—"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 pt-6 flex-1 overflow-y-auto space-y-6">
        {/* Issues Warning */}
        {detail.top_issues && detail.top_issues.length > 0 && (
          <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-12 h-12 text-red-500" />
            </div>
            <div className="relative z-10">
              <div className="text-[9px] font-black uppercase tracking-[0.2em] text-red-500 mb-2">Priority Alerts</div>
              <div className="flex flex-wrap gap-2">
                {detail.top_issues.map((issue, idx) => (
                  <span key={idx} className="bg-red-500/10 text-red-600 text-[10px] px-2.5 py-1 rounded-lg font-black border border-red-500/10 shadow-sm">
                    {issue}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Components Grid */}
        <div className="grid grid-cols-1 gap-3">
          {renderComponent(
            "Speeding Behavior", 
            detail.speed_score, 
            <Zap className="w-4 h-4 text-amber-500" />, 
            `${detail.speeding_count} events • ${detail.max_speed_recorded} km/h max`
          )}
          {renderComponent(
            "Idling / Efficiency", 
            detail.idle_score, 
            <Clock className="w-4 h-4 text-blue-500" />, 
            `${detail.idle_minutes} min idle • ${detail.idle_percent.toFixed(1)}%`
          )}
          {renderComponent(
            "Night Operations", 
            detail.night_score, 
            <Moon className="w-4 h-4 text-indigo-500" />, 
            `${detail.night_trips} night trips • ${detail.night_driving_km.toFixed(1)} km`
          )}
          {renderComponent(
            "Driver Wellbeing", 
            detail.fatigue_score, 
            <Brain className="w-4 h-4 text-rose-500" />, 
            `Fatigue: ${detail.fatigue_level}`
          )}
          {renderComponent(
            "Route Compliance", 
            detail.route_score, 
            <Route className="w-4 h-4 text-emerald-500" />, 
            detail.route_score !== null ? `Path tracking: ${Math.round(detail.route_score)}%` : "No active route baseline"
          )}
        </div>

        {/* Engine Utility Card */}
        <div className="pt-4 border-t border-border/50">
          <div className="bg-muted/5 p-4 rounded-xl border border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-4 h-4 text-muted-foreground/40" />
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Engine Utilization</div>
                <div className="text-xs font-bold text-foreground">
                  {Math.round(detail.total_driving_seconds / 60)}m Drive / {Math.round(detail.total_engine_seconds / 60)}m Engine On
                </div>
              </div>
            </div>
            <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
               <div 
                 className="h-full bg-primary" 
                 style={{ width: `${Math.min(100, (detail.total_driving_seconds / (detail.total_engine_seconds || 1)) * 100)}%` }} 
               />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
