import { WifiOff } from "lucide-react"
import { useOps } from "@/context/OpsContext"
import { useOnlineStatus } from "@/hooks/useVehiclesDB"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext";

export interface DashboardMetrics {
    total: number;
    moving: number;
    idle: number;
    stopped: number;
    offline: number;
    not_online: number;
}

interface StatusPanelProps {
    metrics?: DashboardMetrics;
}

export function StatusPanel({ metrics }: StatusPanelProps) {
    const m = metrics || { total: 0, moving: 0, idle: 0, stopped: 0, offline: 0, not_online: 0 };
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

                    {/* Ops Toggle Switch - Significantly Increased Size */}
                    <div className={cn(
                        "flex items-center bg-muted/60 rounded-full p-1 border border-border shadow-sm origin-right transition-opacity",
                        "scale-110", // Scaled up
                        !isAdmin && "opacity-60 pointer-events-none grayscale"
                    )}>
                        <button
                            onClick={() => isAdmin && setOps('tanzania')}
                            disabled={!isAdmin}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer", // Increased padding and font size
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
                                "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer", // Increased padding and font size
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
                        <Stat label="Vehicles Idle" value={m.idle.toString().padStart(2, '0')} color="text-[#D98E04]" />
                        <Stat label="Vehicles Not Working" value={m.offline.toString().padStart(2, '0')} color="text-[#EF4444]" />
                        <Stat label="Vehicles Immobilized" value="00" />
                    </StatusColumn>

                    <StatusColumn>
                        <Stat label="Vehicles Moving" value={m.moving.toString().padStart(2, '0')} color="text-[#1FB919]" />
                        <Stat label="Vehicles Stopped" value={m.stopped.toString().padStart(2, '0')} color="text-[#3B82F6]" />
                        <Stat label="Vehicles Discharged" value="00" />
                        <Stat label="Vehicles Removed" value="00" />
                    </StatusColumn>

                    <StatusColumn>
                        <Stat label="Not Online" value={m.not_online.toString().padStart(2, '0')} color="text-[#9CA3AF]" />
                        <Stat label="On Job" value="00" />
                        <Stat label="Late" value="00" />
                        {/* 4th slot is empty, controls will float here visually */}
                    </StatusColumn>
                </div>

                {/* Bottom Controls - Absolute Positioned */}

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
    color,
}: {
    label: string
    value: string
    color?: string
}) {
    return (
        <div className="flex justify-between gap-4">
            <span className={`font-semibold w-5 ${color ?? "text-foreground"}`}>{value}</span>
            <span className={`${color ? color : "text-foreground/85"} text-left flex-1`}>{label}</span>
        </div>
    )
}