import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Menu, Home as HomeIcon, ShieldCheck, LocateFixed, TrendingUp, Timer, Activity, Truck, Trophy, Gauge } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export function Sidebar() {
    const location = useLocation();
    const navigate = useNavigate();
    const [isExpanded, setIsExpanded] = useState(false);
    const sidebarRef = useRef<HTMLElement>(null);

    const toggleSidebar = () => setIsExpanded(!isExpanded);

    // Auto-minimize on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node) && isExpanded) {
                setIsExpanded(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isExpanded]);

    // Format handleNavigation helper
    const handleNavigation = (path: string) => {
        navigate(path);
        if (isExpanded) setIsExpanded(false);
    };

    // Helper to check if a path is active
    const isActive = (path: string) => {
        if (path === '/') {
            return location.pathname === '/' || location.pathname === '';
        }
        return location.pathname.startsWith(path);
    };

    return (
        <aside
            ref={sidebarRef}
            className={cn(
                "flex flex-col bg-surface-card ml-3 my-3 rounded-[35px] shadow-md z-50 transition-all duration-300 ease-in-out overflow-hidden border border-border",
                isExpanded ? "w-[240px] items-start px-4" : "w-[60px] items-center px-2"
            )}
            style={{ height: "calc(100vh - 24px)" }}
        >
            {/* Hamburger / Menu Toggle */}
            <div className={cn("pt-6 pb-4 w-full flex", isExpanded ? "justify-start" : "justify-center")}>
                <Button
                    size="icon"
                    onClick={toggleSidebar}
                    className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-700 shadow-md transition-transform active:scale-95"
                >
                    <Menu className="h-5 w-5 text-white" />
                </Button>
            </div>

            {/* Navigation Links */}
            <nav className="flex flex-col gap-2 w-full mt-4">

                <SidebarItem
                    icon={<HomeIcon className="h-5 w-5" />}
                    label="Runtime Status"
                    isExpanded={isExpanded}
                    isActive={isActive('/')}
                    onClick={() => handleNavigation('/')}
                />

                <SidebarItem
                    icon={<ShieldCheck className="h-5 w-5" />}
                    label="Live Geofence Monitoring"
                    isExpanded={isExpanded}
                    isActive={isActive('/live-geofences')}
                    onClick={() => handleNavigation('/live-geofences')}
                />

                <SidebarItem
                    icon={<Gauge className="h-5 w-5" />}
                    label="Live Speed Violations Monitoring"
                    isExpanded={isExpanded}
                    isActive={isActive('/live-speed')}
                    onClick={() => handleNavigation('/live-speed')}
                    marquee
                />

                <SidebarItem
                    icon={<LocateFixed className="h-5 w-5" />}
                    label="Live Fleet Monitoring"
                    isExpanded={isExpanded}
                    isActive={isActive('/live-fleet')}
                    onClick={() => handleNavigation('/live-fleet')}
                />

                <SidebarItem
                    icon={<TrendingUp className="h-5 w-5" />}
                    label="Corridor Analytics"
                    isExpanded={isExpanded}
                    isActive={isActive('/corridor-analytics')}
                    onClick={() => handleNavigation('/corridor-analytics')}
                />

                <SidebarItem
                    icon={<Timer className="h-5 w-5" />}
                    label="Turnaround Time"
                    isExpanded={isExpanded}
                    isActive={isActive('/turnaround-time')}
                    onClick={() => handleNavigation('/turnaround-time')}
                />

                <SidebarItem
                    icon={<Activity className="h-5 w-5" />}
                    label="Fleet Pulse"
                    isExpanded={isExpanded}
                    isActive={isActive('/fleet-pulse')}
                    onClick={() => handleNavigation('/fleet-pulse')}
                />

                <SidebarItem
                    icon={<Truck className="h-5 w-5" />}
                    label="Vehicles"
                    isExpanded={isExpanded}
                    isActive={isActive('/vehicle') && !isActive('/vehicle/driver-score')} // Exclude driver score as it has its own icon
                    onClick={() => handleNavigation('/vehicle')}
                />

                <SidebarItem
                    icon={<Trophy className="h-5 w-5" />}
                    label="Driver Scoreboard"
                    isExpanded={isExpanded}
                    isActive={isActive('/vehicle/driver-score')}
                    onClick={() => handleNavigation('/vehicle/driver-score')}
                />

            </nav>
        </aside>
    );
}

// Sub-component for individual items
interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    isExpanded: boolean;
    isActive?: boolean;
    onClick: () => void;
    marquee?: boolean;
}

function SidebarItem({ icon, label, isExpanded, isActive, onClick, marquee }: SidebarItemProps) {
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            className={cn(
                "h-11 rounded-xl transition-all duration-200 group relative overflow-hidden",
                isExpanded ? "w-full justify-start px-3" : "w-11 justify-center px-0",
                isActive
                    ? "bg-primary/10 text-primary hover:bg-primary/15 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
        >
            <div className={cn("flex items-center justify-center transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}>
                {icon}
            </div>

            {/* Label */}
            <div className={cn(
                "ml-3 overflow-hidden",
                isExpanded ? "opacity-100 block w-full" : "opacity-0 hidden w-0"
            )}>
                <span className={cn(
                    "whitespace-nowrap block",
                    marquee && isExpanded && "group-hover:animate-marquee"
                )}>
                    {label}
                </span>
            </div>

            {/* Active Indicator Bar */}
            {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-primary" />
            )}
        </Button>
    );
}
