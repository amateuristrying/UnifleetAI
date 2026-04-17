import { WifiOff } from "lucide-react"
import { useOps } from "@/context/OpsContext"
import { useOnlineStatus } from "@/hooks/useVehiclesDB"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext";

export interface DashboardMetrics {
    total: number;
    moving: number;
    idle_stopped: number;
    idle_parked: number;
    stopped: number;
    parked: number;
    offline: number;
    movingPct: number;
}

interface StatusPanelProps {
    metrics?: DashboardMetrics;
}

export function StatusPanel({ metrics }: StatusPanelProps) {
    const m = metrics || { total: 0, moving: 0, idle_stopped: 0, idle_parked: 0, stopped: 0, parked: 0, offline: 0, movingPct: 0 };
    const { ops, setOps } = useOps();
    const isOnline = useOnlineStatus();
    const { checkPermission } = useAuth();
    const isAdmin = checkPermission('admin_only');

    return (
        <section className="sticky top-[10px] z-30 bg-surface-main px-6 pb-2 -mt-5">
            <div className="
                relative
                flex flex-col 
                w-full
                bg-surface-card 
                rounded-[20px] 
                px-5 py-3
                shadow-sm
                border border-border
                font-['Lexend'] font-light text-[13px] leading-snug
            ">
                {/* Top Row: Header + Ops Toggle */}
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-foreground/80">
                            Run Time Status
                        </h1>
                        {!isOnline && (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-[10px] font-medium border border-orange-200 dark:border-orange-800">
                                <WifiOff className="h-3 w-3" />
                                Offline
                            </span>
                        )}
                    </div>

                    {/* Ops Toggle Switch */}
                    <div className={cn(
                        "flex items-center bg-muted/60 rounded-full p-1 border border-border shadow-sm origin-right transition-all",
                        "scale-110",
                        !isAdmin && "opacity-60 pointer-events-none grayscale"
                    )}>
                        <button
                            onClick={() => isAdmin && setOps('tanzania')}
                            disabled={!isAdmin}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer",
                                !isAdmin && "cursor-not-allowed",
                                ops === 'tanzania'
                                    ? "bg-blue-500 text-white shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            TZ Ops
                        </button>
                        <button
                            onClick={() => isAdmin && setOps('zambia')}
                            disabled={!isAdmin}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer",
                                !isAdmin && "cursor-not-allowed",
                                ops === 'zambia'
                                    ? "bg-blue-500 text-white shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            ZM Ops
                        </button>
                    </div>
                </div>

                {/* Middle Row: Metrics Grid */}
                <div className="grid grid-cols-3 gap-8">
                    <StatusColumn>
                        <Stat label="Total vehicles" value={m.total.toString().padStart(2, '0')} />
                        <Stat label="Moving" value={m.moving.toString().padStart(2, '0')} color="text-[#1FB919]" />
                        <Stat label="Stopped" value={m.stopped.toString().padStart(2, '0')} color="text-[#3B82F6]" />
                    </StatusColumn>

                    <StatusColumn>
                        <Stat label="Parked" value={m.parked.toString().padStart(2, '0')} color="text-[#9CA3AF]" />
                        <Stat label="Idle-Stopped" value={m.idle_stopped.toString().padStart(2, '0')} color="text-[#D98E04]" />
                        <Stat label="Idle-Parked" value={m.idle_parked.toString().padStart(2, '0')} color="text-[#D98E04]" />
                    </StatusColumn>

                    <StatusColumn>
                        <Stat label="Offline" value={m.offline.toString().padStart(2, '0')} color="text-[#EF4444]" />
                        <Stat 
                            label="Fleet Pulse" 
                            value={`${m.movingPct.toString().padStart(2, '0')}`} 
                            unit="%" 
                            color={m.movingPct < 30 ? "text-red-500" : m.movingPct <= 60 ? "text-yellow-500" : "text-green-500"} 
                        />
                    </StatusColumn>
                </div>

            </div>
        </section>
    )
}

function StatusColumn({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-col gap-1">{children}</div>
}

function Stat({
    label,
    value,
    unit,
    color,
}: {
    label: string
    value: string
    unit?: string
    color?: string
}) {
    return (
        <div className="flex items-center gap-3">
            <div className={cn("w-[70px] font-bold shrink-0", color ?? "text-foreground")}>
                {value}
                {unit && <span className="text-[10px] ml-0.5 font-normal uppercase opacity-70">{unit}</span>}
            </div>
            <span className={cn("text-left whitespace-nowrap", color ? color : "text-foreground/80")}>
                {label}
            </span>
        </div>
    )
}