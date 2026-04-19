import { useState, useEffect, useMemo } from "react";
import {
    TrendingUp,
    MapPin,
    Moon,
    Gauge,
    Calendar,
    FileText,
    Download,
    TrendingDown,
    ArrowUpRight,
    ChevronRight,
    ArrowLeft,
    Search,
    GitFork,
    WifiOff,
    UserCheck,
    AlertTriangle,
    Clock,
    Coffee,
    Info,
    Truck,
    List,
    Smartphone,
    Activity,
    Lock,
    BarChart3,
    type LucideIcon,
} from "lucide-react";
import { NavixyService } from "../services/navixy";
import Papa from "papaparse";
import { useOps } from "../context/OpsContext";
import { api } from "../context/config";
import { cn, isCleanVehicleLabel } from "../lib/utils";
import { supabase } from "../lib/supabase";


/* ────────────── Report Type Registry ────────────── */

interface ReportDef {
    id: string;
    title: string;
    subtitle?: string;
    icon: LucideIcon;
    color: string;        // icon bg color class
    iconColor: string;    // icon text color class
    hasTimeframe: boolean;
    hasApi: boolean;       // false = "Coming Soon"
    description: string;   // About this report text
    tzOnly?: boolean;      // true = only available for TZ ops
}

const REPORT_TYPES: ReportDef[] = [
    {
        id: "fleet-performance",
        title: "Fleet Performance",
        icon: TrendingUp,
        color: "bg-blue-500/10 dark:bg-blue-500/20",
        iconColor: "text-blue-600 dark:text-blue-400",
        hasTimeframe: true,
        hasApi: true,
        description: "Comprehensive vehicle-by-vehicle performance breakdown including total trip distance, average speed, driving duration, night driving hours, engine hours, idling time, fuel consumption, fuel expense, and mileage efficiency. Ideal for identifying underperforming assets and optimizing fleet utilization.",
    },
    {
        id: "geofence-report",
        title: "Geofence Report",
        icon: MapPin,
        color: "bg-rose-500/10 dark:bg-rose-500/20",
        iconColor: "text-rose-500 dark:text-rose-400",
        hasTimeframe: false,
        hasApi: true,
        description: "A snapshot of all configured geofences with entry/exit events and dwell times. Use this report to monitor whether vehicles are staying within designated operational zones and complying with route boundaries.",
    },
    {
        id: "geofence-list",
        title: "Geofence List",
        icon: List,
        color: "bg-teal-500/10 dark:bg-teal-500/20",
        iconColor: "text-teal-600 dark:text-teal-400",
        hasTimeframe: false,
        hasApi: true,
        description: "A comprehensive list of all geofences including serial number, name, and shape details. Download directly as CSV.",
    },
    {
        id: "tracker-list",
        title: "All Tracker List",
        icon: Smartphone,
        color: "bg-violet-500/10 dark:bg-violet-500/20",
        iconColor: "text-violet-600 dark:text-violet-400",
        hasTimeframe: false,
        hasApi: true,
        description: "A complete list of every single tracker/vehicle registered to the current Operations API key. Includes ID, Name, Model, and other core configuration details. Useful for full fleet audits.",
    },
    {
        id: "night-drivers",
        title: "Night Drivers",
        icon: Moon,
        color: "bg-indigo-500/10 dark:bg-indigo-500/20",
        iconColor: "text-indigo-500 dark:text-indigo-400",
        hasTimeframe: true,
        hasApi: true,
        description: "Ranks vehicles by total night-driving hours within the selected period. Helps identify drivers operating during high-risk overnight windows so you can enforce rest policies and reduce accident exposure.",
    },
    {
        id: "speed-violators",
        title: "Speed Violators",
        icon: Gauge,
        color: "bg-orange-500/10 dark:bg-orange-500/20",
        iconColor: "text-orange-500 dark:text-orange-400",
        hasTimeframe: true,
        hasApi: true,
        description: "Lists vehicles that exceeded speed thresholds during the selected time window, ranked by violation severity. Essential for enforcing driving safety standards and reducing insurance risk.",
    },
    {
        id: "fuel-expense",
        title: "Fuel Expense",
        icon: Calendar,
        color: "bg-green-500/10 dark:bg-green-500/20",
        iconColor: "text-green-600 dark:text-green-400",
        hasTimeframe: true,
        hasApi: true,
        description: "Daily fuel cost breakdown split by motion and idle consumption in USD. Helps track fuel budget trends, identify wasteful idling, and forecast future fuel expenditure.",
    },
    {
        id: "below-average",
        title: "Below Average",
        icon: TrendingDown,
        color: "bg-red-500/10 dark:bg-red-500/20",
        iconColor: "text-red-500 dark:text-red-400",
        hasTimeframe: true,
        hasApi: true,
        description: "Identifies vehicles performing below the fleet's target KPIs — including distance travelled, driving hours, and utilization percentage. Use this to flag underutilized assets that may need reassignment or maintenance checks.",
    },
    {
        id: "above-average",
        title: "Above Average",
        icon: ArrowUpRight,
        color: "bg-emerald-500/10 dark:bg-emerald-500/20",
        iconColor: "text-emerald-600 dark:text-emerald-400",
        hasTimeframe: true,
        hasApi: true,
        description: "Highlights top-performing vehicles that exceed the fleet's target KPIs. Useful for recognizing high-output assets and rewarding efficient drivers.",
    },
    {
        id: "route-deviation",
        title: "Route Deviation",
        icon: GitFork,
        color: "bg-purple-500/10 dark:bg-purple-500/20",
        iconColor: "text-purple-500 dark:text-purple-400",
        hasTimeframe: true,
        hasApi: false,
        description: "Tracks instances where vehicles deviated from their assigned or expected routes. Helps detect unauthorized detours, fuel theft opportunities, and delivery compliance issues.",
    },
    {
        id: "inactive-trackers",
        title: "Inactive Trackers",
        icon: WifiOff,
        color: "bg-muted",
        iconColor: "text-muted-foreground",
        hasTimeframe: false,
        hasApi: false,
        description: "Lists tracking devices that have stopped transmitting signals beyond the expected threshold. Useful for scheduling device maintenance and ensuring full fleet visibility.",
    },
    {
        id: "driver-consistency",
        title: "Driver Consistency",
        icon: UserCheck,
        color: "bg-cyan-500/10 dark:bg-cyan-500/20",
        iconColor: "text-cyan-600 dark:text-cyan-400",
        hasTimeframe: true,
        hasApi: false,
        description: "Evaluates driver behavior consistency based on speed patterns, braking frequency, and driving hours. Helps identify training needs and reward safe, consistent drivers.",
    },
    {
        id: "high-risk-time",
        title: "High-Risk Time",
        icon: AlertTriangle,
        color: "bg-amber-500/10 dark:bg-amber-500/20",
        iconColor: "text-amber-600 dark:text-amber-400",
        hasTimeframe: true,
        hasApi: false,
        description: "Pinpoints time windows with the highest concentration of speeding, harsh braking, and night driving events across the fleet. Allows operations teams to schedule riskier routes during safer periods.",
    },
    {
        id: "idle-time",
        title: "Idle Time",
        icon: Coffee,
        color: "bg-teal-500/10 dark:bg-teal-500/20",
        iconColor: "text-teal-600 dark:text-teal-400",
        hasTimeframe: true,
        hasApi: false,
        description: "Breaks down total engine-on idle time per vehicle. Excessive idling increases fuel costs and engine wear — this report helps you identify and address the biggest offenders.",
    },
    {
        id: "live-status-report",
        title: "Live Status Report",
        icon: Activity,
        color: "bg-blue-500/10 dark:bg-blue-500/20",
        iconColor: "text-blue-600 dark:text-blue-400",
        hasTimeframe: false,
        hasApi: true,
        description: "A real-time snapshot of the current location, status, and sensor readings for all active devices. Download immediately as CSV.",
    },
    {
        id: "geofence-asset-count",
        title: "Geofence Asset Count",
        subtitle: "Live snapshot of vehicle distribution across all geofences",
        icon: BarChart3,
        color: "bg-cyan-500/10 dark:bg-cyan-500/20",
        iconColor: "text-cyan-600 dark:text-cyan-400",
        hasTimeframe: false,
        hasApi: true,
        description: "Live snapshot of vehicle distribution across all geofences. Shows parent/child geofence hierarchy with vehicle counts, moving and parked breakdowns. TZ Ops only.",
        tzOnly: true,
    },
];

/* ────────────── Timeframe Constants ────────────── */

const TF_ALL = ["30 days", "7 days", "1 day"] as const;
const TF_FLEET = ["MTD", "30 days", "7 days", "1 day"] as const;
const TF_FUEL = ["30 days", "7 days", "1 day"] as const;

type TfAll = (typeof TF_ALL)[number];
type TfFleet = (typeof TF_FLEET)[number];
type TfFuel = (typeof TF_FUEL)[number];

const getTimeframeOptions = (reportId: string): readonly string[] => {
    if (reportId === "fleet-performance") return TF_FLEET;
    if (reportId === "fuel-expense") return TF_FUEL;
    if (reportId === "geofence-report" || reportId === "inactive-trackers" || reportId === "tracker-list" || reportId === "live-status-report") return [];
    return TF_ALL;
};

/* ────────────── API Param Mappers ────────────── */

const fleetPerfPeriod = (tf?: string) =>
    tf === "MTD" ? "mtd" :
        tf === "1 day" ? "latest" :
            tf === "7 days" ? "last7days" : "last30days";

const nightWindow = (tf?: string) =>
    (tf === "1 day") ? "1d" : tf === "7 days" ? "7d" : "30d";

const speedWindow = nightWindow;

const windowKey = (tf?: string) =>
    (tf === "1 day") ? "1day" : tf === "7 days" ? "7days" : "30days";

const fuelWindow = (tf?: string) =>
    tf === "7 days" ? "last7days" : "last30days";

/* ────────────── Scope Type ────────────── */

type ReportScope = "fleet" | "vehicle";

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export function Reports() {
    const { ops, setOps } = useOps();

    // View state
    const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);

    // Detail-view state
    const [selectedTf, setSelectedTf] = useState<string>("");

    const [scope, setScope] = useState<ReportScope>("fleet");
    const [vehicleSearch, setVehicleSearch] = useState("");
    const [selectedVehicle, setSelectedVehicle] = useState("");
    const [vehicleList, setVehicleList] = useState<string[]>([]);
    const [loadingVehicles, setLoadingVehicles] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState("");


    // Reset detail state when selecting a new report
    const openReport = (r: ReportDef) => {
        setSelectedReport(r);
        setSelectedTf("");

        setScope("fleet");
        setVehicleSearch("");
        setSelectedVehicle("");
    };

    const goBack = () => setSelectedReport(null);

    // Fetch vehicle list when scope switches to "vehicle"
    useEffect(() => {
        if (scope !== "vehicle" || vehicleList.length > 0) return;

        const fetchVehicles = async () => {
            setLoadingVehicles(true);
            try {
                const base = api(ops, "vehiclewiseSummary")?.replace(/\/+$/, "");
                if (!base) return;

                const url = `${base}?period=last30days&_t=${Date.now()}`;
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) return;
                const json = await res.json();

                let rows: any[] = [];
                if (ops === "tanzania" && json?.downloadUrl) {
                    // TZ ops: fetch from pre-signed S3 URL
                    try {
                        const fileRes = await fetch(json.downloadUrl);
                        if (fileRes.ok) rows = await fileRes.json();
                    } catch { /* silent */ }
                } else {
                    if (Array.isArray(json?.data)) rows = json.data;
                    else if (json?.data && typeof json.data === "object") {
                        rows = json.data.last30days || json.data.latest || Object.values(json.data).flat();
                    }
                }

                const names = rows
                    .map((r: any) => r.Vehicle || r.vehicle || r.vehicle_number || r.tracker_name || "")
                    .filter(Boolean)
                    .filter(isCleanVehicleLabel)
                    .sort();
                setVehicleList([...new Set(names)]);
            } catch {
                // silent
            } finally {
                setLoadingVehicles(false);
            }
        };
        fetchVehicles();
    }, [scope, ops, vehicleList.length]);

    // Reset vehicle list when ops changes
    useEffect(() => {
        setVehicleList([]);
    }, [ops]);

    // Filtered vehicle suggestions — show all matches
    const vehicleSuggestions = useMemo(() => {
        if (!vehicleSearch.trim()) return vehicleList;
        const q = vehicleSearch.toLowerCase();
        return vehicleList.filter((v) => v.toLowerCase().includes(q));
    }, [vehicleSearch, vehicleList]);

    /* ──────────── Download Logic ──────────── */

    const downloadBlob = (csv: string, filename: string) => {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    };

    const filterByVehicle = (rows: any[]): any[] => {
        if (scope !== "vehicle" || !selectedVehicle) return rows;
        const q = selectedVehicle.toLowerCase();
        return rows.filter((r: any) => {
            const v = (r.Vehicle || r.vehicle || r.vehicle_number || r.tracker_name || "").toLowerCase();
            return v.includes(q);
        });
    };

    const handleDownload = async () => {
        if (!selectedReport || !selectedReport.hasApi) return;

        const id = selectedReport.id;
        const tf = selectedTf;

        // Validate timeframe
        if (selectedReport.hasTimeframe && !tf) return;

        // Validate vehicle selection
        if (scope === "vehicle" && !selectedVehicle) return;

        setDownloading(true);

        try {
            switch (id) {
                case "fleet-performance":
                    await dlFleetPerformance(tf as TfFleet);
                    break;
                case "geofence-report":
                    await dlGeofence();
                    break;
                case "night-drivers":
                    await dlNightDrivers(tf as TfAll);
                    break;
                case "speed-violators":
                    await dlSpeedViolators(tf as TfAll);
                    break;
                case "fuel-expense":
                    await dlFuelExpense(tf as TfFuel);
                    break;
                case "below-average":
                    await dlBelowAvg(tf as TfAll);
                    break;
                case "above-average":
                    await dlAboveAvg(tf as TfAll);
                    break;
                case "tracker-list":
                    await dlTrackerList();
                    break;
                case "live-status-report":
                    await dlLiveStatus();
                    break;
                case "geofence-asset-count":
                    await dlGeofenceAssetCount();
                    break;
            }
        } catch (err) {
            console.error("Download failed:", err);
            alert("Failed to download report.");
        } finally {
            setDownloading(false);
            setDownloadProgress("");
        }
    };

    /* ── Individual download handlers ── */

    const dlFleetPerformance = async (tf: TfFleet) => {
        const period = fleetPerfPeriod(tf);
        let endpointKey: "vehicleDetails1d" | "vehicleDetails7d" | "vehicleDetails30d" | "vehicleDetailsMtd" = "vehicleDetails30d";
        if (tf === "MTD") endpointKey = "vehicleDetailsMtd";
        else if (tf === "1 day") endpointKey = "vehicleDetails1d";
        else if (tf === "7 days") endpointKey = "vehicleDetails7d";

        const baseUrl = api(ops, endpointKey);
        if (!baseUrl) throw new Error("API not configured");

        const url = baseUrl.includes("?")
            ? `${baseUrl}&_t=${Date.now()}`
            : `${baseUrl}?_t=${Date.now()}`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        let rows: any[] = [];

        if (Array.isArray(json)) {
            rows = json;
        } else if (ops === "tanzania" && json?.downloadUrl) {
            // Legacy/fallback TZ ops logic
            const fileRes = await fetch(json.downloadUrl);
            if (!fileRes.ok) {
                alert("Failed to fetch dataset from S3.");
                return;
            }
            rows = await fileRes.json();
        } else {
            if (Array.isArray(json?.data)) rows = json.data;
            else if (json?.data && typeof json.data === "object") {
                rows = json.data[period] || json.data.latest || [];
            }
        }

        if (!rows?.length) return alert("No Fleet Performance data.");

        // First apply any vehicle search UI filters
        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        // Check if data is using the NEW format (camelCase with 'date' field meaning timeseries)
        // or the OLD format (already aggregated with specific mapped string keys like 'Vehicle' and 'Total Trips Length (km)')
        const isNewFormat = rows.length > 0 && "totalTripLengthKm" in rows[0];

        if (isNewFormat && tf === "1 day") {
            // For 1 day reports, Navixy's API may return overlapping 24hr data spanning two calendar dates.
            // We must filter strictly to the latest calendar date to prevent summing 2 days of stats.
            const maxDate = rows.reduce((max, r) => (r.date && r.date > max) ? r.date : max, "");
            if (maxDate) {
                rows = rows.filter(r => r.date === maxDate);
            }
        }

        let finalRows = [];

        if (isNewFormat && tf === "MTD") {
            // MTD is pre-aggregated and pre-sorted by backend — just map fields
            finalRows = rows.map((r: any) => ({
                "Vehicle": (r.vehicle || "").trim(),
                "Total Trips Length (km)": Number(r.totalTripLengthKm || 0).toFixed(2),
                "Number of Trips": r.tripCount || 0,
                "Average Distance Travelled per Trip": Number(r.avgDistancePerTripKm || 0).toFixed(2),
                "Average Speed in Trip": Number(r.avgSpeedKmh || 0).toFixed(2),
                "Total Driving Duration (hrs)": Number(r.drivingDurationH || 0).toFixed(2),
                "Total Night Driving Duration (hrs)": Number(r.nightDrivingH || 0).toFixed(2),
                "Total Engine Hours (hrs)": Number(r.engineHoursH || 0).toFixed(2),
                "Total Idling Hours (hrs)": Number(r.idlingHoursH || 0).toFixed(2),
                "Total In Movement Duration (hrs)": Number(r.inMovementHoursH || 0).toFixed(2),
                "Fuel Consumption (litres)": Number(r.fuelConsumptionL || 0).toFixed(2),
                "Mileage (kmpl)": Number(r.mileageKmpl || 0).toFixed(2),
            }));
        } else if (isNewFormat) {
            // Aggregate timeseries logs by vehicle for 1d/7d/30d
            const aggs = new Map<string, any>();
            for (const r of rows) {
                const vName = typeof r.vehicle === 'string' ? r.vehicle.trim() : "Unknown Vehicle";
                if (!aggs.has(vName)) {
                    aggs.set(vName, {
                        Vehicle: vName,
                        "Total Trips Length (km)": 0,
                        "Number of Trips": 0,
                        "Average Distance Travelled per Trip": 0,
                        "Average Speed in Trip": 0,
                        "Total Driving Duration (hrs)": 0,
                        "Total Night Driving Duration (hrs)": 0,
                        "Total Engine Hours (hrs)": 0,
                        "Total Idling Hours (hrs)": 0,
                        "Total In Movement Duration (hrs)": 0,
                        "Fuel Consumption (litres)": 0,
                        "Mileage (kmpl)": 0,
                        // internal accumulators for weighted avg speed
                        _speedSum: 0,
                        _speedCount: 0,
                    });
                }
                const agg = aggs.get(vName);
                agg["Total Trips Length (km)"] += Number(r.totalTripLengthKm || 0);
                agg["Number of Trips"] += Number(r.tripCount || 0);
                agg["Total Driving Duration (hrs)"] += Number(r.drivingDurationH || 0);
                agg["Total Night Driving Duration (hrs)"] += Number(r.nightDrivingH || 0);
                agg["Total Engine Hours (hrs)"] += Number(r.engineHoursH || 0);
                agg["Total In Movement Duration (hrs)"] += Number(r.drivingDurationH || 0);
                agg["Total Idling Hours (hrs)"] += Number(r.idlingHoursH || 0);
                agg["Fuel Consumption (litres)"] += Number(r.fuelConsumptionL || 0);
                // Accumulate avgTripSpeed for weighted average
                const spd = Number(r.avgTripSpeed || 0);
                if (spd > 0) {
                    agg._speedSum += spd;
                    agg._speedCount += 1;
                }
            }

            for (const agg of aggs.values()) {
                const trips = agg["Number of Trips"];
                const dist = agg["Total Trips Length (km)"];
                const fuel = agg["Fuel Consumption (litres)"];

                if (trips > 0) {
                    agg["Average Distance Travelled per Trip"] = Number((dist / trips).toFixed(2));
                }
                if (fuel > 0) {
                    agg["Mileage (kmpl)"] = Number((dist / fuel).toFixed(2));
                }
                if (agg._speedCount > 0) {
                    agg["Average Speed in Trip"] = Number((agg._speedSum / agg._speedCount).toFixed(2));
                }

                agg["Total Trips Length (km)"] = Number(dist.toFixed(2));
                agg["Total Driving Duration (hrs)"] = Number(agg["Total Driving Duration (hrs)"].toFixed(2));
                agg["Total Engine Hours (hrs)"] = Number(agg["Total Engine Hours (hrs)"].toFixed(2));
                agg["Total Idling Hours (hrs)"] = Number(agg["Total Idling Hours (hrs)"].toFixed(2));
                agg["Total In Movement Duration (hrs)"] = Number(agg["Total In Movement Duration (hrs)"].toFixed(2));
                agg["Fuel Consumption (litres)"] = Number(fuel.toFixed(2));

                // Clean up internal fields
                delete agg._speedSum;
                delete agg._speedCount;
            }

            // Sort by Total Trips Length descending
            finalRows = Array.from(aggs.values()).sort((a, b) =>
                b["Total Trips Length (km)"] - a["Total Trips Length (km)"]
            );
        } else {
            finalRows = rows;
        }

        const columnsOrder = [
            "Vehicle", "Total Trips Length (km)", "Number of Trips",
            "Average Distance Travelled per Trip", "Average Speed in Trip",
            "Total Driving Duration (hrs)", "Total Night Driving Duration (hrs)",
            "Total Engine Hours (hrs)", "Total Idling Hours (hrs)",
            "Total In Movement Duration (hrs)", "Fuel Consumption (litres)",
            "Mileage (kmpl)",
        ];

        const csv = Papa.unparse(finalRows, { columns: columnsOrder });
        downloadBlob(csv, `FleetPerformance_${ops}_${period}_${new Date().toISOString().slice(0, 10)}.csv`);
    };

    const dlGeofence = async () => {
        const base = api(ops, "geofjson");

        const url = `${base}?limit=500&_t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let rows = Array.isArray(data?.data) ? data.data : [];
        if (rows.length === 0) return alert("No geofence data available.");

        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        const csv = Papa.unparse(rows);
        downloadBlob(csv, `GeofenceReport_${ops}_${new Date().toISOString().slice(0, 10)}.csv`);
    };

    const dlNightDrivers = async (tf: TfAll) => {
        const base = api(ops, "nightDriving")?.replace(/\/+$/, "");
        if (!base) throw new Error("API not configured");

        const endpoint = /\/night-driving$/.test(base) ? base : `${base}/night-driving`;
        const winParam = tf === "1 day" ? "1d" : tf === "7 days" ? "7d" : "30d";
        const url = `${endpoint}?window=${winParam}&_t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // Check window warning
        if (json?.window && json.window !== "latest" && json.window !== winParam && json.window !== `${winParam}d`) {
            console.warn(`[NightDrivers] API returned window ${json.window} but requested ${winParam}`);
        }

        const payload = json?.results ?? json ?? {};

        const ranks: any[] =
            Array.isArray(payload?.ranks) ? payload.ranks :
                Array.isArray(payload?.data) ? payload.data :
                    [];

        if (!ranks.length) return alert("No Night Drivers data.");

        let rows = ranks.map((r: any) => ({
            rank: r.rank ?? r.sr_no ?? "",
            vehicle_number: r.vehicle_number ?? r.vehicle ?? r.vehicle_name ?? r["Vehicle"] ?? "",
            night_driving_hours: Number(r.night_driving_hours ?? r.night_hours ?? r["Night Driving Hours"] ?? 0),
        }));

        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        const csv = Papa.unparse(rows);
        downloadBlob(csv, `NightDrivers_${ops}_${winParam}_${new Date().toISOString().slice(0, 10)}.csv`);
    };

    const dlSpeedViolators = async (tf: TfAll) => {
        const base = api(ops, "speedViolations");

        const win = speedWindow(tf);
        const url = `${base}?window=${win}&limit=100&_t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();

        const payload = raw?.status ? raw : (raw?.body ? JSON.parse(raw.body) : raw);
        let rows = payload?.violators ?? payload?.top_violators ?? [];

        if (!rows?.length) return alert("No Speed Violators data.");

        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        const csv = Papa.unparse(rows);
        downloadBlob(csv, `SpeedViolators_${ops}_${win}_${new Date().toISOString().slice(0, 10)}.csv`);
    };

    const dlFuelExpense = async (tf: TfFuel) => {
        const base = api(ops, "fuelExpense")?.replace(/\/+$/, "");
        if (!base) throw new Error("API not configured");

        const windowParam = fuelWindow(tf);
        const shortWin = windowParam === "last7days" ? "7d" : "30d";

        const prefer = /\/fuel-expense\/?$/.test(base)
            ? `${base}?_t=${Date.now()}`
            : `${base}/fuel-expense?_t=${Date.now()}`;

        const tryUrls = [
            `${prefer}&window=${windowParam}`, `${prefer}&period=${windowParam}`,
            `${prefer}&window=${shortWin}`, `${prefer}&period=${shortWin}`,
            `${base}?window=${windowParam}&_t=${Date.now()}`, `${base}?period=${windowParam}&_t=${Date.now()}`,
            `${base}?window=${shortWin}&_t=${Date.now()}`, `${base}?period=${shortWin}&_t=${Date.now()}`,
        ];

        let json: any = null;
        let ok = false;
        for (const url of tryUrls) {
            try {
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) continue;
                json = await res.json();
                ok = true;
                break;
            } catch { }
        }
        if (!ok) throw new Error("Fuel expense API not reachable");

        const extractFuelExpenseList = (json: any): any[] => {
            if (!json) return [];
            if (Array.isArray(json)) return json;
            const dashList = windowParam === "last7days" ? json?.results?.last7days?.fuel_expense : json?.results?.last30days?.fuel_expense;
            if (Array.isArray(dashList)) return dashList;
            if (Array.isArray(json?.fuel_expense)) return json.fuel_expense;
            if (Array.isArray(json?.data?.fuel_expense)) return json.data.fuel_expense;
            return [];
        };

        const list = extractFuelExpenseList(json);
        if (!list.length) return alert("No Fuel Expense data.");

        let rows = list.map((r: any) => {
            const motion = Number(r.motion_usd ?? r.motionUSD ?? r.motion ?? 0);
            const idle = Number(r.idle_usd ?? r.idleUSD ?? r.idle ?? 0);
            return {
                date: r.date ?? r.day ?? "",
                motion_usd: Number(motion.toFixed(2)),
                idle_usd: Number(idle.toFixed(2)),
                total_usd: Number((motion + idle).toFixed(2)),
            };
        });

        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        const csv = Papa.unparse(rows);
        downloadBlob(csv, `FuelExpense_${ops}_${windowParam}_${new Date().toISOString().slice(0, 10)}.csv`);
    };

    const dlBelowAvg = async (tf: TfAll) => {
        const base = api(ops, "belowAvgDriving")?.replace(/\/+$/, "");
        if (!base) throw new Error("API not configured");

        const url = `${base}?_t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (!json?.data) return alert("No Below Avg Driving data found.");

        const periodKey = windowKey(tf);
        const vehiclesRaw = json.data[periodKey];
        const vehicles: any[] = Array.isArray(vehiclesRaw) ? vehiclesRaw : [];

        if (!vehicles.length) {
            return alert(`No vehicles found below target distance for ${tf}.`);
        }

        let rows = vehicles.map((v: any) => {
            const timeFrame = v["time frame"] ?? v.time_frame ?? periodKey;
            const totalKms = v.total_kms_travelled ?? v.total_km ?? 0;
            const targetKms = v.target_kms ?? 300;
            const utilization = v["utilization%"] ?? v.utilization_pct ?? 0;

            return {
                "time frame": timeFrame,
                tracker_name: v.tracker_name,
                total_kms_travelled: Number(totalKms ?? 0),
                target_kms: Number(targetKms ?? 0),
                total_drive_hrs: Number(v.total_drive_hrs ?? 0),
                "utilization%": Number(utilization ?? 0),
            };
        });

        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        const csv = Papa.unparse(rows);
        const filename = `BelowAvgDriving_${ops}_${periodKey}_${json.anchor_date || new Date().toISOString().split('T')[0]}.csv`;
        downloadBlob(csv, filename);
    };

    const dlAboveAvg = async (tf: TfAll) => {
        const base = api(ops, "aboveAvgDriving")?.replace(/\/+$/, "");
        if (!base) throw new Error("API not configured");

        const url = `${base}?_t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (!json?.data) return alert("No Above Avg Driving data found.");

        const periodKey = windowKey(tf);
        const vehiclesRaw = json.data[periodKey];
        const vehicles: any[] = Array.isArray(vehiclesRaw) ? vehiclesRaw : [];

        if (!vehicles.length) {
            return alert(`No vehicles found above target distance for ${tf}.`);
        }

        // Sort by utilization% DESC (top performers first)
        const sorted = [...vehicles].sort((a: any, b: any) => {
            const bUtil = Number(b["utilization%"] ?? b.utilization_pct ?? 0);
            const aUtil = Number(a["utilization%"] ?? a.utilization_pct ?? 0);
            return bUtil - aUtil;
        });

        let rows = sorted.map((v: any) => {
            const timeFrame = v["time frame"] ?? v.time_frame ?? periodKey;
            const totalKms = v.total_kms_travelled ?? v.total_km ?? 0;
            const targetKms = v.target_kms ?? 300;
            const utilization = v["utilization%"] ?? v.utilization_pct ?? 0;

            return {
                "time frame": timeFrame,
                tracker_name: v.tracker_name,
                total_kms_travelled: Number(totalKms ?? 0),
                target_kms: Number(targetKms ?? 0),
                total_drive_hrs: Number(v.total_drive_hrs ?? 0),
                "utilization%": Number(utilization ?? 0),
            };
        });

        rows = filterByVehicle(rows);
        if (!rows.length) return alert("No data for the selected vehicle.");

        const csv = Papa.unparse(rows);
        const filename = `AboveAvgDriving_${ops}_${periodKey}_${json.anchor_date || new Date().toISOString().split('T')[0]}.csv`;
        downloadBlob(csv, filename);
    };

    const dlLiveStatus = async () => {
        const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!MAPBOX_TOKEN) {
            console.error("Missing Mapbox token for reverse geocoding");
        }

        setDownloadProgress("Fetching fleet data...");
        const viewName = ops === 'zambia' ? 'v_zambia_fleet_latest' : 'v_tanzania_fleet_latest';
        const regionCode = ops === 'zambia' ? 'ZM' : 'TZ';

        const { data: fleet, error } = await supabase
            .from(viewName)
            .select('*');

        if (error) {
            alert("Failed to fetch live fleet data.");
            throw error;
        }
        if (!fleet || fleet.length === 0) return alert("No live fleet data found.");

        let rows = [...fleet].filter(v => isCleanVehicleLabel(v.tracker_name));

        setDownloadProgress("Checking geofence status...");
        const { data: activeGeofences, error: gfError } = await supabase
            .from('live_geofence')
            .select('tracker_id, geofence_name, entry_time, exit_time')
            .gte('exit_time', new Date(Date.now() - 10 * 60 * 1000).toISOString())
            .order('entry_time', { ascending: false });

        if (gfError) {
            console.error("Failed to fetch live_geofence data:", gfError);
        }

        const geofenceMap = new Map<number, string>();
        if (activeGeofences) {
            for (const visit of activeGeofences) {
                if (!geofenceMap.has(visit.tracker_id)) {
                    geofenceMap.set(visit.tracker_id, visit.geofence_name);
                }
            }
        }

        // Build unique coordinate pairs for non-geofenced vehicles only
        const uniqueCoords = new Map<string, string | null>(); // key: "lat,lng" → value: location string

        for (const vehicle of rows) {
            if (geofenceMap.has(vehicle.tracker_id)) continue;
            
            if (vehicle.lat && vehicle.lng) {
                const key = `${vehicle.lat},${vehicle.lng}`;
                if (!uniqueCoords.has(key)) {
                    uniqueCoords.set(key, null); // placeholder
                }
            }
        }

        const coordsArray = Array.from(uniqueCoords.keys());
        
        // Geocode only unique coordinates
        for (let i = 0; i < coordsArray.length; i++) {
            const key = coordsArray[i];
            const [latStr, lngStr] = key.split(',');
            setDownloadProgress(`Geocoding locations... (${i + 1}/${coordsArray.length} unique coordinates)`);

            let location = 'Location unavailable';
            if (MAPBOX_TOKEN) {
                try {
                    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lngStr},${latStr}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,region,country&language=en`);
                    if (res.ok) {
                        const json = await res.json();
                        if (json.features && json.features.length > 0) {
                            let placeName = '';
                            let regionName = '';
                            let countryName = '';

                            for (const feature of json.features) {
                                if (feature.place_type.includes('place') || feature.place_type.includes('locality')) {
                                    if (!placeName) placeName = feature.text;
                                }
                                if (feature.place_type.includes('region')) {
                                    if (!regionName) regionName = feature.text;
                                }
                                if (feature.place_type.includes('country')) {
                                    if (!countryName) countryName = feature.text;
                                }
                            }
                            
                            const parts = [placeName, regionName, countryName].filter(Boolean);
                            if (parts.length > 0) {
                                location = parts.join(', ');
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Mapbox reverse geocoding failed for ${key}:`, err);
                }
            }

            uniqueCoords.set(key, location);
            
            // 100ms delay between calls to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        setDownloadProgress("Building CSV...");

        // Then assign locations back to vehicles
        const finalRows = rows.map(vehicle => {
            let finalLocation = 'Location unavailable';
            if (geofenceMap.has(vehicle.tracker_id)) {
                finalLocation = geofenceMap.get(vehicle.tracker_id) || 'Location unavailable';
            } else if (vehicle.lat && vehicle.lng) {
                const key = `${vehicle.lat},${vehicle.lng}`;
                finalLocation = uniqueCoords.get(key) || 'Location unavailable';
            }
            
            return {
                tracker_id: vehicle.tracker_id,
                tracker_name: vehicle.tracker_name,
                ops_region: vehicle.ops_region,
                location: finalLocation,
                lat: vehicle.lat,
                lng: vehicle.lng,
                speed: vehicle.speed,
                movement_status: vehicle.movement_status,
                ignition: vehicle.ignition,
                connection_status: vehicle.connection_status,
                last_seen_date: vehicle.last_seen_date,
                last_seen_time: vehicle.last_seen_time,
            };
        });

        const columnsOrder = [
            "tracker_id", "tracker_name", "ops_region", "location", "lat", "lng",
            "speed", "movement_status", "ignition", "connection_status",
            "last_seen_date", "last_seen_time"
        ];

        const csv = Papa.unparse(finalRows, { columns: columnsOrder });
        
        // Use today's date in EAT (East Africa Time) which is UTC+3
        const nowEAT = new Date(Date.now() + 3 * 60 * 60 * 1000);
        const dateStr = nowEAT.toISOString().split('T')[0];
        
        downloadBlob(csv, `live_status_${regionCode}_${dateStr}.csv`);
    };

    /* ── Geofence List Download (Direct) ── */

    const dlGeofenceList = async () => {
        const SESSION_KEYS = {
            zambia: import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM,
            tanzania: import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ,
        };
        const sessionKey = SESSION_KEYS[ops as keyof typeof SESSION_KEYS];

        if (!sessionKey) return alert("Session key configuration missing for " + ops);

        try {
            const zones = await NavixyService.listZones(sessionKey);
            if (!zones || !zones.length) return alert("No geofences found.");

            const rows = zones.map((z: any, index: number) => {
                let shape = "Unknown";
                if (z.type === 'circle' && z.center) {
                    shape = `CIRCLE (Lat: ${z.center.lat}, Lng: ${z.center.lng}, Radius: ${z.radius}m)`;
                } else if (z.points && Array.isArray(z.points)) {
                    // Format as standard WKT-like or simple list
                    const pts = z.points.map((p: any) => `(${p.lat}, ${p.lng})`).join(", ");
                    shape = `${z.type.toUpperCase()} [${pts}]`;
                }

                return {
                    "Sr No": index + 1,
                    "Geofence Name": z.label,
                    "Shape": shape
                };
            });

            const csv = Papa.unparse(rows);
            downloadBlob(csv, "Geofence_list.csv");
        } catch (err) {
            console.error("Failed to fetch geofence list:", err);
            alert("Failed to download geofence list.");
        }
    };

    const handleDownloadGeofenceList = async () => {
        if (downloading) return;
        setDownloading(true);
        try {
            await dlGeofenceList();
        } finally {
            setDownloading(false);
        }
    };

    /* ── Geofence Asset Count Download (TZ Only) ── */
    const dlGeofenceAssetCount = async () => {
        setDownloadProgress("Preparing geofence snapshot...");

        // Fetch CSV rows from report view
        const { data: rows, error: reportError } = await supabase
            .from('v_geofence_report_csv')
            .select('*');

        if (reportError) {
            alert('Failed to fetch geofence report data.');
            throw reportError;
        }

        if (!rows || rows.length === 0) {
            return alert('No geofence report data available.');
        }

        // Build EAT timestamp
        const nowEAT = new Date(Date.now() + 3 * 60 * 60 * 1000);
        const dateStr = nowEAT.toISOString().split('T')[0];
        const fileTimeStr = `${String(nowEAT.getUTCHours()).padStart(2, '0')}-${String(nowEAT.getUTCMinutes()).padStart(2, '0')}`;

        // Build CSV manually with header lines
        const csvHeader = 'Role,Geofence Name,Type,Parent Geofence,Total Vehicles,Moving,Parked';

        const csvRows = rows.map((r: any) => {
            const role = r.geofence_role || '';
            const name = (r.geofence_name || '').replace(/,/g, ' ');
            const type = (r.geofence_type || '').replace(/,/g, ' ');
            const parent = (r.parent_geofence || '').replace(/,/g, ' ');
            const vehicles = r.vehicle_count ?? 0;
            const moving = r.moving ?? 0;
            const parked = r.parked ?? 0;
            return `${role},${name},${type},${parent},${vehicles},${moving},${parked}`;
        });

        const csvContent = [csvHeader, ...csvRows].join('\n');
        const filename = `geofence_asset_count_${dateStr}_${fileTimeStr}.csv`;

        downloadBlob(csvContent, filename);
    };

    /* ── Tracker List Download (Direct API) ── */
    const dlTrackerList = async () => {
        const SESSION_KEYS = {
            zambia: import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM,
            tanzania: import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ,
        };
        const sessionKey = SESSION_KEYS[ops as keyof typeof SESSION_KEYS];

        if (!sessionKey) return alert("Session key configuration missing for " + ops);

        try {
            const trackers = await NavixyService.listTrackers(sessionKey);
            if (!trackers || !trackers.length) return alert("No trackers found for this API Key.");

            const rows = trackers
                .filter((t: any) => isCleanVehicleLabel(t.label || t.name))
                .map((t: any, index: number) => {
                    return {
                        "Sr No": index + 1,
                        "Tracker ID": t.id,
                        "Name": t.label || t.name || "",
                        "Brand / Type": t.source?.vehicle_type_id || "Unknown",
                        "Sim. Number": t.source?.phone || "",
                        "Device Model": t.source?.model || "",
                        "Created At": t.source?.creation_date || "",
                        "Clone": t.clone ? "Yes" : "No"
                    };
                });

            const csv = Papa.unparse(rows);
            downloadBlob(csv, `All_Trackers_${ops}_${new Date().toISOString().slice(0, 10)}.csv`);
        } catch (err) {
            console.error("Failed to fetch tracker list:", err);
            alert("Failed to download tracker list.");
        }
    };

    /* ──────────── Can Download? ──────────── */

    const canDownload = useMemo(() => {
        if (!selectedReport || !selectedReport.hasApi) return false;
        if (selectedReport.hasTimeframe && !selectedTf) return false;
        if (scope === "vehicle" && !selectedVehicle) return false;
        return true;
    }, [selectedReport, selectedTf, scope, selectedVehicle]);

    /* ================================================================== */
    /*  RENDER                                                             */
    /* ================================================================== */

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex-none px-6 py-3 z-30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {selectedReport && (
                        <button
                            onClick={goBack}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors mr-1"
                        >
                            <ArrowLeft size={18} className="text-muted-foreground" />
                        </button>
                    )}
                    <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
                        <FileText size={30} />
                    </div>
                    <h1 className="text-lg font-semibold text-foreground tracking-tight">
                        {selectedReport ? selectedReport.title : "Reports Center"}
                    </h1>
                    {selectedReport && !selectedReport.hasApi && (
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase bg-amber-100 text-amber-700 rounded-full">
                            Coming Soon
                        </span>
                    )}
                </div>

                {/* Toggle */}
                <div className="flex items-center bg-muted rounded-full p-1 border border-border shadow-sm">
                    <button
                        onClick={() => setOps('tanzania')}
                        className={cn(
                            "px-3 py-1 text-xs font-medium rounded-full transition-all duration-200",
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
                            "px-3 py-1 text-xs font-medium rounded-full transition-all duration-200",
                            ops === 'zambia'
                                ? "bg-blue-500 text-white shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        ZM Ops
                    </button>
                </div>
            </div>

            {/* Body */}
            <main className="flex-1 px-6 pb-6 overflow-auto">

                {/* ── LIST VIEW ── */}
                {!selectedReport && (
                    <div className="h-full flex flex-col">
                        <p className="text-sm text-muted-foreground mb-2 flex-none">
                            Select a report to configure and download
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full content-start">
                            {REPORT_TYPES.map((report) => {
                                const Icon = report.icon;
                                const isTzLocked = report.tzOnly && ops !== 'tanzania';
                                return (
                                    <button
                                        key={report.id}
                                        disabled={isTzLocked}
                                        title={isTzLocked ? 'Available for TZ Ops only' : undefined}
                                        onClick={() => {
                                            if (isTzLocked) return;
                                            if (report.id === 'geofence-list') {
                                                handleDownloadGeofenceList();
                                            } else if (report.id === 'tracker-list') {
                                                if (!downloading) {
                                                    setDownloading(true);
                                                    dlTrackerList().finally(() => setDownloading(false));
                                                }
                                            } else if (report.id === 'geofence-asset-count') {
                                                if (!downloading) {
                                                    setDownloading(true);
                                                    setDownloadProgress("Preparing geofence snapshot...");
                                                    dlGeofenceAssetCount().finally(() => {
                                                        setDownloading(false);
                                                        setDownloadProgress("");
                                                    });
                                                }
                                            } else {
                                                openReport(report);
                                            }
                                        }}
                                        className={cn(
                                            "relative bg-surface-card rounded-xl border border-border p-5 flex flex-col items-start transition-all duration-200 group text-left",
                                            isTzLocked
                                                ? "opacity-50 cursor-not-allowed"
                                                : "hover:shadow-lg hover:border-primary/20"
                                        )}
                                    >
                                        {/* Top Row: Icon + Title + Status */}
                                        <div className="flex items-center w-full gap-4 mb-2">
                                            <div className={cn("p-3 rounded-lg flex-shrink-0", isTzLocked ? "bg-muted" : report.color)}>
                                                <Icon size={26} strokeWidth={1.5} className={isTzLocked ? "text-muted-foreground" : report.iconColor} />
                                            </div>

                                            <div className="flex-1 min-w-0 flex items-center justify-between">
                                                <div className="min-w-0">
                                                    <h3 className={cn(
                                                        "text-lg font-semibold leading-tight truncate pr-4 transition-colors",
                                                        isTzLocked ? "text-muted-foreground" : "text-foreground group-hover:text-primary"
                                                    )}>
                                                        {report.title}
                                                    </h3>
                                                    {report.subtitle && (
                                                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                                            {report.subtitle}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {!report.hasApi && (
                                            <div className="absolute top-4 right-4">
                                                <span className="w-2 h-2 rounded-full bg-amber-400 block shadow-sm" />
                                            </div>
                                        )}

                                        {isTzLocked && (
                                            <div className="absolute top-4 right-4">
                                                <Lock size={14} className="text-muted-foreground/50" />
                                            </div>
                                        )}

                                        {/* Description + Chevron/Download Row */}
                                        <div className="w-full pl-1 flex items-center justify-between mt-1">
                                            <p className="text-xs text-muted-foreground truncate flex-1">
                                                {isTzLocked ? "Available for TZ Ops only" : (report.id === 'geofence-list' || report.id === 'tracker-list' || report.id === 'geofence-asset-count') ? "Click to download directly" : (report.hasApi ? "Click to download" : "Coming soon")}
                                            </p>
                                            {isTzLocked ? (
                                                <Lock size={16} className="text-muted-foreground/30 flex-shrink-0 ml-2" />
                                            ) : (report.id === 'geofence-list' || report.id === 'tracker-list' || report.id === 'geofence-asset-count') ? (
                                                <Download
                                                    size={18}
                                                    className={cn(
                                                        "text-muted-foreground/50 group-hover:text-primary transition-colors flex-shrink-0 ml-2",
                                                        downloading && "animate-pulse"
                                                    )}
                                                />
                                            ) : (
                                                <ChevronRight
                                                    size={18}
                                                    className="text-muted-foreground/50 group-hover:text-primary transition-colors flex-shrink-0 ml-2"
                                                />
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── DETAIL VIEW ── */}
                {selectedReport && (
                    <div className="max-w-2xl mx-auto">

                        {/* About This Report */}
                        <section className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <Info size={14} className="text-muted-foreground" />
                                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    About This Report
                                </h2>
                            </div>
                            <div className="bg-surface-card rounded-xl border border-border p-4">
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {selectedReport.description}
                                </p>
                            </div>
                        </section>

                        {/* Timeframe */}
                        {selectedReport.hasTimeframe && (
                            <section className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                    <Clock size={14} className="text-muted-foreground" />
                                    <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                        Time Period
                                    </h2>
                                </div>
                                <div className="bg-surface-card rounded-xl border border-border p-4">
                                    <div className="flex flex-wrap gap-2">
                                        {getTimeframeOptions(selectedReport.id).map((opt) => (
                                            <button
                                                key={opt}
                                                onClick={() => setSelectedTf(opt)}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border",
                                                    selectedTf === opt
                                                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80 hover:border-border"
                                                )}
                                            >
                                                {opt}
                                            </button>
                                        ))}
                                    </div>

                                </div>
                            </section>
                        )}

                        {/* Report Scope */}
                        <section className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <Truck size={14} className="text-muted-foreground" />
                                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                    Report Scope
                                </h2>
                            </div>
                            <div className="bg-surface-card rounded-xl border border-border p-4">
                                <div className="flex gap-2 mb-3">
                                    <button
                                        onClick={() => { setScope("fleet"); setSelectedVehicle(""); setVehicleSearch(""); }}
                                        className={cn(
                                            "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border flex items-center gap-2",
                                            scope === "fleet"
                                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                                : "bg-muted text-muted-foreground border-border hover:bg-muted/80 hover:border-border"
                                        )}
                                    >
                                        <Truck size={14} />
                                        Entire Fleet
                                    </button>
                                    {selectedReport.id !== "geofence-report" && (
                                        <button
                                            onClick={() => setScope("vehicle")}
                                            className={cn(
                                                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 border flex items-center gap-2",
                                                scope === "vehicle"
                                                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80 hover:border-border"
                                            )}
                                        >
                                            <Search size={14} />
                                            Specific Vehicle
                                        </button>
                                    )}
                                </div>

                                {/* Vehicle Search */}
                                {scope === "vehicle" && (
                                    <div className="mt-3">
                                        <div className="relative">
                                            <Search
                                                size={14}
                                                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                            />
                                            <input
                                                type="text"
                                                value={vehicleSearch}
                                                onChange={(e) => {
                                                    setVehicleSearch(e.target.value);
                                                    setSelectedVehicle("");
                                                }}
                                                placeholder={loadingVehicles ? "Loading vehicles..." : "Search vehicle name or number..."}
                                                className="w-full pl-9 pr-4 py-2.5 text-sm border border-border rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all bg-muted text-foreground placeholder:text-muted-foreground"
                                            />
                                        </div>

                                        {/* Selected Badge */}
                                        {selectedVehicle && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
                                                    <Truck size={12} />
                                                    {selectedVehicle}
                                                    <button
                                                        onClick={() => { setSelectedVehicle(""); setVehicleSearch(""); }}
                                                        className="ml-1 text-blue-400 hover:text-blue-600"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            </div>
                                        )}

                                        {/* Suggestions */}
                                        {!selectedVehicle && vehicleSuggestions.length > 0 && (
                                            <div className="mt-2 border border-border rounded-lg bg-surface-card shadow-sm max-h-48 overflow-y-auto">
                                                {vehicleSuggestions.map((v) => (
                                                    <button
                                                        key={v}
                                                        onClick={() => {
                                                            setSelectedVehicle(v);
                                                            setVehicleSearch(v);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary transition-colors border-b border-border/50 last:border-b-0"
                                                    >
                                                        {v}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {!selectedVehicle && !loadingVehicles && vehicleSuggestions.length === 0 && vehicleSearch && (
                                            <p className="mt-2 text-xs text-muted-foreground">No vehicles found matching "{vehicleSearch}"</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Download Button */}
                        <button
                            onClick={handleDownload}
                            disabled={!canDownload || downloading}
                            className={cn(
                                "w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-wider transition-all duration-200",
                                !canDownload || downloading
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg active:scale-[0.98]"
                            )}
                        >
                            {downloading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    {downloadProgress || "Processing..."}
                                </>
                            ) : !selectedReport.hasApi ? (
                                <>Coming Soon</>
                            ) : (
                                <>
                                    <Download size={16} />
                                    Download CSV
                                </>
                            )}
                        </button>

                        {/* Helper text */}
                        {!canDownload && !downloading && selectedReport.hasApi && (
                            <p className="text-center text-xs text-muted-foreground mt-2">
                                {selectedReport.hasTimeframe && !selectedTf
                                    ? "Select a time period to continue"
                                    : scope === "vehicle" && !selectedVehicle
                                        ? "Select a vehicle to continue"
                                        : ""}
                            </p>
                        )}
                    </div>
                )
                }
            </main >
        </div >
    );
}
