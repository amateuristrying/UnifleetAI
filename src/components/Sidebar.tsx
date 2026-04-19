import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { 
    Menu, Home as HomeIcon, ShieldCheck, LocateFixed, Activity, LineChart, Gauge, Clock, 
    AlertCircle, ChevronDown, Package, DoorOpen, MapPin, Cpu, FlaskConical, Sun, Moon 
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MarqueeText } from "./ui/MarqueeText";
import { useTheme } from "@/context/ThemeProvider";

export function Sidebar({ isLocked = false }: { isLocked?: boolean }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { resolved, setTheme } = useTheme();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isTatOpen, setIsTatOpen] = useState(false);
    const [lockMessage, setLockMessage] = useState<{ text: string, x: number, y: number } | null>(null);
    const sidebarRef = useRef<HTMLElement>(null);

    const toggleSidebar = () => setIsExpanded(!isExpanded);

    const toggleTheme = () => {
        setTheme(resolved === 'dark' ? 'light' : 'dark');
    };

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
    const handleNavigation = (path: string, label: string, e: React.MouseEvent) => {
        if (isLocked) {
            const rect = e.currentTarget.getBoundingClientRect();
            setLockMessage({
                text: `User must log in first to see ${label}`,
                x: rect.right + 10,
                y: rect.top + rect.height / 2
            });
            return;
        }
        navigate(path);
        if (isExpanded) setIsExpanded(false);
    };

    // Collapse TAT dropdown on navigation outside the category
    useEffect(() => {
        if (!location.pathname.startsWith('/turnaround-time')) {
            setIsTatOpen(false);
        }
    }, [location.pathname]);

    // Ensure dropdown is closed if sidebar becomes locked
    useEffect(() => {
        if (isLocked) {
            setIsTatOpen(false);
        }
    }, [isLocked]);

    useEffect(() => {
        if (lockMessage) {
            const timer = setTimeout(() => setLockMessage(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [lockMessage]);

    // Helper to check if a path is active
    const isActive = (path: string) => {
        if (path === '/') {
            return location.pathname === '/' || location.pathname === '';
        }
        return location.pathname.startsWith(path);
    };

    const tatSubItems = [
        { title: 'Loading Zones', icon: <Package className="h-4 w-4" />, path: '/turnaround-time/loading-zones' },
        { title: 'Border Management', icon: <DoorOpen className="h-4 w-4" />, path: '/turnaround-time/border' },
        { title: 'Destinations Intelligence', icon: <MapPin className="h-4 w-4" />, path: '/turnaround-time/destinations' },
        { title: 'Vehicle Intelligence', icon: <Cpu className="h-4 w-4" />, path: '/turnaround-time/vehicle' },
        { title: 'Coverage Lab', icon: <FlaskConical className="h-4 w-4" />, path: '/turnaround-time/coverage' }
    ];

    return (
        <aside
            ref={sidebarRef}
            className={cn(
                "flex flex-col bg-surface-card ml-3 my-3 rounded-[35px] shadow-md z-50 transition-all duration-300 ease-in-out overflow-y-auto overflow-x-hidden border border-border relative custom-scrollbar",
                isExpanded ? "w-[240px] items-start px-4" : "w-[60px] items-center px-2"
            )}
            style={{ height: "calc(100vh - 24px)" }}
        >
            {/* Lock Message Popup */}
            {lockMessage && (
                <div 
                    className="fixed z-[100] bg-surface-card border border-border shadow-xl rounded-xl px-4 py-2 text-xs font-semibold animate-in fade-in zoom-in slide-in-from-left-2 duration-300 flex items-center gap-2"
                    style={{ left: lockMessage.x, top: lockMessage.y, transform: 'translateY(-50%)' }}
                >
                    <AlertCircle className="h-3.5 w-3.5 text-blue-500" />
                    <span>{lockMessage.text}</span>
                    <div className="absolute left-[-5px] top-1/2 -translate-y-1/2 w-2 h-2 bg-surface-card border-l border-b border-border rotate-45" />
                </div>
            )}

            {/* Hamburger / Menu Toggle */}
            <div className={cn("pt-6 pb-4 w-full flex shrink-0", isExpanded ? "justify-start" : "justify-center")}>
                <Button
                    size="icon"
                    onClick={toggleSidebar}
                    className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-700 shadow-md transition-transform active:scale-95"
                >
                    <Menu className="h-5 w-5 text-white" />
                </Button>
            </div>

            {/* Navigation Links */}
            <nav className="flex flex-col gap-2 w-full mt-4 pb-8">

                <SidebarItem
                    icon={<HomeIcon className="h-5 w-5" />}
                    label="Runtime Status"
                    isExpanded={isExpanded}
                    isActive={isActive('/')}
                    onClick={(e) => handleNavigation('/', 'Runtime Status', e)}
                    isLocked={isLocked}
                />

                {/* TAT with Dropdown Group */}
                <div className={cn(
                    "flex flex-col w-full transition-all duration-300 rounded-[20px] items-center",
                    isTatOpen && (isExpanded ? "bg-muted/30 p-1 border border-border/50 items-start" : "bg-primary/5 py-1 border border-primary/20 shadow-sm")
                )}>
                    <SidebarItem
                        icon={<Clock className="h-5 w-5" />}
                        label="Turnaround time"
                        isExpanded={isExpanded}
                        isActive={isActive('/turnaround-time')}
                        onClick={(e) => {
                            if (isLocked) {
                                handleNavigation('', 'Turnaround time', e);
                                return;
                            }
                            setIsTatOpen(!isTatOpen);
                        }}
                        isLocked={isLocked}
                        showArrow={isExpanded}
                        isOpen={isTatOpen}
                    />
                    
                    {isTatOpen && (
                        <div className={cn(
                            "flex flex-col gap-1 w-full animate-in fade-in slide-in-from-top-2 duration-300",
                            isExpanded ? "pl-0 pr-2 mb-2 mt-1" : "items-center py-1.5"
                        )}>
                            {tatSubItems.map((sub) => (
                                <button
                                    key={sub.title}
                                    onClick={(e) => handleNavigation(sub.path, sub.title, e)}
                                    className={cn(
                                        "flex items-center rounded-xl transition-all duration-200 group/sub",
                                        isExpanded 
                                            ? "w-full py-1.5 px-3 hover:bg-muted text-left" 
                                            : "w-10 h-10 justify-center hover:bg-primary/10"
                                    )}
                                    title={sub.title}
                                >
                                    <div className={cn(
                                        "flex items-center justify-center transition-colors",
                                        isExpanded ? "text-muted-foreground mr-3 group-hover/sub:text-primary" : "text-muted-foreground group-hover/sub:text-primary"
                                    )}>
                                        {sub.icon}
                                    </div>
                                    {isExpanded && (
                                        <span className="text-[11px] font-bold text-muted-foreground group-hover/sub:text-primary whitespace-nowrap overflow-hidden text-ellipsis">
                                            {sub.title}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <SidebarItem
                    icon={<ShieldCheck className="h-5 w-5" />}
                    label="Live Geofences"
                    isExpanded={isExpanded}
                    isActive={isActive('/live-geofences')}
                    onClick={(e) => handleNavigation('/live-geofences', 'Live Geofences', e)}
                    isLocked={isLocked}
                />

                <SidebarItem
                    icon={<Gauge className="h-5 w-5" />}
                    label="Live Violations"
                    isExpanded={isExpanded}
                    isActive={isActive('/live-speed')}
                    onClick={(e) => handleNavigation('/live-speed', 'Live Violations', e)}
                    isLocked={isLocked}
                />

                <SidebarItem
                    icon={<LocateFixed className="h-5 w-5" />}
                    label="Live Fleet"
                    isExpanded={isExpanded}
                    isActive={isActive('/live-fleet')}
                    onClick={(e) => handleNavigation('/live-fleet', 'Live Fleet', e)}
                    isLocked={isLocked}
                />

                <SidebarItem
                    icon={<LineChart className="h-5 w-5" />}
                    label="Analytics"
                    isExpanded={isExpanded}
                    isActive={isActive('/analytics')}
                    onClick={(e) => handleNavigation('/analytics', 'Analytics', e)}
                    isLocked={isLocked}
                />

                <SidebarItem
                    icon={<Activity className="h-5 w-5" />}
                    label="Fleet Pulse"
                    isExpanded={isExpanded}
                    isActive={isActive('/fleet-pulse')}
                    onClick={(e) => handleNavigation('/fleet-pulse', 'Fleet Pulse', e)}
                    isLocked={isLocked}
                />

            </nav>

            {/* Bottom: Theme Toggle */}
            <div className={cn("mt-auto pb-6 w-full flex shrink-0", isExpanded ? "justify-start px-2" : "justify-center")}>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "h-10 w-10 rounded-full hover:bg-muted text-muted-foreground transition-all duration-200 group/theme",
                        isExpanded && "w-full justify-start px-3 gap-3"
                    )}
                    onClick={toggleTheme}
                    title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                    <div className="flex items-center justify-center transition-colors group-hover/theme:text-foreground">
                        {resolved === 'dark'
                            ? <Sun className="h-5 w-5" strokeWidth={1.5} />
                            : <Moon className="h-5 w-5" strokeWidth={1.5} />
                        }
                    </div>
                    {isExpanded && (
                        <span className="text-sm font-medium whitespace-nowrap overflow-hidden animate-in fade-in duration-300">
                            {resolved === 'dark' ? 'Day Mode' : 'Night Mode'}
                        </span>
                    )}
                </Button>
            </div>
        </aside>
    );
}

// Sub-component for individual items
interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    isExpanded: boolean;
    isActive?: boolean;
    onClick: (e: React.MouseEvent) => void;
    marquee?: boolean;
    isLocked?: boolean;
    showArrow?: boolean;
    isOpen?: boolean;
}

function SidebarItem({ icon, label, isExpanded, isActive, onClick, marquee, isLocked, showArrow, isOpen }: SidebarItemProps) {
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            className={cn(
                "h-11 rounded-xl transition-all duration-200 group relative overflow-hidden shrink-0",
                isExpanded ? "w-full justify-start px-3 text-left" : "w-11 justify-center px-0",
                isActive
                    ? "bg-primary/10 text-primary hover:bg-primary/15 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                isLocked && "cursor-default"
            )}
        >
            <div className={cn("flex items-center justify-center transition-colors shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}>
                {icon}
            </div>

            {/* Label */}
            <div className={cn(
                "ml-3 overflow-hidden flex items-center justify-start gap-2",
                isExpanded ? "opacity-100 flex" : "opacity-0 hidden w-0"
            )}>
                {marquee && isExpanded ? (
                    <MarqueeText text={label} delay={1000} speed={5} />
                ) : (
                    <span className="whitespace-nowrap block truncate">
                        {label}
                    </span>
                )}
                
                {showArrow && (
                    <ChevronDown className={cn(
                        "h-4 w-4 transition-transform duration-200 text-muted-foreground/60 shrink-0",
                        isOpen && "rotate-180"
                    )} />
                )}
            </div>

            {/* Active Indicator Bar */}
            {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-primary" />
            )}
        </Button>
    );
}

