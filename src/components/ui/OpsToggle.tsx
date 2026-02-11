import { cn } from "@/lib/utils";
import { useOps } from "@/context/OpsContext";
import { useAuth } from "@/context/AuthContext";

export function OpsToggle() {
    const { ops, setOps } = useOps();
    const { checkPermission } = useAuth();
    const isAdmin = checkPermission('admin_only');

    return (
        <div className={cn(
            "flex items-center bg-muted/60 rounded-full p-0.5 border border-border shadow-sm transition-opacity",
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
    );
}
