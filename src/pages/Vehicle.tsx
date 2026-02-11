import { useEffect, useState, useRef } from "react";

import { useLocation } from "react-router-dom";
import { NavixyService } from "@/services/navixy";
import { FuelTheft } from "./vehicle/FuelTheft";
import { VehicleDetail } from "./vehicle/VehicleDetail";
import { DriverScore } from "./vehicle/DriverScore";
import { RouteMaster } from "./vehicle/RouteMaster";
import { Input } from "@/components/ui/input";
import { Search, Truck, Clock, Filter, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ActivityRow } from "@/components/ActivityTable";
import { useNavixyRealtime } from "../hooks/useNavixyRealtime";
import { getVehicleStatus } from "@/hooks/useTrackerStatusDuration";
import { formatTimeAgo, cn } from "@/lib/utils";
import { useOps } from "@/context/OpsContext";
import { OpsToggle } from "@/components/ui/OpsToggle";
// Context
const FILTERS = [
    { label: "All Devices", value: "All" },
    { label: "Idle", value: "Idle" },
    { label: "Not Working", value: "Not Working" },
    { label: "Moving", value: "Moving" },
    { label: "Stopped", value: "Stopped" },
    { label: "Not Online", value: "Not Online" }
];

export function Vehicle() {
    // State
    const location = useLocation();
    const [trackers, setTrackers] = useState<any[]>([]);
    const [filteredTrackers, setFilteredTrackers] = useState<any[]>([]);
    const [selectedTrackerId, setSelectedTrackerId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentFilter, setCurrentFilter] = useState("All");
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);

    // Detail View State
    const [activityData, setActivityData] = useState<ActivityRow[]>([]);
    const [loadingActivity, setLoadingActivity] = useState(false);

    // Context
    const { ops } = useOps();

    const sessionKey = ops === 'zambia'
        ? import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM
        : import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ;

    // 1. Fetch Trackers (Static List)
    useEffect(() => {
        if (!sessionKey) return;
        NavixyService.listTrackers(sessionKey).then(list => {
            if (list) {
                setTrackers(list);
                setFilteredTrackers(list);
            }
        });
    }, [sessionKey]);

    // 2. Real-time Updates
    const trackerIds = trackers.map(t => t.id);
    const { trackerStates } = useNavixyRealtime(trackerIds, sessionKey);

    // 3. Search & Filter Logic
    useEffect(() => {
        let result = trackers;

        // Filter by Search Query
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t => {
                const label = (t.label || t.source?.device_id || "").toLowerCase();
                const model = (t.model || "").toLowerCase();
                return label.includes(q) || model.includes(q);
            });
        }

        // Filter by Status
        if (currentFilter !== "All") {
            result = result.filter(t => {
                const state = trackerStates[t.id] || (t.source?.id ? trackerStates[t.source.id] : undefined);
                if (!state) return currentFilter === "Not Online"; // Treat no state as Not Online? Or ignore?

                const navixyStatus = getVehicleStatus(state);
                let status = "Stopped"; // Default

                if (navixyStatus === 'moving') status = "Moving";
                else if (navixyStatus === 'idle-stopped' || navixyStatus === 'idle-parked') status = "Idle";
                else if (navixyStatus === 'offline') {
                    const updateTime = new Date(state.last_update).getTime();
                    const hours = (Date.now() - updateTime) / (1000 * 60 * 60);
                    status = hours >= 24 ? "Not Working" : "Not Online";
                }

                // Map "Running" to "Moving" in our filter logic if needed, but here we use "Moving"
                return status === currentFilter;
            });
        }

        setFilteredTrackers(result);
    }, [searchQuery, trackers, currentFilter, trackerStates]);

    // Filter Dropdown Click Outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // 4. Fetch Details when Vehicle Selected
    useEffect(() => {
        if (!selectedTrackerId || !sessionKey) return;

        const fetchDetails = async () => {
            setLoadingActivity(true);
            try {
                const now = new Date();
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1); // Last 24h or so

                const trips = await NavixyService.listTrips(selectedTrackerId, yesterday, now, sessionKey);
                const vehicle = trackers.find(t => t.id === selectedTrackerId);

                const mappedTrips = trips.map((t: any) => ({
                    ...t,
                    vehicleName: vehicle?.label || vehicle?.source?.device_id || `Vehicle #${selectedTrackerId}`,
                    vehicleBrand: vehicle?.model || 'Unknown'
                }));
                setActivityData(mappedTrips);
            } catch (err) {
                console.error("Failed to fetch vehicle details", err);
            } finally {
                setLoadingActivity(false);
            }
        };

        fetchDetails();
    }, [selectedTrackerId, sessionKey, trackers]);


    // --- RENDER ---

    // VIEW: SUB-SECTIONS (Fuel Theft)

    if (location.pathname.includes('/fuel-theft')) {
        return <FuelTheft />;
    }

    if (location.pathname.includes('/driver-score')) {
        return <DriverScore />;
    }

    if (location.pathname.includes('/route-master')) {
        return <RouteMaster />;
    }

    // VIEW: DETAIL
    if (selectedTrackerId) {
        const vehicle = trackers.find(t => t.id === selectedTrackerId);

        return (
            <VehicleDetail
                vehicle={vehicle}
                activityData={activityData}
                loading={loadingActivity}
                onBack={() => setSelectedTrackerId(null)}
            />
        );
    }

    // VIEW: LIST
    return (
        <div className="h-full overflow-y-auto p-6 space-y-6 scrollbar-thin">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Vehicles</h1>
                    <p className="text-muted-foreground">Select a vehicle to view detailed activity and stats.</p>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                    {/* Ops Toggle Switch */}
                    <OpsToggle />

                    {/* Search & Filter */}
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        {/* Search Bar */}
                        <div className="relative w-full md:w-[320px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by name, brand, or ID..."
                                className="pl-10 bg-surface-card"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Filter Dropdown */}
                        <div className="relative" ref={filterRef}>
                            <Button
                                size="icon"
                                className={cn(
                                    "h-10 w-10 rounded-lg shadow-sm transition-all",
                                    currentFilter !== "All"
                                        ? "bg-blue-600 hover:bg-blue-700"
                                        : "bg-primary hover:bg-primary/90"
                                )}
                                onClick={() => setIsFilterOpen(!isFilterOpen)}
                            >
                                <Filter className="h-5 w-5 text-white" />
                            </Button>

                            {isFilterOpen && (
                                <div className="absolute right-0 top-12 w-48 bg-surface-card rounded-xl shadow-xl border border-border py-2 z-50 animate-in fade-in slide-in-from-top-2">
                                    {FILTERS.map((f) => (
                                        <button
                                            key={f.value}
                                            onClick={() => {
                                                setCurrentFilter(f.value);
                                                setIsFilterOpen(false);
                                            }}
                                            className={cn(
                                                "w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-muted transition-colors",
                                                currentFilter === f.value
                                                    ? "text-primary font-medium"
                                                    : "text-muted-foreground"
                                            )}
                                        >
                                            {f.label}
                                            {currentFilter === f.value && <Check className="h-4 w-4" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Vehicle Grid/List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredTrackers.map((t) => {
                    // Try looking up by tracker ID first, then source ID
                    const state = trackerStates[t.id] || (t.source?.id ? trackerStates[t.source.id] : undefined);

                    let status = "Offline";
                    let lastUpdate = t.source?.last_update;

                    if (state) {
                        lastUpdate = state.last_update;
                        const navixyStatus = getVehicleStatus(state);

                        if (navixyStatus === 'moving') status = "Moving";
                        else if (navixyStatus === 'idle-stopped' || navixyStatus === 'idle-parked') status = "Idle";
                        else if (navixyStatus === 'offline') {
                            const updateTime = new Date(state.last_update).getTime();
                            const hours = (Date.now() - updateTime) / (1000 * 60 * 60);
                            status = hours >= 24 ? "Not Working" : "Not Online";
                        } else {
                            status = "Stopped";
                        }
                    } else {
                        // console.log(`[Vehicle] No state for ${t.id} / ${t.source?.id}`);
                    }

                    return (
                        <div
                            key={t.id}
                            onClick={() => setSelectedTrackerId(t.id)}
                            className="group relative bg-surface-card rounded-xl border border-border p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                                    <Truck className="h-5 w-5" />
                                </div>
                                <Badge variant={status === "Moving" ? "default" : status === "Idle" ? "secondary" : "outline"}
                                    className={
                                        status === "Moving" ? "bg-green-500 hover:bg-green-600 border-transparent" :
                                            status === "Idle" ? "bg-orange-500 hover:bg-orange-600 text-white border-transparent" :
                                                "bg-muted text-muted-foreground border-transparent"
                                    }
                                >
                                    {status}
                                </Badge>
                            </div>

                            <h3 className="font-bold text-foreground truncate">{t.label || `Vehicle #${t.id}`}</h3>


                            <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-3">
                                <Clock className="h-3 w-3" />
                                <span>{lastUpdate ? formatTimeAgo(lastUpdate) : 'Never'}</span>
                            </div>
                        </div>
                    )
                })}

                {filteredTrackers.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground">
                        {currentFilter !== "All"
                            ? `No vehicles found matching "${searchQuery}" with status "${currentFilter}"`
                            : `No vehicles found matching "${searchQuery}"`
                        }
                    </div>
                )}
            </div>
        </div>
    );
}
