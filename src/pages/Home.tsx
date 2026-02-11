import { StatusPanel } from "@/components/StatusPanel"
import { SearchRow } from "@/components/SearchRow"
import { VehicleList } from "@/components/VehicleList"
import { MapMain } from "@/components/MapMain"
import { useEffect, useState, useMemo } from "react"
import { NavixyService } from "@/services/navixy"
import { syncService } from "@/services/sync"
import { useNavixyRealtime } from "@/hooks/useNavixyRealtime"
import { useVehiclesDB, transformDBToVehicles } from "@/hooks/useVehiclesDB"
import { getVehicleStatus } from "@/hooks/useTrackerStatusDuration"
import { formatTimeAgo, cn } from "@/lib/utils"
import type { Vehicle, VehicleStatus } from "@/data/mock"

import { VehicleDetail } from "@/components/VehicleDetail"
import { useLocation } from "react-router-dom"
import { FleetPulseCard } from "@/components/FleetPulseCard"
import { FleetStats } from "@/components/FleetStats"
import { useFleetAnalysis } from "@/hooks/useFleetAnalysis"
import { useOps } from "@/context/OpsContext"
import { Activity } from "lucide-react"

export function Home() {
    const location = useLocation();
    // 1. Data State
    const { ops, setOps } = useOps();
    const [trackerIds, setTrackerIds] = useState<number[]>([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});

    // 3. Load API Key based on Ops Region
    const sessionKey = ops === 'zambia'
        ? import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM
        : import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ;

    // 4. Start Sync Service (30s flush to IndexedDB)
    useEffect(() => {
        syncService.start();
        return () => syncService.stop();
    }, []);

    // 5. Fetch Initial List
    useEffect(() => {
        if (!sessionKey) return;
        const initTrackers = async () => {
            try {
                const list = await NavixyService.listTrackers(sessionKey);
                if (list && Array.isArray(list)) {
                    console.log("[Home] Raw Tracker List:", list);

                    const labels: Record<number, string> = {};

                    list.forEach((t: any) => {
                        // Extract best name
                        const name = t.label || t.name || t.model_name || t.source?.device_id || `Vehicle ${t.id}`;

                        // Map by Tracker ID
                        labels[t.id] = name;

                        // Map by Source ID (if available, to handle WebSocket mismatch)
                        if (t.source && t.source.id) {
                            labels[t.source.id] = name;
                        }
                    });

                    console.log("[Home] Mapped Labels:", labels);

                    setTrackerIds(list.map((t: any) => t.id));
                    setTrackerLabels(labels);
                }
            } catch (e) {
                console.error("Failed to load trackers", e);
            }
        };
        initTrackers();
    }, [sessionKey]);

    // 6. Connect to Live WebSocket (Layer 1: Real-time)
    const { trackerStates } = useNavixyRealtime(trackerIds, sessionKey);

    // 7. Load from IndexedDB (Layer 2: Persistent fallback for offline)
    const { dbVehicles } = useVehiclesDB();

    // 8. Fleet Analysis for Fleet Pulse
    const fleetAnalysis = useFleetAnalysis(trackerStates);

    // Filter State
    const [filterStatus, setFilterStatus] = useState<string>("All");
    const [searchQuery, setSearchQuery] = useState("");

    // 8. Transform to UI Model (with DB fallback for offline)
    const vehicles: Vehicle[] = useMemo(() => {
        const hasRealtimeData = Object.keys(trackerStates).length > 0;

        // Prefer real-time data if available
        if (hasRealtimeData) {
            const allVehicles = Object.entries(trackerStates).map(([idStr, state]) => {
                const id = Number(idStr);
                const label = trackerLabels[id] || `Vehicle #${id}`;
                const navixyStatus = getVehicleStatus(state);

                // Map Navixy Status to UI Status with 24h threshold for offline
                let uiStatus: VehicleStatus = "Stopped";
                if (navixyStatus === 'moving') {
                    uiStatus = "Running";
                } else if (navixyStatus === 'idle-stopped' || navixyStatus === 'idle-parked') {
                    uiStatus = "Idle";
                } else if (navixyStatus === 'offline') {
                    // Check how long since last update
                    const lastUpdate = new Date(state.last_update).getTime();
                    const now = Date.now();
                    const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

                    if (hoursSinceUpdate >= 24) {
                        uiStatus = "Not Working"; // ≥24h offline
                    } else {
                        uiStatus = "Not Online"; // <24h offline
                    }
                }

                return {
                    id: String(id),
                    name: label,
                    driver: "Assigned",
                    timeAgo: formatTimeAgo(state.last_update),
                    speed: state.gps.speed,
                    address: "Fetching address...",
                    status: uiStatus,
                    coordinates: [state.gps.location.lat, state.gps.location.lng] as [number, number],
                    heading: state.gps.heading ?? 0,
                };
            });

            return applyFilters(allVehicles);
        }

        // Fallback to IndexedDB when offline or no real-time data
        if (dbVehicles.length > 0) {
            console.log('[Home] Using IndexedDB fallback for vehicle list');
            const dbTransformed = transformDBToVehicles(dbVehicles);
            return applyFilters(dbTransformed as Vehicle[]);
        }

        return [];

        function applyFilters(allVehicles: Vehicle[]): Vehicle[] {
            if (filterStatus === "All" && !searchQuery) return allVehicles;

            return allVehicles.filter(v => {
                // 1. Text Search
                if (searchQuery) {
                    const q = searchQuery.toLowerCase().replace(/\s+/g, '');
                    const targetName = v.name.toLowerCase().replace(/\s+/g, '');
                    const targetDriver = v.driver.toLowerCase().replace(/\s+/g, '');

                    if (!targetName.includes(q) && !targetDriver.includes(q)) {
                        return false;
                    }
                }

                // 2. Status Filter
                if (filterStatus === "Running") return v.status === "Running";
                if (filterStatus === "Stopped") return v.status === "Stopped";
                if (filterStatus === "Idle") return v.status === "Idle";
                if (filterStatus === "Not Working") return v.status === "Not Working";
                if (filterStatus === "Not Online") return v.status === "Not Online";
                return true;
            });
        }

    }, [trackerStates, trackerLabels, filterStatus, searchQuery, dbVehicles]);

    // Metrics calculation logic
    const metrics = useMemo(() => {
        const allVehicles = Object.entries(trackerStates).map(([_, state]) => {
            const navixyStatus = getVehicleStatus(state);
            let uiStatus: VehicleStatus = "Stopped";

            if (navixyStatus === 'moving') {
                uiStatus = "Running";
            } else if (navixyStatus === 'idle-stopped' || navixyStatus === 'idle-parked') {
                uiStatus = "Idle";
            } else if (navixyStatus === 'offline') {
                const lastUpdate = new Date(state.last_update).getTime();
                const now = Date.now();
                const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

                if (hoursSinceUpdate >= 24) {
                    uiStatus = "Not Working";
                } else {
                    uiStatus = "Not Online";
                }
            }
            return { status: uiStatus };
        });

        const total = allVehicles.length;
        const moving = allVehicles.filter(v => v.status === 'Running').length;
        const idle = allVehicles.filter(v => v.status === 'Idle').length;
        const stopped = allVehicles.filter(v => v.status === 'Stopped').length;
        const offline = allVehicles.filter(v => v.status === 'Not Working').length;
        const not_online = allVehicles.filter(v => v.status === 'Not Online').length;

        return { total, moving, idle, stopped, offline, not_online };
    }, [trackerStates]);

    // Render Fleet Pulse View
    if (location.pathname === '/fleet-pulse') {
        return (
            <div className="flex flex-1 flex-col overflow-hidden h-full">
                {/* Fleet Pulse Header */}
                <header
                    className="sticky top-0 z-30 px-6 py-4 theme-transition bg-surface-main flex items-center justify-between"
                >
                    <div className="flex items-center gap-3">
                        <Activity
                            className="h-6 w-6 text-green-500"
                        />
                        <h1
                            className="text-2xl font-semibold text-foreground uppercase tracking-wide"
                        >
                            Fleet Pulse
                        </h1>
                        <div className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-bold uppercase tracking-wide">
                            {ops === 'zambia' ? 'Zambia Operations' : 'Tanzania Operations'}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest hidden md:block">
                            Switch Fleet
                        </div>
                        <div className="scale-110 origin-right">
                            <div className={cn(
                                "flex items-center bg-muted/60 rounded-full p-1 border border-border shadow-sm transition-opacity",
                                "scale-100",
                            )}>
                                <button
                                    onClick={() => setOps('tanzania')}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer",
                                        ops === 'tanzania'
                                            ? "bg-blue-500 text-white shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    TZ Ops
                                </button>
                                <button
                                    onClick={() => setOps('zambia')}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer",
                                        ops === 'zambia'
                                            ? "bg-blue-500 text-white shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    ZM Ops
                                </button>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Fleet Pulse Content - Centered */}
                <main className="flex-1 overflow-hidden px-6 py-4 flex flex-col items-center justify-center gap-6">
                    <FleetPulseCard
                        analysis={fleetAnalysis}
                        loading={Object.keys(trackerStates).length === 0}
                    />
                    <FleetStats
                        analysis={fleetAnalysis}
                        loading={Object.keys(trackerStates).length === 0}
                    />
                </main>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col overflow-hidden h-full">
            {/* Run Time Status - Moved to TopNav */}
            {/* Metrics - Dashboard specific */}
            <StatusPanel metrics={metrics} />

            {/* Main Content Area */}
            {/* Main Content Area */}
            <main className="flex-1 overflow-hidden px-6 pt-8 pb-3 flex gap-4">
                {/* Left Panel: List */}
                <div className="flex w-[400px] min-w-[350px] flex-col h-full gap-4">
                    {/* Search & Filter - Independent Box Row */}
                    <SearchRow
                        currentFilter={filterStatus}
                        onFilterChange={setFilterStatus}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                    />

                    {/* Vehicle List - Independent Box */}
                    <div className="flex-1 overflow-hidden rounded-[30px] bg-surface-card shadow-xl border border-border/60 flex flex-col transition-all">
                        <div className="flex-1 overflow-y-auto scrollbar-thin">
                            <VehicleList
                                vehicles={vehicles}
                                selectedVehicleId={selectedVehicleId ? String(selectedVehicleId) : null}
                                onVehicleClick={(id) => setSelectedVehicleId(Number(id))}
                            />
                        </div>
                    </div>
                </div>

                {/* Right Panel: Map */}
                <div className="flex-1 h-full rounded-[24px] overflow-hidden shadow-lg border border-border relative bg-surface-card">
                    <MapMain
                        vehicles={vehicles}
                        selectedVehicleId={selectedVehicleId ? String(selectedVehicleId) : null}
                        onMarkerClick={(id) => setSelectedVehicleId(Number(id))}
                    />

                    {/* Detail Panel Overlay */}
                    {selectedVehicleId && trackerStates[selectedVehicleId] && (
                        <VehicleDetail
                            vehicleId={selectedVehicleId}
                            vehicleName={trackerLabels[selectedVehicleId] || `Vehicle ${selectedVehicleId}`}
                            trackerState={trackerStates[selectedVehicleId]}
                            onClose={() => setSelectedVehicleId(null)}
                        />
                    )}
                </div>
            </main>
        </div>
    )
}
