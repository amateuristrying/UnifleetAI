import { useState, useEffect } from "react";
import type { 
  DriverScoreVehicleSummary, 
  VehicleScoreCalendarDay, 
  VehicleScoreDayDetail 
} from "@/types/driverScoresV2";
import { driverScoresService } from "@/services/driverScoresV2";
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Minus, Clock, Zap, Moon, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { DriverScoresCalendar30Day } from "./DriverScoresCalendar30Day";
import { DriverScoresDayDetailCard } from "./DriverScoresDayDetailCard";

interface Props {
  vehicle: DriverScoreVehicleSummary;
}

export function DriverScoresVehicleExpandedPanel({ vehicle }: Props) {
  const [calendarData, setCalendarData] = useState<VehicleScoreCalendarDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<VehicleScoreDayDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  useEffect(() => {
    async function fetchCalendar() {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await driverScoresService.getVehicleCalendar(vehicle.tracker_id, 30);
        if (fetchError) throw fetchError;
        
        const sortedData = (data || []).sort((a, b) => new Date(b.score_date).getTime() - new Date(a.score_date).getTime());
        setCalendarData(sortedData);
        
        // Auto-select the latest active day
        if (sortedData.length > 0) {
          const latestActive = sortedData.find(d => d.is_active_day) || sortedData[0];
          setSelectedDate(latestActive.score_date);
        }
      } catch (err: any) {
        console.error("Error fetching vehicle calendar:", err);
        setError("Failed to load calendar data. Please try refreshing.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchCalendar();
  }, [vehicle.tracker_id]);

  useEffect(() => {
    if (!selectedDate) return;

    async function fetchDayDetail() {
      setIsDetailLoading(true);
      try {
        const { data, error: fetchError } = await driverScoresService.getDayDetail(vehicle.tracker_id, selectedDate!);
        if (fetchError) throw fetchError;
        setDayDetail(data);
      } catch (err) {
        console.error("Error fetching day detail:", err);
        setDayDetail(null);
      } finally {
        setIsDetailLoading(false);
      }
    }

    fetchDayDetail();
  }, [vehicle.tracker_id, selectedDate]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-muted/5 rounded-2xl border border-dashed border-border/50">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground font-medium">Analyzing rolling performance...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 p-6 bg-red-500/5 text-red-500 border border-red-500/10 rounded-2xl">
        <AlertCircle className="w-8 h-8 mb-3" />
        <span className="text-sm font-semibold max-w-sm text-center">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-500">
      {/* 1. Header Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MetricBox label="Latest Score" value={vehicle.latest_score} sub={vehicle.latest_score_date} color={vehicle.latest_status} />
        <MetricBox label="30d Avg" value={vehicle.avg_score_30d} trend={vehicle.score_trend} />
        <MetricBox label="7d Violations" value={vehicle.total_violations_7d} icon={<Zap className="w-3.5 h-3.5" />} />
        <MetricBox label="30d Idle Avg" value={vehicle.avg_idle_pct_30d !== null ? `${Math.round(vehicle.avg_idle_pct_30d)}%` : null} icon={<Clock className="w-3.5 h-3.5" />} />
        <MetricBox label="30d Night" value={vehicle.total_night_trips_30d} sub="Trips" icon={<Moon className="w-3.5 h-3.5" />} />
        <MetricBox label="30d Distance" value={vehicle.total_distance_30d !== null ? `${Math.round(vehicle.total_distance_30d)} km` : null} icon={<Activity className="w-3.5 h-3.5" />} />
        <SectionBadge days={vehicle.critical_days_30d} label="Critical Days" color="bg-red-500" />
      </div>

      {/* 2. Calendar and Detail Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: 30-Day Calendar */}
        <div className="xl:col-span-5 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">30-Day Activity</h3>
            <div className="flex gap-4">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 font-bold uppercase"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Stable</span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 font-bold uppercase"><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Risk</span>
            </div>
          </div>
          <DriverScoresCalendar30Day 
            days={calendarData} 
            selectedDate={selectedDate} 
            onSelectDate={setSelectedDate} 
          />
        </div>

        {/* Right: Selected Day Details */}
        <div className="xl:col-span-7 bg-surface-card rounded-2xl border border-border/50 shadow-sm overflow-hidden min-h-[460px] flex flex-col">
          {isDetailLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin mb-3" />
              <p className="text-xs text-muted-foreground font-medium">Loading details for {selectedDate}...</p>
            </div>
          ) : dayDetail ? (
            <DriverScoresDayDetailCard detail={dayDetail} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                <Activity className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <h4 className="text-sm font-bold text-foreground mb-1">No Activity Data</h4>
              <p className="text-xs text-muted-foreground max-w-[240px]">This day was marked as inactive or has no recorded movement to analyze.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, sub, trend, icon, color }: { label: string, value: any, sub?: string, trend?: string | null, icon?: React.ReactNode, color?: string }) {
  const getStatusColor = () => {
    if (color === 'red') return "text-red-500";
    if (color === 'yellow') return "text-amber-500";
    if (color === 'green') return "text-emerald-500";
    return "text-foreground";
  };

  return (
    <div className="bg-surface-card p-4 rounded-xl border border-border shadow-sm flex flex-col justify-between transition-all hover:border-primary/20">
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground opacity-60">
        {icon}
        {label}
      </div>
      <div className="flex flex-col mt-2">
        <div className="flex items-center gap-2">
          <span className={cn("text-lg font-black tabular-nums tracking-tight", getStatusColor())}>
            {value !== null && value !== undefined ? (typeof value === 'number' ? Math.round(value) : value) : "—"}
          </span>
          {trend && (
            <span className="flex items-center">
              {trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
              {trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
              {trend === 'stable' && <Minus className="w-3.5 h-3.5 text-muted-foreground/30" />}
            </span>
          )}
        </div>
        {sub && <span className="text-[10px] text-muted-foreground font-medium mt-0.5 opacity-70 tracking-tight">{sub}</span>}
      </div>
    </div>
  );
}

function SectionBadge({ days, label, color }: { days: number, label: string, color: string }) {
  return (
    <div className="bg-surface-card p-4 rounded-xl border border-border shadow-sm flex flex-col justify-between overflow-hidden relative transition-all hover:border-primary/20">
      <div className="flex flex-col z-10">
        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground opacity-60">
          {label}
        </span>
        <span className="text-xl font-black mt-1 text-foreground tracking-tight">
          {days}
        </span>
      </div>
      <div className={cn("absolute right-0 bottom-0 top-0 w-1 opacity-40", color)} />
    </div>
  );
}
