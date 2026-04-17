import type { VehicleScoreCalendarDay } from "@/types/driverScoresV2";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface Props {
  days: VehicleScoreCalendarDay[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export function DriverScoresCalendar30Day({ days, selectedDate, onSelectDate }: Props) {
  return (
    <div className="grid grid-cols-10 gap-2 p-3 bg-muted/10 rounded-xl border border-border/50">
      {days.map((day) => {
        const isSelected = selectedDate === day.score_date;
        const dateObj = parseISO(day.score_date);
        const dayNum = format(dateObj, "d");
        const isWeekend = [0, 6].includes(dateObj.getDay());
        
        return (
          <button
            key={day.score_date}
            onClick={() => onSelectDate(day.score_date)}
            disabled={!day.is_active_day}
            className="flex flex-col items-center gap-1 group relative"
          >
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 text-[10px] font-bold shadow-sm",
                // Base colors based on status or activity
                !day.is_active_day ? "bg-muted/40 text-muted-foreground/30 border border-transparent" :
                day.status === 'green'  ? "bg-emerald-500 text-white border border-emerald-500/50" :
                day.status === 'yellow' ? "bg-amber-500 text-white border border-amber-500/50" :
                day.status === 'red'    ? "bg-red-500 text-white border border-red-500/50" :
                "bg-muted text-muted-foreground border border-border",
                
                // Hover effect: Outline only
                day.is_active_day && "hover:ring-2 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-background",
                
                // Selection state: Strong outline
                isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110 z-10"
              )}
            >
              {dayNum}
            </div>
            
            {/* Simple static day indicator if needed, but let's keep it minimal */}
            <span className={cn(
              "text-[8px] font-bold opacity-30 uppercase transition-opacity",
              isSelected ? "opacity-100 text-primary" : "group-hover:opacity-60",
              isWeekend && "text-red-500/50"
            )}>
              {format(dateObj, "EEE")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
