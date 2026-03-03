import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useOps } from '@/context/OpsContext';
import { useTheme } from '@/context/ThemeProvider';
import {
    Moon, ArrowLeft, Download, MapPin, Activity, Route,
    Loader2, ArrowUpDown, Filter, ChevronDown, AlertCircle,
    Calendar, ChevronLeft, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, subDays, startOfDay, addDays } from 'date-fns';
import Map, { Marker, Popup } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
    fetchNightEventsSummary,
    fetchOvernightRestLocations,
    fetchNightDrivingLog,
} from '@/services/nightEvents';
import type {
    NightEventsSummary,
    OvernightRestLocation,
    NightDrivingLogEvent,
} from '@/services/nightEvents';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const PAGE_LIMIT = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatOpsTime(dateStr: string, currentOps: string) {
    if (!dateStr) return '';
    try {
        const tz = currentOps === 'zambia' ? 'Africa/Lusaka' : 'Africa/Dar_es_Salaam';
        return new Intl.DateTimeFormat('en-US', {
            timeZone: tz, month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(dateStr));
    } catch {
        return format(new Date(dateStr), 'MMM dd, HH:mm');
    }
}

type VehicleStatus = 'transit' | 'base' | 'unsupervised';

function getStatus(row: OvernightRestLocation): VehicleStatus {
    if (row.is_moving) return 'transit';
    if (row.in_geofence) return 'base';
    return 'unsupervised';
}

function markerColor(status: VehicleStatus) {
    return status === 'base' ? '#10b981' : status === 'transit' ? '#3b82f6' : '#ef4444';
}

// ─── Sort / Filter types ──────────────────────────────────────────────────────

type LogSort = 'latest' | 'oldest' | 'duration_desc' | 'duration_asc' | 'distance_desc' | 'distance_asc';
type LocationFilter = 'all' | 'unsupervised' | 'base' | 'transit';
type MapFilter = 'all' | 'unsupervised' | 'base' | 'transit';

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NightEvents() {
    const navigate = useNavigate();
    const { ops, setOps } = useOps();

    const [activeTab, setActiveTab] = useState<'sleep' | 'log' | 'hotspots'>('sleep');
    const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

    // 7-day calendar range — default: last 7 days up to yesterday
    const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
        const end = subDays(startOfDay(new Date()), 1);
        return { start: subDays(end, 6), end };
    });

    const [loading, setLoading] = useState(true);
    const [loadingMoreLocations, setLoadingMoreLocations] = useState(false);
    const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);

    const [summary, setSummary] = useState<NightEventsSummary>({
        total_trips: 0, active_vehicles: 0, off_fence_stops: 0, total_distance_km: 0,
    });
    const [locations, setLocations] = useState<OvernightRestLocation[]>([]);
    const [logs, setLogs] = useState<NightDrivingLogEvent[]>([]);

    const [locationsPage, setLocationsPage] = useState(0);
    const [logsPage, setLogsPage] = useState(0);
    const [hasMoreLocations, setHasMoreLocations] = useState(true);
    const [hasMoreLogs, setHasMoreLogs] = useState(true);

    const [logSort, setLogSort] = useState<LogSort>('latest');
    const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');

    // Hotspots map data (lazy loaded when tab opened)
    const [mapData, setMapData] = useState<OvernightRestLocation[]>([]);
    const [mapLoading, setMapLoading] = useState(false);
    const [mapFetched, setMapFetched] = useState(false);

    const getDates = () => ({
        startStr: format(dateRange.start, 'yyyy-MM-dd'),
        endStr: format(dateRange.end, 'yyyy-MM-dd'),
    });

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            setLocationsPage(0);
            setLogsPage(0);
            setMapFetched(false);
            setMapData([]);
            setSelectedVehicle(null);
            const { startStr, endStr } = getDates();
            // Sequential — avoids multiple simultaneous DB connections hitting timeout
            try {
                const summaryData = await fetchNightEventsSummary(startStr, endStr);
                setSummary(summaryData);
            } catch (e) { console.error('Summary failed', e); }
            try {
                const locationsData = await fetchOvernightRestLocations(startStr, endStr, PAGE_LIMIT, 0);
                setLocations(locationsData);
                setHasMoreLocations(locationsData.length === PAGE_LIMIT);
            } catch (e) { console.error('Locations failed', e); }
            try {
                const logsData = await fetchNightDrivingLog(startStr, endStr, PAGE_LIMIT, 0);
                setLogs(logsData);
                setHasMoreLogs(logsData.length === PAGE_LIMIT);
            } catch (e) { console.error('Logs failed', e); }
            setLoading(false);
        }
        if (ops === 'tanzania') loadData();
    }, [dateRange, ops]);

    // Lazy load all map data when hotspots tab opened
    useEffect(() => {
        if (activeTab !== 'hotspots' || mapFetched || mapLoading) return;
        async function loadMapData() {
            setMapLoading(true);
            try {
                const { startStr, endStr } = getDates();
                let allData: OvernightRestLocation[] = [];
                let offset = 0;
                const CHUNK = 500;
                while (true) {
                    const chunk = await fetchOvernightRestLocations(startStr, endStr, CHUNK, offset);
                    if (!chunk || chunk.length === 0) break;
                    allData = [...allData, ...chunk];
                    if (chunk.length < CHUNK) break;
                    offset += CHUNK;
                }
                setMapData(allData);
                setMapFetched(true);
            } catch (e) {
                console.error('Map data load failed', e);
            } finally {
                setMapLoading(false);
            }
        }
        loadMapData();
    }, [activeTab, mapFetched]);

    const handleLoadMoreLocations = async () => {
        if (!hasMoreLocations || loadingMoreLocations) return;
        setLoadingMoreLocations(true);
        try {
            const { startStr, endStr } = getDates();
            const nextPage = locationsPage + 1;
            const newLocations = await fetchOvernightRestLocations(startStr, endStr, PAGE_LIMIT, nextPage * PAGE_LIMIT);
            setLocations(prev => [...prev, ...newLocations]);
            setLocationsPage(nextPage);
            setHasMoreLocations(newLocations.length === PAGE_LIMIT);
        } catch (error) { console.error(error); }
        finally { setLoadingMoreLocations(false); }
    };

    const handleLoadMoreLogs = async () => {
        if (!hasMoreLogs || loadingMoreLogs) return;
        setLoadingMoreLogs(true);
        try {
            const { startStr, endStr } = getDates();
            const nextPage = logsPage + 1;
            const newLogs = await fetchNightDrivingLog(startStr, endStr, PAGE_LIMIT, nextPage * PAGE_LIMIT);
            setLogs(prev => [...prev, ...newLogs]);
            setLogsPage(nextPage);
            setHasMoreLogs(newLogs.length === PAGE_LIMIT);
        } catch (error) { console.error(error); }
        finally { setLoadingMoreLogs(false); }
    };

    const handleExportCSV = async () => {
        try {
            const { startStr, endStr } = getDates();
            let csvContent = '';
            const filename = `export_${activeTab}_${startStr}_to_${endStr}.csv`;
            alert('Fetching dataset for export. This might take a few moments for large date ranges...');
            let allData: any[] = [];
            let offset = 0;
            const CHUNK_SIZE = 500;

            if (activeTab === 'sleep') {
                while (true) {
                    const chunk = await fetchOvernightRestLocations(startStr, endStr, CHUNK_SIZE, offset);
                    if (!chunk || chunk.length === 0) break;
                    allData = [...allData, ...chunk];
                    if (chunk.length < CHUNK_SIZE) break;
                    offset += CHUNK_SIZE;
                }
                csvContent = 'Vehicle,Last Active Time,Night Duration (mins),Is Moving at 5AM,In Geofence,Location\n';
                allData.forEach(row => {
                    const cleanLoc = row.last_location ? row.last_location.replace(/,/g, '') : '';
                    csvContent += `${row.tracker_name},${formatOpsTime(row.last_active_time, ops)},${row.night_duration_minutes},${row.is_moving},${row.in_geofence},${cleanLoc}\n`;
                });
            } else if (activeTab === 'log') {
                while (true) {
                    const chunk = await fetchNightDrivingLog(startStr, endStr, CHUNK_SIZE, offset);
                    if (!chunk || chunk.length === 0) break;
                    allData = [...allData, ...chunk];
                    if (chunk.length < CHUNK_SIZE) break;
                    offset += CHUNK_SIZE;
                }
                csvContent = 'Vehicle,Start Time,End Time,Distance (km),Duration (mins),Status\n';
                allData.forEach(row => {
                    csvContent += `${row.tracker_name},${formatOpsTime(row.start_time, ops)},${formatOpsTime(row.end_time, ops)},${row.distance_km},${row.duration_minutes},${row.status}\n`;
                });
            }

            if (!csvContent || allData.length === 0) {
                alert('No data available to export for this period.');
                return;
            }
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error('Export failed', err);
            alert('Export failed. Please try again.');
        }
    };

    // Derived data
    const sortedLogs = [...logs].sort((a, b) => {
        if (logSort === 'latest') return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
        if (logSort === 'oldest') return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        if (logSort === 'duration_desc') return b.duration_minutes - a.duration_minutes;
        if (logSort === 'duration_asc') return a.duration_minutes - b.duration_minutes;
        if (logSort === 'distance_desc') return Number(b.distance_km) - Number(a.distance_km);
        if (logSort === 'distance_asc') return Number(a.distance_km) - Number(b.distance_km);
        return 0;
    });

    const filteredLocations = locations.filter(row => {
        if (locationFilter === 'all') return true;
        const s = getStatus(row);
        if (locationFilter === 'unsupervised') return s === 'unsupervised';
        if (locationFilter === 'base') return s === 'base';
        if (locationFilter === 'transit') return s === 'transit';
        return true;
    });

    // Vehicle rows for detail map
    const selectedVehicleLocations = selectedVehicle
        ? locations.filter(r => r.tracker_name === selectedVehicle)
        : [];

    return (
        <div className="flex flex-col h-full bg-surface-main p-8 gap-6 overflow-hidden">
            <div className="flex-1 flex flex-col bg-surface-card border border-border rounded-3xl shadow-sm overflow-hidden relative">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-card shrink-0 z-10">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/analytics')}
                            className="p-2 rounded-xl bg-muted hover:bg-surface-raised border border-transparent hover:border-border text-muted-foreground hover:text-foreground transition-all flex items-center justify-center shrink-0"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h2 className="text-xl font-black text-foreground flex items-center gap-2 uppercase tracking-wide">
                                <Moon size={22} className="text-indigo-500 fill-indigo-500/20" />
                                Unsupervised Night Events
                            </h2>
                            <p className="text-sm font-medium text-muted-foreground mt-1 tracking-wide">
                                Tracking unauthorized nighttime movements &amp; off-geofence parking.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1 bg-muted rounded-full p-1 border border-border overflow-hidden">
                            <button onClick={() => setOps('tanzania')} className={cn('px-4 py-1 text-[10px] font-black uppercase rounded-full transition-all tracking-wider', ops === 'tanzania' ? 'bg-surface-raised text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>TZ OPS</button>
                            <button onClick={() => setOps('zambia')} disabled className={cn('px-4 py-1 text-[10px] font-black uppercase rounded-full transition-all tracking-wider opacity-50 cursor-not-allowed')}>ZM OPS</button>
                        </div>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col gap-6">
                    {/* KPIs */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <KPICard title="Total Night Trips" value={summary.total_trips} loading={loading} icon={<Route size={20} className="text-blue-500" />} />
                        <KPICard title="Vehicles Active" value={summary.active_vehicles} loading={loading} icon={<Activity size={20} className="text-emerald-500" />} />
                        <KPICard title="Off-Geofence Stops" value={summary.off_fence_stops} loading={loading} icon={<MapPin size={20} className="text-orange-500" />} isAlert />
                        <KPICard title="Night Distance (km)" value={summary.total_distance_km} loading={loading} icon={<Route size={20} className="text-indigo-500" />} />
                    </div>

                    {/* Main section */}
                    <div className="flex flex-col border border-border rounded-2xl overflow-hidden bg-surface-main flex-1 min-h-0">
                        {/* Tab nav */}
                        <div className="flex bg-surface-card border-b border-border p-2 gap-2 overflow-x-auto shrink-0 z-20 relative">
                            <TabButton active={activeTab === 'sleep'} onClick={() => { setActiveTab('sleep'); setSelectedVehicle(null); }} icon={<MapPin size={16} />}>Overnight Rest Locations</TabButton>
                            <TabButton active={activeTab === 'log'} onClick={() => { setActiveTab('log'); setSelectedVehicle(null); }} icon={<Route size={16} />}>Night Driving Log</TabButton>
                            <TabButton active={activeTab === 'hotspots'} onClick={() => { setActiveTab('hotspots'); setSelectedVehicle(null); }} icon={<Activity size={16} />}>Parking Hotspots Map</TabButton>
                        </div>

                        {/* Section content */}
                        <div className="flex-1 p-6 flex flex-col min-h-0 overflow-hidden">
                            {/* Toolbar (hidden when vehicle selected or hotspots tab) */}
                            {!loading && !selectedVehicle && activeTab !== 'hotspots' && (
                                <div className="flex items-center justify-between mb-4 shrink-0 gap-3 flex-wrap">
                                    <div>
                                        {activeTab === 'sleep' && <LocationFilterBar value={locationFilter} onChange={setLocationFilter} />}
                                        {activeTab === 'log' && <LogSortBar value={logSort} onChange={setLogSort} />}
                                    </div>
                                    <button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-surface-raised border border-border hover:border-primary/50 text-foreground rounded-lg text-xs font-bold transition-all shadow-sm shrink-0">
                                        <Download size={14} /> Export CSV
                                    </button>
                                </div>
                            )}

                            {loading ? (
                                <div className="h-full w-full flex-1 flex flex-col items-center justify-center text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border">
                                    <Loader2 className="animate-spin mb-4" size={32} />
                                    <p className="font-bold uppercase tracking-wider text-xs">Loading Live Data...</p>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                    {activeTab === 'sleep' && (
                                        <SleepDesign
                                            selectedVehicle={selectedVehicle}
                                            onSelectVehicle={setSelectedVehicle}
                                            data={filteredLocations}
                                            allData={locations}
                                            hasMore={hasMoreLocations}
                                            onLoadMore={handleLoadMoreLocations}
                                            loadingMore={loadingMoreLocations}
                                            ops={ops}
                                            activeFilter={locationFilter}
                                            vehicleLocationRows={selectedVehicleLocations}
                                        />
                                    )}
                                    {activeTab === 'log' && (
                                        <LogDesign
                                            selectedVehicle={selectedVehicle}
                                            onSelectVehicle={setSelectedVehicle}
                                            data={sortedLogs}
                                            hasMore={hasMoreLogs}
                                            onLoadMore={handleLoadMoreLogs}
                                            loadingMore={loadingMoreLogs}
                                            ops={ops}
                                            vehicleLocationRows={selectedVehicleLocations}
                                        />
                                    )}
                                    {activeTab === 'hotspots' && (
                                        <HotspotsMap data={mapData} loading={mapLoading} />
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ title, value, icon, isAlert = false, loading }: { title: string; value: number; icon: React.ReactNode; isAlert?: boolean; loading: boolean }) {
    return (
        <div className={cn('p-6 rounded-2xl border bg-surface-card flex items-center gap-5 shadow-sm transition-all hover:shadow-md', isAlert ? 'border-red-500/20 bg-red-500/5' : 'border-border')}>
            <div className={cn('p-4 rounded-xl', isAlert ? 'bg-red-500/10' : 'bg-muted')}>{icon}</div>
            <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</p>
                <h3 className="text-2xl font-black mt-1 text-foreground">
                    {loading ? <span className="text-muted-foreground/30 text-lg">---</span> : value.toLocaleString()}
                </h3>
            </div>
        </div>
    );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabButton({ active, children, onClick, icon }: { active: boolean; children: React.ReactNode; onClick: () => void; icon: React.ReactNode }) {
    return (
        <button onClick={onClick} className={cn('flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap', active ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground')}>
            {icon}{children}
        </button>
    );
}

// ─── Location Filter Bar ──────────────────────────────────────────────────────

function LocationFilterBar({ value, onChange }: { value: LocationFilter; onChange: (v: LocationFilter) => void }) {
    const options: { key: LocationFilter; label: string; active: string }[] = [
        { key: 'all', label: 'All', active: 'bg-surface-raised text-foreground border-border shadow-sm' },
        { key: 'unsupervised', label: 'Parked Unsupervised', active: 'bg-red-500/10 text-red-600 border-red-500/30 shadow-sm' },
        { key: 'base', label: 'Parked at Base', active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 shadow-sm' },
        { key: 'transit', label: 'In Transit at 5 AM', active: 'bg-blue-500/10 text-blue-600 border-blue-500/30 shadow-sm' },
    ];
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider mr-1"><Filter size={12} /> Filter</span>
            {options.map(o => (
                <button key={o.key} onClick={() => onChange(o.key)} className={cn('px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all', value === o.key ? o.active : 'bg-muted text-muted-foreground border-transparent hover:border-border')}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// ─── Log Sort Bar ─────────────────────────────────────────────────────────────

function LogSortBar({ value, onChange }: { value: LogSort; onChange: (v: LogSort) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const options: { key: LogSort; label: string }[] = [
        { key: 'latest', label: 'Latest First' },
        { key: 'oldest', label: 'Oldest First' },
        { key: 'duration_desc', label: 'Duration: High → Low' },
        { key: 'duration_asc', label: 'Duration: Low → High' },
        { key: 'distance_desc', label: 'Distance: High → Low' },
        { key: 'distance_asc', label: 'Distance: Low → High' },
    ];
    const activeLabel = options.find(o => o.key === value)?.label ?? 'Sort';
    useEffect(() => {
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);
    return (
        <div className="relative" ref={ref}>
            <button onClick={() => setOpen(p => !p)} className="flex items-center gap-2 px-4 py-2 bg-surface-raised border border-border rounded-lg text-xs font-bold text-foreground hover:border-primary/40 transition-all shadow-sm">
                <ArrowUpDown size={13} className="text-muted-foreground" />
                Sort: {activeLabel}
                <ChevronDown size={13} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="absolute top-full left-0 mt-2 bg-surface-card border border-border rounded-xl shadow-xl z-30 overflow-hidden min-w-[210px]">
                    {options.map(o => (
                        <button key={o.key} onClick={() => { onChange(o.key); setOpen(false); }} className={cn('w-full text-left px-4 py-2.5 text-xs font-bold transition-colors hover:bg-muted', value === o.key ? 'text-primary bg-primary/5' : 'text-foreground')}>
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Date Range Picker ────────────────────────────────────────────────────────

const APP_START = new Date('2026-01-01');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function DateRangePicker({ value, onChange }: { value: { start: Date; end: Date }; onChange: (r: { start: Date; end: Date }) => void }) {
    const [open, setOpen] = useState(false);
    const [viewMonth, setViewMonth] = useState(() => new Date(value.end.getFullYear(), value.end.getMonth(), 1));
    const [pos, setPos] = useState({ top: 0, right: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const yday = subDays(startOfDay(new Date()), 1);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            if (btnRef.current?.contains(e.target as Node)) return;
            if (popRef.current?.contains(e.target as Node)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    const handleOpen = () => {
        if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
        }
        setOpen(p => !p);
    };

    const [mode, setMode] = useState<'1d' | '7d'>('7d');

    const pick = (date: Date) => {
        if (mode === '1d') {
            const clamped = date > yday ? yday : date < APP_START ? APP_START : date;
            onChange({ start: clamped, end: clamped });
        } else {
            let end = addDays(date, 6);
            if (end > yday) end = new Date(yday);
            let start = subDays(end, 6);
            if (start < APP_START) start = new Date(APP_START);
            onChange({ start, end });
        }
        setOpen(false);
    };

    const yr = viewMonth.getFullYear();
    const mo = viewMonth.getMonth();
    const firstDow = new Date(yr, mo, 1).getDay();
    const lastDay = new Date(yr, mo + 1, 0).getDate();

    // Build weeks array: array of 7-element arrays
    const allCells: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) allCells.push(null);
    for (let d = 1; d <= lastDay; d++) allCells.push(new Date(yr, mo, d));
    while (allCells.length % 7 !== 0) allCells.push(null);
    const weeks: (Date | null)[][] = [];
    for (let i = 0; i < allCells.length; i += 7) weeks.push(allCells.slice(i, i + 7));

    const fmtD = (d: Date) => format(d, 'yyyy-MM-dd');
    const inRange = (d: Date) => d >= value.start && d <= value.end;
    const isStart = (d: Date) => fmtD(d) === fmtD(value.start);
    const isEnd = (d: Date) => fmtD(d) === fmtD(value.end);
    const disabled = (d: Date) => d < APP_START || d > yday;

    const canPrev = new Date(yr, mo - 1, 1) >= new Date(APP_START.getFullYear(), APP_START.getMonth(), 1);
    const canNext = new Date(yr, mo + 1, 1) <= new Date(yday.getFullYear(), yday.getMonth() + 1, 1);

    return (
        <>
            <button
                ref={btnRef}
                onClick={handleOpen}
                className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-xl text-sm font-bold text-foreground hover:border-primary/40 transition-all shadow-sm"
            >
                <Calendar size={14} className="text-muted-foreground" />
                {format(value.start, 'MMM dd')} – {format(value.end, 'MMM dd, yyyy')}
                <ChevronDown size={13} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
            </button>

            {open && createPortal(
                <div
                    ref={popRef}
                    style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999 }}
                    className="bg-surface-card border border-border rounded-2xl shadow-2xl p-4 w-[300px]"
                >
                    {/* Month nav */}
                    <div className="flex items-center justify-between mb-3">
                        <button onClick={() => setViewMonth(new Date(yr, mo - 1, 1))} disabled={!canPrev} className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 text-foreground">
                            <ChevronLeft size={15} />
                        </button>
                        <span className="font-black text-sm text-foreground">{MONTHS[mo]} {yr}</span>
                        <button onClick={() => setViewMonth(new Date(yr, mo + 1, 1))} disabled={!canNext} className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 text-foreground">
                            <ChevronRight size={15} />
                        </button>
                    </div>

                    {/* Quick presets — mode toggles, calendar stays open */}
                    <div className="flex gap-2 mb-3">
                        {(['1D', '7D'] as const).map((label) => (
                            <button key={label}
                                onClick={() => setMode(label.toLowerCase() as '1d' | '7d')}
                                className={cn(
                                    'flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border transition-all',
                                    mode === label.toLowerCase()
                                        ? 'bg-primary text-white border-primary shadow-sm'
                                        : 'bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                                )}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Day headers */}
                    <div className="flex mb-1">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                            <div key={d} className="flex-1 text-center text-[10px] font-bold text-muted-foreground py-1">{d}</div>
                        ))}
                    </div>

                    {/* Weeks — each row its own flex div, portal-rendered so never clipped */}
                    {weeks.map((week, wi) => (
                        <div key={wi} className="flex mb-0.5">
                            {week.map((date, di) => {
                                if (!date) return <div key={di} className="flex-1" />;
                                const dis = disabled(date);
                                const inR = inRange(date);
                                const isS = isStart(date);
                                const isE = isEnd(date);
                                return (
                                    <button
                                        key={di}
                                        onClick={() => !dis && pick(date)}
                                        disabled={dis}
                                        className={cn(
                                            'flex-1 text-center text-xs py-1.5 font-medium transition-colors',
                                            dis && 'text-muted-foreground/30 cursor-not-allowed',
                                            !dis && !inR && 'text-foreground hover:bg-primary/20 rounded-md',
                                            inR && !isS && !isE && 'bg-primary/15 text-primary',
                                            isS && 'bg-primary text-white font-black rounded-l-md',
                                            isE && 'bg-primary text-white font-black rounded-r-md',
                                            isS && isE && 'rounded-md',
                                        )}
                                    >
                                        {date.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </>
    );
}

// ─── Sleep Design ─────────────────────────────────────────────────────────────

function SleepDesign({
    selectedVehicle, onSelectVehicle, data, allData, hasMore, onLoadMore, loadingMore, ops, activeFilter, vehicleLocationRows
}: {
    selectedVehicle: string | null; onSelectVehicle: (v: string | null) => void;
    data: OvernightRestLocation[]; allData: OvernightRestLocation[];
    hasMore: boolean; onLoadMore: () => void; loadingMore: boolean;
    ops: string; activeFilter: LocationFilter;
    vehicleLocationRows: OvernightRestLocation[];
}) {
    if (selectedVehicle) {
        return <VehicleDetailMap vehicle={selectedVehicle} onBack={() => onSelectVehicle(null)} type="sleep" locationRows={vehicleLocationRows} ops={ops} />;
    }

    // Empty because of filter but there IS data loaded
    if (data.length === 0 && allData.length > 0 && activeFilter !== 'all') {
        const filterLabel = activeFilter === 'transit' ? 'In Transit at 5 AM' : activeFilter === 'base' ? 'Parked at Base' : 'Parked Unsupervised';
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-16">
                <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20">
                    <AlertCircle size={32} className="text-amber-500" />
                </div>
                <div>
                    <p className="font-black text-foreground text-base">No "{filterLabel}" vehicles in current batch</p>
                    <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                        Only {allData.length} records are loaded so far. Load more trips to find vehicles with this status across more nights.
                    </p>
                </div>
                {hasMore && (
                    <button onClick={onLoadMore} disabled={loadingMore} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-sm">
                        {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                        {loadingMore ? 'Loading...' : 'Load More Trips'}
                    </button>
                )}
                {!hasMore && (
                    <p className="text-xs text-muted-foreground italic">All trips loaded — no "{filterLabel}" vehicles found in this period.</p>
                )}
            </div>
        );
    }

    if (data.length === 0) return <div className="mt-8 text-center text-muted-foreground italic">No rest locations recorded for this period.</div>;

    return (
        <div className="text-foreground flex flex-col min-h-0 flex-1 overflow-hidden">
            <div className="overflow-auto rounded-xl border border-border flex-1 min-h-0">
                <table className="w-full text-sm text-left">
                    <thead className="bg-surface-raised text-xs uppercase font-bold text-muted-foreground sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 rounded-tl-xl border-b border-border bg-surface-raised">Vehicle</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Last Active Time</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Night Drive Time</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Status</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Location</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.map((row, idx) => (
                            <tr key={idx} className="bg-surface-card hover:bg-surface-raised/50 transition-colors">
                                <td className="px-6 py-4 font-black cursor-pointer text-primary hover:underline" onClick={() => onSelectVehicle(row.tracker_name)}>{row.tracker_name}</td>
                                <td className="px-6 py-4 font-medium whitespace-nowrap">{formatOpsTime(row.last_active_time, ops)}</td>
                                <td className="px-6 py-4 font-medium text-muted-foreground">{Math.floor(row.night_duration_minutes / 60)}h {row.night_duration_minutes % 60}m</td>
                                <td className="px-6 py-4">
                                    {row.is_moving
                                        ? <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 font-bold text-[10px] tracking-wider uppercase whitespace-nowrap">In Transit at 5 AM</span>
                                        : row.in_geofence
                                            ? <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[10px] tracking-wider uppercase whitespace-nowrap">Parked at Base</span>
                                            : <span className="px-3 py-1 rounded-full bg-red-500/10 text-red-600 font-bold text-[10px] tracking-wider uppercase whitespace-nowrap">Parked Unsupervised</span>
                                    }
                                </td>
                                <td className="px-6 py-4 text-muted-foreground truncate max-w-sm" title={row.last_location}>{row.last_location || 'Unknown Coordinates'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {hasMore && (
                    <div className="p-4 flex justify-center bg-surface-card border-t border-border sticky bottom-0">
                        <button onClick={onLoadMore} disabled={loadingMore} className="flex items-center gap-2 px-6 py-2 bg-muted hover:bg-surface-raised text-foreground font-bold text-xs uppercase tracking-wider rounded-lg transition-colors border border-border">
                            {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
                            {loadingMore ? 'Loading...' : 'Load More'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Log Design ───────────────────────────────────────────────────────────────

function LogDesign({
    selectedVehicle, onSelectVehicle, data, hasMore, onLoadMore, loadingMore, ops, vehicleLocationRows
}: {
    selectedVehicle: string | null; onSelectVehicle: (v: string | null) => void;
    data: NightDrivingLogEvent[]; hasMore: boolean; onLoadMore: () => void;
    loadingMore: boolean; ops: string; vehicleLocationRows: OvernightRestLocation[];
}) {
    if (selectedVehicle) {
        return <VehicleDetailMap vehicle={selectedVehicle} onBack={() => onSelectVehicle(null)} type="trajectory" locationRows={vehicleLocationRows} ops={ops} />;
    }
    if (data.length === 0) return <div className="mt-8 text-center text-muted-foreground italic">No night driving events recorded for this period.</div>;

    return (
        <div className="text-foreground flex flex-col min-h-0 flex-1 overflow-hidden">
            <div className="overflow-auto rounded-xl border border-border flex-1 min-h-0">
                <table className="w-full text-sm text-left">
                    <thead className="bg-surface-raised text-xs uppercase font-bold text-muted-foreground sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 rounded-tl-xl border-b border-border bg-surface-raised">Vehicle</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Start Time</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">End Time</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Distance</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Duration</th>
                            <th className="px-6 py-4 border-b border-border bg-surface-raised">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.map((row, idx) => (
                            <tr key={`${row.trip_id}-${idx}`} className="bg-surface-card hover:bg-surface-raised/50 transition-colors">
                                <td className="px-6 py-4 font-black cursor-pointer text-primary hover:underline" onClick={() => onSelectVehicle(row.tracker_name)}>{row.tracker_name}</td>
                                <td className="px-6 py-4 font-medium whitespace-nowrap">{formatOpsTime(row.start_time, ops)}</td>
                                <td className="px-6 py-4 font-medium whitespace-nowrap">{formatOpsTime(row.end_time, ops)}</td>
                                <td className="px-6 py-4 font-medium">{row.distance_km} km</td>
                                <td className="px-6 py-4 text-muted-foreground">{Math.floor(row.duration_minutes / 60)}h {row.duration_minutes % 60}m</td>
                                <td className="px-6 py-4">
                                    <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 font-bold text-[10px] tracking-wider uppercase whitespace-nowrap">{row.status}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {hasMore && (
                    <div className="p-4 flex justify-center bg-surface-card border-t border-border sticky bottom-0">
                        <button onClick={onLoadMore} disabled={loadingMore} className="flex items-center gap-2 px-6 py-2 bg-muted hover:bg-surface-raised text-foreground font-bold text-xs uppercase tracking-wider rounded-lg transition-colors border border-border">
                            {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
                            {loadingMore ? 'Loading...' : 'Load More'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Vehicle Detail Map ───────────────────────────────────────────────────────

function VehicleDetailMap({
    vehicle, onBack, type, locationRows, ops: _ops
}: {
    vehicle: string; onBack: () => void; type: string;
    locationRows: OvernightRestLocation[]; ops: string;
}) {
    const [popupInfo, setPopupInfo] = useState<(OvernightRestLocation & { lat: number; lng: number }) | null>(null);
    const { resolved } = useTheme();
    const mapStyle = resolved === 'dark'
        ? 'mapbox://styles/mapbox/dark-v11'
        : 'mapbox://styles/mapbox/satellite-streets-v12';

    const validPoints = locationRows
        .filter(r => r.end_lat != null && r.end_lng != null && r.end_lat !== 0 && r.end_lng !== 0)
        .map(r => ({ ...r, lat: r.end_lat as number, lng: r.end_lng as number }));

    const centerLat = validPoints.length > 0 ? validPoints[0].lat : -6.4;
    const centerLng = validPoints.length > 0 ? validPoints[0].lng : 34.8;

    return (
        <div className="flex flex-col h-full w-full flex-1 gap-4">
            {/* Header */}
            <div className="flex items-center gap-4 shrink-0">
                <button onClick={onBack} className="p-2 bg-surface-raised hover:bg-muted rounded-xl transition-colors border border-border text-muted-foreground">
                    <ArrowLeft size={16} />
                </button>
                <div>
                    <h3 className="text-lg font-black text-foreground">
                        <span className="text-primary">{vehicle}</span>
                        <span className="text-muted-foreground font-medium ml-2">
                            — {type === 'trajectory' ? 'Night Movement End Points' : 'Overnight Rest Locations'}
                        </span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {validPoints.length > 0
                            ? `${validPoints.length} night location${validPoints.length > 1 ? 's' : ''} plotted`
                            : 'No mappable coordinates found for this vehicle'}
                    </p>
                </div>

                {/* Mini legend */}
                <div className="ml-auto flex items-center gap-4">
                    {[{ color: 'bg-red-500', label: 'Unsupervised' }, { color: 'bg-emerald-500', label: 'At Base' }, { color: 'bg-blue-500', label: 'In Transit' }].map(l => (
                        <div key={l.label} className="flex items-center gap-1.5">
                            <span className={cn('w-2.5 h-2.5 rounded-full', l.color)} />
                            <span className="text-xs text-muted-foreground font-medium">{l.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Map */}
            <div className="w-full h-[500px] rounded-2xl border border-border overflow-hidden relative shrink-0">
                {validPoints.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30">
                        <MapPin size={40} className="text-muted-foreground/40 mb-3" />
                        <p className="font-black text-muted-foreground tracking-widest uppercase text-sm">No location data available</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">This vehicle has no coordinates stored for night rest points</p>
                    </div>
                ) : (
                    <Map
                        initialViewState={{ longitude: centerLng, latitude: centerLat, zoom: validPoints.length === 1 ? 10 : 7 }}
                        style={{ width: '100%', height: '100%' }}
                        mapStyle={mapStyle}
                        mapboxAccessToken={MAPBOX_TOKEN}
                    >
                        {validPoints.map((point, i) => {
                            const status = getStatus(point);
                            return (
                                <Marker
                                    key={i}
                                    longitude={point.lng}
                                    latitude={point.lat}
                                    anchor="center"
                                    onClick={e => { e.originalEvent.stopPropagation(); setPopupInfo(point); }}
                                >
                                    <div
                                        style={{ backgroundColor: markerColor(status) }}
                                        className="w-4 h-4 rounded-full border-2 border-white shadow-lg cursor-pointer hover:scale-150 transition-transform flex items-center justify-center"
                                    >
                                        <span className="text-[6px] text-white font-black">{i + 1}</span>
                                    </div>
                                </Marker>
                            );
                        })}
                        {popupInfo && (
                            <Popup longitude={popupInfo.lng} latitude={popupInfo.lat} anchor="bottom" onClose={() => setPopupInfo(null)} maxWidth="260px">
                                <div className="p-1">
                                    <p className="font-black text-sm mb-1">{popupInfo.tracker_name}</p>
                                    <p className="text-xs text-muted-foreground mb-2">{formatOpsTime(popupInfo.last_active_time, 'tanzania')}</p>
                                    <p className="text-xs text-muted-foreground mb-2">{popupInfo.last_location}</p>
                                    <div className="flex items-center gap-2">
                                        {popupInfo.is_moving
                                            ? <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 font-bold text-[10px] uppercase">In Transit</span>
                                            : popupInfo.in_geofence
                                                ? <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 font-bold text-[10px] uppercase">At Base</span>
                                                : <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 font-bold text-[10px] uppercase">Unsupervised</span>
                                        }
                                        <span className="text-xs text-muted-foreground">{Math.floor(popupInfo.night_duration_minutes / 60)}h {popupInfo.night_duration_minutes % 60}m</span>
                                    </div>
                                </div>
                            </Popup>
                        )}
                    </Map>
                )}
            </div>
        </div>
    );
}

// ─── Hotspots Map ─────────────────────────────────────────────────────────────

function HotspotsMap({ data, loading }: { data: OvernightRestLocation[]; loading: boolean }) {
    const [mapFilter, setMapFilter] = useState<MapFilter>('all');
    const [popupInfo, setPopupInfo] = useState<(OvernightRestLocation & { lat: number; lng: number }) | null>(null);
    const { resolved } = useTheme();
    const mapStyle = resolved === 'dark'
        ? 'mapbox://styles/mapbox/dark-v11'
        : 'mapbox://styles/mapbox/satellite-streets-v12';

    const mappableData = data
        .filter(row => row.end_lat != null && row.end_lng != null && row.end_lat !== 0 && row.end_lng !== 0)
        .map(row => ({ ...row, lat: row.end_lat as number, lng: row.end_lng as number }));

    const filtered = mappableData.filter(r => {
        if (mapFilter === 'all') return true;
        return getStatus(r) === mapFilter;
    });

    const filterBtns: { key: MapFilter; label: string; dot: string }[] = [
        { key: 'all', label: 'All', dot: 'bg-foreground' },
        { key: 'unsupervised', label: 'Unsupervised', dot: 'bg-red-500' },
        { key: 'base', label: 'At Base', dot: 'bg-emerald-500' },
        { key: 'transit', label: 'In Transit', dot: 'bg-blue-500' },
    ];

    return (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
            {/* Filter row */}
            <div className="flex items-center gap-3 shrink-0 flex-wrap">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Show:</span>
                {filterBtns.map(b => (
                    <button key={b.key} onClick={() => setMapFilter(b.key)} className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all', mapFilter === b.key ? 'bg-surface-raised border-border shadow-sm text-foreground' : 'border-transparent text-muted-foreground hover:border-border')}>
                        <span className={cn('w-2.5 h-2.5 rounded-full inline-block', b.dot)} />
                        {b.label}
                    </button>
                ))}
                <span className="ml-auto text-xs text-muted-foreground font-medium">{filtered.length} locations plotted</span>
            </div>

            {/* The map — fixed height for square-ish appearance */}
            <div className="w-full h-[500px] rounded-2xl overflow-hidden border border-border relative shrink-0">
                {loading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30 z-10">
                        <Loader2 size={32} className="animate-spin text-primary mb-3" />
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fetching all locations...</p>
                    </div>
                ) : mappableData.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10">
                        <MapPin size={40} className="text-muted-foreground/40 mb-3" />
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">No parseable coordinates in location data</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Ensure end_lat / end_lng columns are populated in the trips table</p>
                    </div>
                ) : (
                    <Map
                        initialViewState={{ longitude: 34.8, latitude: -6.4, zoom: 5 }}
                        style={{ width: '100%', height: '100%' }}
                        mapStyle={mapStyle}
                        mapboxAccessToken={MAPBOX_TOKEN}
                    >
                        {filtered.map((row, i) => {
                            const status = getStatus(row);
                            return (
                                <Marker key={i} longitude={row.lng} latitude={row.lat} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); setPopupInfo(row); }}>
                                    <div style={{ backgroundColor: markerColor(status) }} className="w-3 h-3 rounded-full border-2 border-white shadow-lg cursor-pointer hover:scale-150 transition-transform" />
                                </Marker>
                            );
                        })}
                        {popupInfo && (
                            <Popup longitude={popupInfo.lng} latitude={popupInfo.lat} anchor="bottom" onClose={() => setPopupInfo(null)} maxWidth="260px">
                                <div className="p-1">
                                    <p className="font-black text-sm mb-1">{popupInfo.tracker_name}</p>
                                    <p className="text-xs text-muted-foreground mb-1">{popupInfo.last_location}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        {popupInfo.is_moving
                                            ? <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 font-bold text-[10px] uppercase">In Transit</span>
                                            : popupInfo.in_geofence
                                                ? <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 font-bold text-[10px] uppercase">At Base</span>
                                                : <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 font-bold text-[10px] uppercase">Unsupervised</span>
                                        }
                                        <span className="text-xs text-muted-foreground">{Math.floor(popupInfo.night_duration_minutes / 60)}h {popupInfo.night_duration_minutes % 60}m</span>
                                    </div>
                                </div>
                            </Popup>
                        )}
                    </Map>
                )}
            </div>

            {/* Colour legend */}
            <div className="flex items-center gap-6 shrink-0 px-1">
                {[{ color: 'bg-red-500', label: 'Parked Unsupervised' }, { color: 'bg-emerald-500', label: 'Parked at Base' }, { color: 'bg-blue-500', label: 'In Transit at 5 AM' }].map(l => (
                    <div key={l.label} className="flex items-center gap-2">
                        <span className={cn('w-3 h-3 rounded-full', l.color)} />
                        <span className="text-xs text-muted-foreground font-medium">{l.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
