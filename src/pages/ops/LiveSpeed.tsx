import { useState, useEffect, useRef, useMemo } from 'react';
import { useOps } from '@/context/OpsContext';
import { useAuth } from '@/context/AuthContext';
import { NavixyService } from '@/services/navixy';
import { useNavixyRealtime } from '@/hooks/useNavixyRealtime';
import { Gauge, Search, Download, ShieldCheck, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Mock or calculated types for our table
interface SpeedViolation {
    id: number;
    trackerId: number;
    vehicleName: string;
    startTime: string; // ISO string
    duration: string; // e.g., "5m 20s"
    maxSpeed: number;
    avgSpeed: number;
    limit: number;
    location: string;
    status: 'active' | 'recorded';
}

export default function LiveSpeed() {
    const { ops, setOps } = useOps();
    const { checkPermission } = useAuth();

    // Map Ops to Region
    const region = ops === 'tanzania' ? 'TZ' : 'ZM';
    const SESSION_KEYS = {
        TZ: import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ,
        ZM: import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM,
    };
    const sessionKey = SESSION_KEYS[region];

    // State
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});
    const [violations, setViolations] = useState<SpeedViolation[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showCriticalOnly, setShowCriticalOnly] = useState(false);

    // CSV Export State
    const [isCustomExport, setIsCustomExport] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const [selectedViolationIds, setSelectedViolationIds] = useState<Set<number>>(new Set());

    // 1. Fetch Tracker Labels
    useEffect(() => {
        if (!sessionKey) return;
        NavixyService.listTrackers(sessionKey).then((list: any[]) => {
            if (list?.length) {
                const labels: Record<number, string> = {};
                list.forEach((t: any) => {
                    const id = t.source?.id || t.id;
                    if (id) labels[id] = t.label;
                });
                setTrackerLabels(labels);
            }
        });
    }, [sessionKey]);

    // 2. Real-time Hook
    const allTrackerIds = useMemo(() => {
        return Object.keys(trackerLabels).length > 0 ? Object.keys(trackerLabels).map(Number) : [];
    }, [trackerLabels]);

    // Use ALL trackers when labels are loaded
    const { trackerStates } = useNavixyRealtime(allTrackerIds.length > 0 ? allTrackerIds : [], sessionKey || '');

    // 3. Detect Violations Logic
    const ongoingViolations = useRef<Record<number, { startTime: number, maxSpeed: number, count: number, sumSpeed: number }>>({});
    const SPEED_LIMIT = 70;

    // Compute Active Violations for Display (Derived from real-time state)
    const activeViolations: SpeedViolation[] = useMemo(() => {
        if (!trackerStates) return [];
        return Object.entries(trackerStates)
            .filter(([_, state]) => (state.gps?.speed || 0) > SPEED_LIMIT)
            .map(([idStr, state]) => {
                const id = Number(idStr);
                const speed = state.gps.speed;
                const name = trackerLabels[id] || `Vehicle ${id}`;

                // Get or Init tracking data (init if this render caught it before the effect)
                const track = ongoingViolations.current[id] || {
                    startTime: Date.now(),
                    maxSpeed: speed,
                    count: 1,
                    sumSpeed: speed
                };

                // Calculate duration
                const durationMs = Date.now() - track.startTime;

                return {
                    id: id, // Use tracker ID for active ones to dedupe
                    trackerId: id,
                    vehicleName: name,
                    startTime: new Date(track.startTime).toISOString(),
                    duration: formatDuration(durationMs),
                    maxSpeed: Math.max(track.maxSpeed, speed), // Show current max
                    avgSpeed: Math.round(track.sumSpeed / track.count),
                    limit: SPEED_LIMIT,
                    location: `${state.gps.location.lat.toFixed(4)}, ${state.gps.location.lng.toFixed(4)}`,
                    status: 'active'
                };
            });
    }, [trackerStates, trackerLabels]);

    useEffect(() => {
        if (!trackerStates) return;

        Object.entries(trackerStates).forEach(([idStr, state]: [string, any]) => {
            const id = Number(idStr);
            const speed = state.gps?.speed || 0;
            const name = trackerLabels[id] || `Vehicle ${id}`;
            const isSpeeding = speed > SPEED_LIMIT;

            if (isSpeeding) {
                if (!ongoingViolations.current[id]) {
                    // New Violation Start
                    ongoingViolations.current[id] = {
                        startTime: Date.now(),
                        maxSpeed: speed,
                        count: 1,
                        sumSpeed: speed,
                    };
                } else {
                    // Update stats
                    const current = ongoingViolations.current[id];
                    current.maxSpeed = Math.max(current.maxSpeed, speed);
                    current.count++;
                    current.sumSpeed += speed;
                }
            } else {
                // Not speeding - check if we need to commit a finished violation
                if (ongoingViolations.current[id]) {
                    const v = ongoingViolations.current[id];
                    const durationMs = Date.now() - v.startTime;

                    // Only record if it lasted meaningful time or had significant speed (avoid GPS drift noise)
                    if (durationMs > 2000) {
                        const newViolation: SpeedViolation = {
                            id: Math.random(),
                            trackerId: id,
                            vehicleName: name,
                            startTime: new Date(v.startTime).toISOString(),
                            duration: formatDuration(durationMs),
                            maxSpeed: v.maxSpeed,
                            avgSpeed: Math.round(v.sumSpeed / v.count),
                            limit: SPEED_LIMIT,
                            location: `${state.gps.location.lat.toFixed(4)}, ${state.gps.location.lng.toFixed(4)}`,
                            status: 'recorded'
                        };
                        setViolations(prev => [newViolation, ...prev].slice(0, 100)); // Keep last 100
                    }
                    delete ongoingViolations.current[id];
                }
            }
        });
    }, [trackerStates, trackerLabels]);

    // Filter
    // Merged List
    const allViolations = useMemo(() => {
        return [...activeViolations, ...violations];
    }, [activeViolations, violations]);

    // Critical Count
    const criticalCount = useMemo(() => {
        return allViolations.filter(v => v.maxSpeed >= 80).length;
    }, [allViolations]);

    // Filter Logic
    const filteredViolations = useMemo(() => {
        let result = allViolations;

        if (searchQuery) {
            result = result.filter(v =>
                v.vehicleName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                v.maxSpeed.toString().includes(searchQuery)
            );
        }

        if (showCriticalOnly) {
            result = result.filter(v => v.maxSpeed >= 80);
        }

        return result;
    }, [allViolations, searchQuery, showCriticalOnly]);

    // Export
    const handleDownload = () => {
        const headers = ["Vehicle", "Status", "Start Time", "Duration", "Max Speed (km/h)", "Avg Speed (km/h)", "Location"];

        const rowsToExport = isCustomExport && selectedViolationIds.size > 0
            ? filteredViolations.filter(v => selectedViolationIds.has(v.id))
            : filteredViolations;

        const csvContent = [
            headers.join(','),
            ...rowsToExport.map(v => [
                `"${v.vehicleName}"`,
                `"${v.status}"`,
                `"${new Date(v.startTime).toLocaleString()}"`,
                `"${v.duration}"`,
                v.maxSpeed,
                v.avgSpeed,
                `"${v.location}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `speed_violations_${region}_${new Date().toISOString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setExportMenuOpen(false);
    };

    const toggleSelection = (id: number) => {
        const next = new Set(selectedViolationIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedViolationIds(next);
    };

    return (
        <div className="flex flex-col h-full bg-surface-main p-8 gap-6 overflow-hidden">
            {/* Header */}
            <div className="bg-surface-card border border-border rounded-3xl px-8 py-6 flex items-center justify-between shadow-sm shrink-0">
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter leading-none flex items-center gap-2">
                            <Gauge className="text-primary fill-primary/20" size={24} />
                            Live Speed Violations
                        </h1>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Real-time Safety Monitoring</span>
                            <div className="w-1 h-1 rounded-full bg-border" />
                            <span className="text-[10px] font-black text-primary uppercase tracking-widest">{region} Operations</span>
                        </div>
                    </div>

                    {/* Critical Attention Box */}
                    <button
                        onClick={() => setShowCriticalOnly(!showCriticalOnly)}
                        className={cn(
                            "flex items-center gap-4 p-3 rounded-2xl border transition-all text-left w-fit relative overflow-hidden group",
                            showCriticalOnly
                                ? "bg-red-50 border-red-200 shadow-md ring-2 ring-red-500/20"
                                : "bg-muted/30 border-border hover:bg-muted/50 hover:border-red-200/50"
                        )}
                    >
                        {/* Status Dot */}
                        <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                            showCriticalOnly ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground group-hover:bg-red-50 group-hover:text-red-500"
                        )}>
                            <ShieldCheck size={20} className={cn(criticalCount > 0 && "animate-pulse")} />
                        </div>

                        <div className="flex flex-col">
                            <span className={cn(
                                "text-[10px] uppercase font-black tracking-widest",
                                showCriticalOnly ? "text-red-800" : "text-muted-foreground group-hover:text-red-700"
                            )}>
                                Critical Attention
                            </span>
                            <span className={cn(
                                "text-2xl font-black leading-none",
                                showCriticalOnly ? "text-red-900" : "text-foreground group-hover:text-red-900"
                            )}>
                                {criticalCount}
                                <span className="text-xs font-bold text-muted-foreground ml-1.5 opacity-60 font-mono">
                                    VEHICLES &gt; 80 KM/H
                                </span>
                            </span>
                        </div>

                        {/* Active Indicator */}
                        {showCriticalOnly && (
                            <div className="absolute top-2 right-2 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </div>
                        )}
                    </button>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-4">
                    {/* Search */}
                    <div className="relative w-64 ring-0 focus-within:ring-2 ring-primary/20 rounded-xl transition-all">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search vehicles..."
                            className="pl-9 h-10 rounded-xl bg-muted/50 border-input text-xs font-medium focus-visible:ring-0"
                        />
                    </div>

                    {/* Ops Switch (Admin Only) */}
                    {checkPermission('admin_only') && (
                        <div className="flex bg-muted p-1 rounded-xl border border-border">
                            <button
                                onClick={() => setOps('tanzania')}
                                className={cn(
                                    "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                    ops === 'tanzania' ? "bg-surface-raised text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                TZ
                            </button>
                            <button
                                onClick={() => setOps('zambia')}
                                className={cn(
                                    "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                    ops === 'zambia' ? "bg-surface-raised text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                ZM
                            </button>
                        </div>
                    )}

                    {/* Export */}
                    <div className="relative">
                        <Button
                            variant="outline"
                            className="h-10 gap-2 rounded-xl text-xs font-bold uppercase tracking-wide"
                            onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        >
                            <Download size={14} />
                            Export
                        </Button>

                        {/* Custom Dropdown */}
                        {exportMenuOpen && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-surface-card border border-border rounded-xl shadow-xl z-50 p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-200">
                                <button
                                    className="px-3 py-2 text-left text-xs font-medium hover:bg-muted rounded-lg transition-colors"
                                    onClick={() => { setIsCustomExport(false); handleDownload(); }}
                                >
                                    Full Report (CSV)
                                </button>
                                <button
                                    className="px-3 py-2 text-left text-xs font-medium hover:bg-muted rounded-lg transition-colors"
                                    onClick={() => { setIsCustomExport(true); setExportMenuOpen(false); }}
                                >
                                    Custom Report...
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Download Action for Custom */}
                    {isCustomExport && (
                        <div className="flex items-center gap-2 animate-in fade-in">
                            <Button
                                onClick={handleDownload}
                                className="h-10 gap-2 rounded-xl text-xs font-bold uppercase tracking-wide bg-primary text-primary-foreground"
                            >
                                Download Selected ({selectedViolationIds.size})
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-xl"
                                onClick={() => { setIsCustomExport(false); setSelectedViolationIds(new Set()); }}
                            >
                                <X size={16} />
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 rounded-[30px] bg-surface-card border border-border overflow-hidden flex flex-col shadow-sm">
                    {/* Table Header Strip */}
                    <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <ShieldCheck size={16} className="text-primary" />
                            <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Recent Violations Feed</span>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                            Updates automatically • 70 KM/H Limit
                        </div>
                    </div>

                    {/* Column Headers (Grid) */}
                    <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-muted/10 border-b border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0">
                        <div className="col-span-3">Vehicle</div>
                        <div className="col-span-2">Start Time</div>
                        <div className="col-span-2">Duration</div>
                        <div className="col-span-2">Max Speed</div>
                        <div className="col-span-2">Avg Speed</div>
                        <div className="col-span-1 text-right">Status</div>
                    </div>

                    {/* List Implementation (Cards) */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                        {filteredViolations.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 gap-2">
                                <ShieldCheck size={32} />
                                <span className="text-xs uppercase tracking-widest">No recent violations detected</span>
                            </div>
                        ) : (
                            filteredViolations.map((v) => {
                                const isActive = v.status === 'active';

                                // Highlight High Speed
                                const speedClass = isActive && v.maxSpeed > 100
                                    ? "text-red-700 font-extrabold"
                                    : "text-red-500 font-bold";

                                return (
                                    <div
                                        key={v.id}
                                        className={cn(
                                            "grid grid-cols-12 gap-4 items-center p-3 rounded-xl border transition-all text-sm group",
                                            isActive
                                                ? "bg-red-50/40 border-red-100/50 hover:bg-red-50 hover:border-red-200 shadow-sm"
                                                : "bg-surface-raised border-border/40 hover:border-border hover:shadow-md hover:bg-surface-raised/80"
                                        )}
                                    >
                                        {/* Vehicle */}
                                        <div className="col-span-3 font-medium text-foreground flex items-center gap-3">
                                            {isCustomExport && (
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary bg-background shrink-0"
                                                    checked={selectedViolationIds.has(v.id)}
                                                    onChange={() => toggleSelection(v.id)}
                                                />
                                            )}
                                            <div className={cn("w-2 h-2 rounded-full shrink-0", isActive ? "bg-red-600 animate-pulse shadow-[0_0_8px_rgba(220,38,38,0.6)]" : "bg-muted-foreground/30")} />
                                            <span className="text-xs font-bold truncate">{v.vehicleName}</span>
                                        </div>

                                        {/* Start Time */}
                                        <div className="col-span-2 text-muted-foreground text-xs font-mono font-medium">
                                            {new Date(v.startTime).toLocaleTimeString()}
                                        </div>

                                        {/* Duration */}
                                        <div className="col-span-2 text-xs font-mono font-medium">{v.duration}</div>

                                        {/* Max Speed */}
                                        <div className="col-span-2 font-black">
                                            <span className={speedClass}>
                                                {Math.round(v.maxSpeed)}
                                            </span>
                                            <span className="text-[9px] text-muted-foreground font-normal ml-1">KM/H</span>
                                        </div>

                                        {/* Avg Speed */}
                                        <div className="col-span-2 font-bold text-orange-600">
                                            {Math.round(v.avgSpeed)} <span className="text-[9px] text-muted-foreground font-normal">KM/H</span>
                                        </div>

                                        {/* Status */}
                                        <div className="col-span-1 text-right">
                                            {isActive ? (
                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-[9px] font-black uppercase tracking-widest shadow-md animate-pulse">
                                                    <Zap size={10} className="fill-white" />
                                                    LIVE
                                                </div>
                                            ) : (
                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-[9px] font-black uppercase tracking-widest border border-border">
                                                    Recorded
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}
