import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useOps } from '@/context/OpsContext';
import { useTheme } from '@/context/ThemeProvider';
import {
    AlertTriangle, ArrowLeft, MapPin, Gauge,
    Loader2, ChevronDown, Calendar, ChevronLeft, ChevronRight,
    Car, Clock, TrendingUp, X, Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, subDays, startOfDay, addDays } from 'date-fns';
import Map, { Marker, Popup, Source, Layer, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
    fetchNightSpeedingIncidents,
    fetchLatestSpeedDate,
    computeSummary,
    type NightSpeedingIncident,
    type NightSpeedingSummary,
} from '@/services/nightSpeeding';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
const PAGE_LIMIT = 1000; // Large enough to capture all violations before client-side night filter

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
    try {
        const d = new Date(iso);
        const eatDate = new Date(Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours() + 3,
            d.getUTCMinutes()
        ));
        const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][eatDate.getUTCMonth()];
        const day = String(eatDate.getUTCDate()).padStart(2, '0');
        const hr = String(eatDate.getUTCHours()).padStart(2, '0');
        const min = String(eatDate.getUTCMinutes()).padStart(2, '0');
        return `${mo} ${day}, ${hr}:${min} EAT`;
    } catch { return iso; }
}
function fmtDur(secs: number) {
    const m = Math.floor(secs / 60), s = Math.round(secs % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function speedColor(speed: number) {
    if (speed >= 120) return '#ef4444';
    if (speed >= 100) return '#f97316';
    if (speed >= 80) return '#eab308';
    return '#3b82f6';
}
function speedLabel(speed: number) {
    if (speed >= 120) return { label: 'Critical', cls: 'text-red-400' };
    if (speed >= 100) return { label: 'Severe', cls: 'text-orange-400' };
    if (speed >= 80) return { label: 'Moderate', cls: 'text-yellow-400' };
    return { label: 'Mild', cls: 'text-blue-400' };
}

// Build a GeoJSON circle polygon for violation zone
function makeCircleGeoJSON(lng: number, lat: number, radiusKm: number, pts = 64) {
    const coords: [number, number][] = [];
    for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * 2 * Math.PI;
        const dlng = (radiusKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(a);
        const dlat = (radiusKm / 110.54) * Math.sin(a);
        coords.push([lng + dlng, lat + dlat]);
    }
    return {
        type: 'FeatureCollection' as const,
        features: [{
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [coords] },
            properties: {},
        }],
    };
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({ title, value, icon, loading, isAlert = false, unit = '' }: {
    title: string; value: number | string; icon: React.ReactNode;
    loading: boolean; isAlert?: boolean; unit?: string;
}) {
    return (
        <div className={cn(
            'bg-surface-card border border-border rounded-2xl p-5 flex flex-col gap-3',
            isAlert && 'border-red-400/30 bg-red-500/5'
        )}>
            <div className="flex items-center justify-between">
                <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">{title}</p>
                <div className={cn('p-2 rounded-xl', isAlert ? 'bg-red-500/10' : 'bg-primary/10')}>{icon}</div>
            </div>
            {loading
                ? <div className="h-8 w-24 bg-muted rounded-lg animate-pulse" />
                : <p className={cn('text-3xl font-black tracking-tight', isAlert ? 'text-red-600' : 'text-foreground')}>
                    {typeof value === 'number' ? value.toLocaleString() : value}
                    {unit && <span className="text-sm font-bold text-muted-foreground ml-1">{unit}</span>}
                </p>
            }
        </div>
    );
}

// ─── Date Range Picker (portal-based) ────────────────────────────────────────

const APP_START = new Date('2026-01-01');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function DateRangePicker({ value, onChange }: {
    value: { start: Date; end: Date };
    onChange: (r: { start: Date; end: Date }) => void;
}) {
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

    const [mode, setMode] = useState<'1d' | '7d'>('1d');

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

    const yr = viewMonth.getFullYear(), mo = viewMonth.getMonth();
    const firstDow = new Date(yr, mo, 1).getDay();
    const lastDay = new Date(yr, mo + 1, 0).getDate();
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
            <button ref={btnRef} onClick={handleOpen}
                className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-xl text-sm font-bold text-foreground hover:border-primary/40 transition-all shadow-sm">
                <Calendar size={14} className="text-muted-foreground" />
                {format(value.start, 'MMM dd')} – {format(value.end, 'MMM dd, yyyy')}
                <ChevronDown size={13} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
            </button>
            {open && createPortal(
                <div ref={popRef}
                    style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999 }}
                    className="bg-surface-card border border-border rounded-2xl shadow-2xl p-4 w-[300px]">
                    <div className="flex items-center justify-between mb-3">
                        <button onClick={() => setViewMonth(new Date(yr, mo - 1, 1))} disabled={!canPrev} className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 text-foreground"><ChevronLeft size={15} /></button>
                        <span className="font-black text-sm text-foreground">{MONTHS[mo]} {yr}</span>
                        <button onClick={() => setViewMonth(new Date(yr, mo + 1, 1))} disabled={!canNext} className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 text-foreground"><ChevronRight size={15} /></button>
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
                    <div className="flex mb-1">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                            <div key={d} className="flex-1 text-center text-[10px] font-bold text-muted-foreground py-1">{d}</div>
                        ))}
                    </div>
                    {weeks.map((week, wi) => (
                        <div key={wi} className="flex mb-0.5">
                            {week.map((date, di) => {
                                if (!date) return <div key={di} className="flex-1" />;
                                const dis = disabled(date), inR = inRange(date), isS = isStart(date), isE = isEnd(date);
                                return (
                                    <button key={di} onClick={() => !dis && pick(date)} disabled={dis}
                                        className={cn('flex-1 text-center text-xs py-1.5 font-medium transition-colors',
                                            dis && 'text-muted-foreground/30 cursor-not-allowed',
                                            !dis && !inR && 'text-foreground hover:bg-primary/20 rounded-md',
                                            inR && !isS && !isE && 'bg-primary/15 text-primary',
                                            isS && 'bg-primary text-white font-black rounded-l-md',
                                            isE && 'bg-primary text-white font-black rounded-r-md',
                                            isS && isE && 'rounded-md',
                                        )}>
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

// ─── Incident Row ─────────────────────────────────────────────────────────────

function IncidentRow({ inc, selected, onClick }: {
    inc: NightSpeedingIncident; selected: boolean; onClick: () => void;
}) {
    const { label, cls } = speedLabel(inc.max_speed);
    return (
        <button onClick={onClick}
            className={cn(
                'w-full text-left px-4 py-3.5 border-b border-border transition-all hover:bg-muted/50 flex items-center gap-3',
                selected && 'bg-primary/5 border-l-[3px] border-l-primary'
            )}>
            {/* Speed badge */}
            <div className="shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center"
                style={{ background: speedColor(inc.max_speed) + '18', border: `1.5px solid ${speedColor(inc.max_speed)}50` }}>
                <span className="text-base font-black leading-none" style={{ color: speedColor(inc.max_speed) }}>
                    {Math.round(inc.max_speed)}
                </span>
                <span className="text-[9px] font-bold text-muted-foreground">km/h</span>
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-sm font-black text-foreground truncate leading-tight">{inc.tracker_name}</p>
                    <span className={cn('text-[9px] font-black uppercase shrink-0', cls)}>{label}</span>
                </div>
                <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock size={10} />{fmtTime(inc.start_time)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <span><Gauge size={10} className="inline mr-0.5" />avg {Math.round(inc.avg_speed)} km/h</span>
                    {inc.duration_seconds > 0 && <span>· {fmtDur(inc.duration_seconds)}</span>}
                </div>
            </div>
            {(inc.lat && inc.lng)
                ? <MapPin size={14} className="text-primary/60 shrink-0" />
                : <MapPin size={14} className="text-muted-foreground/20 shrink-0" />
            }
        </button>
    );
}

// ─── Main Map Panel ───────────────────────────────────────────────────────────

function IncidentMap({
    incidents, selected, onSelect, loading, mapPopup, onMapPopup,
}: {
    incidents: NightSpeedingIncident[];
    selected: NightSpeedingIncident | null;
    onSelect: (inc: NightSpeedingIncident | null) => void;
    loading: boolean;
    mapPopup: NightSpeedingIncident | null;
    onMapPopup: (inc: NightSpeedingIncident | null) => void;
}) {
    const mapRef = useRef<MapRef>(null);
    const { resolved } = useTheme();
    const mapStyle = resolved === 'dark'
        ? 'mapbox://styles/mapbox/dark-v11'
        : 'mapbox://styles/mapbox/satellite-streets-v12';
    const mapPoints = incidents.filter(r => r.lat && r.lng && r.lat !== 0 && r.lng !== 0);
    const centerLat = mapPoints.length > 0 ? mapPoints[0].lat! : -6.8;
    const centerLng = mapPoints.length > 0 ? mapPoints[0].lng! : 34.2;

    // flyTo when selection changes
    useEffect(() => {
        if (!mapRef.current) return;
        if (selected && selected.lat && selected.lng) {
            mapRef.current.flyTo({ center: [selected.lng, selected.lat], zoom: 13, duration: 1000, essential: true });
        } else {
            mapRef.current.flyTo({ center: [centerLng, centerLat], zoom: 6, duration: 800 });
        }
    }, [selected]);

    // Violation zone: approximate radius from duration × avg_speed
    const zoneGeoJSON = selected && selected.lat && selected.lng
        ? makeCircleGeoJSON(
            selected.lng, selected.lat,
            Math.max(0.05, ((selected.avg_speed / 3.6) * selected.duration_seconds) / 1000 / 2)
        )
        : null;

    const selColor = selected ? speedColor(selected.max_speed) : '#3b82f6';
    const { label: selLabel, cls: selCls } = selected ? speedLabel(selected.max_speed) : { label: '', cls: '' };

    return (
        <div className="relative w-full h-full overflow-hidden rounded-2xl">
            {loading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface-main/80 rounded-2xl">
                    <Loader2 size={28} className="animate-spin text-muted-foreground" />
                </div>
            )}

            {mapPoints.length === 0 && !loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                    <MapPin size={40} className="text-muted-foreground/20 mb-3" />
                    <p className="font-black text-muted-foreground">No GPS data for this period</p>
                </div>
            ) : (
                <Map
                    ref={mapRef}
                    initialViewState={{ longitude: centerLng, latitude: centerLat, zoom: 6 }}
                    style={{ width: '100%', height: '100%' }}
                    mapStyle={mapStyle}
                    mapboxAccessToken={MAPBOX_TOKEN}
                >
                    {/* Violation zone circle when incident selected */}
                    {zoneGeoJSON && (
                        <Source id="zone" type="geojson" data={zoneGeoJSON}>
                            <Layer id="zone-fill" type="fill"
                                paint={{ 'fill-color': selColor, 'fill-opacity': 0.15 }} />
                            <Layer id="zone-line" type="line"
                                paint={{ 'line-color': selColor, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [3, 2] }} />
                        </Source>
                    )}

                    {/* All markers */}
                    {mapPoints.map((inc) => {
                        const isSelected = selected?.id === inc.id;
                        const col = speedColor(inc.max_speed);
                        return (
                            <Marker key={inc.id} longitude={inc.lng!} latitude={inc.lat!} anchor="center"
                                onClick={e => { e.originalEvent.stopPropagation(); onMapPopup(mapPopup?.id === inc.id ? null : inc); onSelect(inc); }}>
                                <div className="relative cursor-pointer">
                                    {isSelected && (
                                        <div className="absolute inset-0 -m-2 rounded-full animate-ping"
                                            style={{ backgroundColor: col, opacity: 0.35 }} />
                                    )}
                                    <div className={cn('rounded-full border-2 transition-all', isSelected ? 'w-5 h-5' : 'w-3 h-3 border-white/80')}
                                        style={{
                                            backgroundColor: col,
                                            borderColor: isSelected ? 'white' : 'rgba(255,255,255,0.6)',
                                            boxShadow: isSelected ? `0 0 12px ${col}` : '0 1px 4px rgba(0,0,0,0.5)',
                                        }} />
                                </div>
                            </Marker>
                        );
                    })}

                    {/* Popup from overview pin click */}
                    {mapPopup && mapPopup.lat && mapPopup.lng && !selected && (
                        <Popup longitude={mapPopup.lng} latitude={mapPopup.lat} anchor="bottom"
                            onClose={() => onMapPopup(null)} maxWidth="210px">
                            <div className="p-1 text-xs">
                                <p className="font-black text-sm mb-1">{mapPopup.tracker_name}</p>
                                <p className="text-muted-foreground">{fmtTime(mapPopup.start_time)}</p>
                                <div className="flex gap-2 mt-1">
                                    <span className="font-bold">Max: <span style={{ color: speedColor(mapPopup.max_speed) }}>{Math.round(mapPopup.max_speed)} km/h</span></span>
                                    <span>· {fmtDur(mapPopup.duration_seconds)}</span>
                                </div>
                            </div>
                        </Popup>
                    )}
                </Map>
            )}

            {/* ── Floating stats overlay when incident selected ── */}
            {selected && (
                <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
                    {/* Compact glass card */}
                    <div className="bg-black/65 backdrop-blur-md border border-white/10 rounded-xl p-3 min-w-[170px] shadow-2xl">
                        <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                                <p className="text-white font-black text-sm leading-tight">{selected.tracker_name}</p>
                                <p className="text-white/50 text-[10px] mt-0.5">{fmtTime(selected.start_time)}</p>
                            </div>
                            <button onClick={() => onSelect(null)}
                                className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors shrink-0">
                                <X size={13} />
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div className="bg-white/5 rounded-lg px-2 py-1.5">
                                <p className="text-white/40 text-[9px] uppercase font-bold tracking-wider">Max</p>
                                <p className="font-black text-sm leading-tight" style={{ color: selColor }}>
                                    {Math.round(selected.max_speed)} <span className="text-[9px] text-white/40">km/h</span>
                                </p>
                            </div>
                            <div className="bg-white/5 rounded-lg px-2 py-1.5">
                                <p className="text-white/40 text-[9px] uppercase font-bold tracking-wider">Avg</p>
                                <p className="text-white font-black text-sm leading-tight">
                                    {Math.round(selected.avg_speed)} <span className="text-[9px] text-white/40">km/h</span>
                                </p>
                            </div>
                            <div className="bg-white/5 rounded-lg px-2 py-1.5">
                                <p className="text-white/40 text-[9px] uppercase font-bold tracking-wider">Duration</p>
                                <p className="text-white font-black text-sm leading-tight">{fmtDur(selected.duration_seconds)}</p>
                            </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-white/10">
                            <span className={cn('text-[9px] font-black uppercase tracking-wider', selCls)}>{selLabel}</span>
                            <span className="text-white/40 text-[9px] ml-2">
                                ~{Math.round((selected.avg_speed / 3.6) * selected.duration_seconds)}m covered
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Color legend (overview mode) ── */}
            {!selected && (
                <div className="absolute bottom-4 left-3 z-10 flex flex-col gap-1 bg-black/50 backdrop-blur rounded-xl px-3 py-2 border border-white/10">
                    {[{ c: '#ef4444', l: '≥120 Critical' }, { c: '#f97316', l: '≥100 Severe' },
                    { c: '#eab308', l: '≥80 Moderate' }, { c: '#3b82f6', l: '<80 Mild' }].map(({ c, l }) => (
                        <span key={l} className="flex items-center gap-2 text-[10px] font-bold text-white/70">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />{l}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NightSpeeding() {
    const navigate = useNavigate();
    const { setOps } = useOps();

    useEffect(() => { setOps('tanzania'); }, []);

    // Default to yesterday as a single day; will be updated to latest data date on mount
    const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
        const yday = subDays(startOfDay(new Date()), 1);
        return { start: yday, end: yday };
    });

    // On mount: find the latest trip_date that has data and select it
    useEffect(() => {
        fetchLatestSpeedDate().then(dateStr => {
            const latest = startOfDay(new Date(dateStr + 'T00:00:00'));
            setDateRange({ start: latest, end: latest });
        }).catch(() => { /* keep yesterday as fallback */ });
    }, []);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [incidents, setIncidents] = useState<NightSpeedingIncident[]>([]);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(0);
    const [summary, setSummary] = useState<NightSpeedingSummary>({ total_incidents: 0, vehicles_involved: 0, avg_max_speed: 0, worst_speed: 0 });
    const [selected, setSelected] = useState<NightSpeedingIncident | null>(null);
    const [mapPopup, setMapPopup] = useState<NightSpeedingIncident | null>(null);

    const getDates = useCallback(() => ({
        startStr: format(dateRange.start, 'yyyy-MM-dd'),
        endStr: format(dateRange.end, 'yyyy-MM-dd'),
    }), [dateRange]);

    useEffect(() => {
        async function load() {
            setLoading(true); setPage(0); setSelected(null); setMapPopup(null);
            try {
                const { startStr, endStr } = getDates();
                const data = await fetchNightSpeedingIncidents(startStr, endStr, PAGE_LIMIT, 0);
                setIncidents(data); setSummary(computeSummary(data));
                setHasMore(data.length === PAGE_LIMIT);
            } catch (e) { console.error(e); }
            finally { setLoading(false); }
        }
        load();
    }, [getDates]);

    const handleLoadMore = async () => {
        setLoadingMore(true);
        try {
            const nextPage = page + 1;
            const { startStr, endStr } = getDates();
            const data = await fetchNightSpeedingIncidents(startStr, endStr, PAGE_LIMIT, nextPage * PAGE_LIMIT);
            const merged = [...incidents, ...data];
            setIncidents(merged); setSummary(computeSummary(merged));
            setHasMore(data.length === PAGE_LIMIT); setPage(nextPage);
        } catch (e) { console.error(e); }
        finally { setLoadingMore(false); }
    };

    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const displayedIncidents = searchQuery.trim()
        ? incidents.filter(inc =>
            inc.tracker_name?.toLowerCase().includes(searchQuery.trim().toLowerCase())
        )
        : incidents;

    return (
        <div className="flex flex-col h-full bg-surface-main p-8 gap-6 overflow-hidden">
            <div className="flex-1 flex flex-col bg-surface-card border border-border rounded-3xl shadow-sm overflow-hidden">

                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-card shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/analytics')}
                            className="p-2 rounded-xl bg-muted hover:bg-surface-raised border border-transparent hover:border-border text-muted-foreground hover:text-foreground transition-all">
                            <ArrowLeft size={18} />
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
                                <AlertTriangle size={18} className="text-red-500" />
                            </div>
                            <div>
                                <h1 className="text-base font-black text-foreground uppercase tracking-tight leading-none">Night Speeding Incidents</h1>
                                <p className="text-xs text-muted-foreground mt-0.5">High-risk speeds · 19:00 – 06:59 EAT</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1 bg-muted rounded-full p-1 border border-border">
                            <button className="px-4 py-1 text-[10px] font-black uppercase rounded-full bg-surface-raised text-primary shadow-sm tracking-wider">TZ OPS</button>
                            <button disabled className="px-4 py-1 text-[10px] font-black uppercase rounded-full tracking-wider opacity-40 cursor-not-allowed text-muted-foreground">ZM OPS</button>
                        </div>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* KPIs */}
                    <div className="px-6 pt-5 pb-4 grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
                        <KPICard title="Total Incidents" value={summary.total_incidents} loading={loading}
                            icon={<AlertTriangle size={18} className="text-red-500" />} isAlert />
                        <KPICard title="Vehicles Involved" value={summary.vehicles_involved} loading={loading}
                            icon={<Car size={18} className="text-orange-500" />} />
                        <KPICard title="Avg Max Speed" value={summary.avg_max_speed} loading={loading}
                            icon={<Gauge size={18} className="text-yellow-500" />} unit="km/h" />
                        <KPICard title="Worst Speed" value={summary.worst_speed} loading={loading}
                            icon={<TrendingUp size={18} className="text-red-600" />} unit="km/h" isAlert />
                    </div>

                    {/* Two-column: list + full map */}
                    <div className="flex-1 flex overflow-hidden px-6 pb-6 gap-5">
                        {/* Left list */}
                        <div className="w-[340px] shrink-0 flex flex-col bg-surface-main border border-border rounded-2xl overflow-hidden">
                            <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0 min-h-[40px]">
                                {searchOpen ? (
                                    <>
                                        <Search size={13} className="text-muted-foreground shrink-0" />
                                        <input
                                            autoFocus
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            placeholder="Search vehicle..."
                                            className="flex-1 bg-transparent text-xs font-medium text-foreground placeholder:text-muted-foreground/50 outline-none"
                                        />
                                        <button onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                                            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
                                            <X size={12} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p className="flex-1 text-xs font-black text-muted-foreground uppercase tracking-widest">
                                            {loading ? 'Loading…' : `${incidents.length} Incidents`}
                                        </p>
                                        <button
                                            onClick={() => setSearchOpen(true)}
                                            title="Search by vehicle name"
                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-all">
                                            <Search size={13} />
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {loading ? (
                                    <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                                        <Loader2 size={18} className="animate-spin" />
                                        <span className="text-sm font-medium">Loading…</span>
                                    </div>
                                ) : displayedIncidents.length === 0 && searchQuery ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                                        <Search size={28} className="text-muted-foreground/30 mb-3" />
                                        <p className="font-black text-muted-foreground text-sm">No match for "{searchQuery}"</p>
                                    </div>
                                ) : incidents.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                                        <AlertTriangle size={28} className="text-muted-foreground/30 mb-3" />
                                        <p className="font-black text-muted-foreground text-sm">No incidents this period</p>
                                    </div>
                                ) : (
                                    <>
                                        {displayedIncidents.map(inc => (
                                            <IncidentRow key={inc.id} inc={inc}
                                                selected={selected?.id === inc.id}
                                                onClick={() => setSelected(selected?.id === inc.id ? null : inc)} />
                                        ))}
                                        {hasMore && (
                                            <div className="p-4 flex justify-center">
                                                <button onClick={handleLoadMore} disabled={loadingMore}
                                                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider rounded-lg">
                                                    {loadingMore && <Loader2 size={12} className="animate-spin" />}
                                                    {loadingMore ? 'Loading…' : 'Load More'}
                                                </button>
                                            </div>
                                        )}
                                        {!hasMore && incidents.length > 0 && (
                                            <p className="text-center text-[11px] text-muted-foreground py-3 italic">All incidents loaded</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Right — always full map */}
                        <div className="flex-1 overflow-hidden">
                            <IncidentMap
                                incidents={incidents}
                                selected={selected}
                                onSelect={setSelected}
                                loading={loading}
                                mapPopup={mapPopup}
                                onMapPopup={setMapPopup}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
