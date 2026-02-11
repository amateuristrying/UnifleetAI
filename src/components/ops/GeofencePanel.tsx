import React, { useState, useEffect } from 'react';
import {
    MapPin, Plus, Clock, ArrowLeft,
    Anchor, Files, Warehouse, Truck, Target,
    Hexagon, Route, Circle,
    Eye, Check, RefreshCw
} from 'lucide-react';
import type { Geofence, CreateZonePayload, GeofenceCategory } from '@/types/geofence';
import { cn } from '@/lib/utils';

type PanelView = 'list' | 'create' | 'detail';

interface GeofencePanelProps {
    zones: Geofence[];
    selectedZoneId: number | null;
    trackerLabels: Record<number, string>;
    onSelectZone: (zoneId: number | null) => void;
    onCreateZone: (payload: CreateZonePayload) => Promise<number | null>;
    onStartDrawing: (mode: 'polygon' | 'corridor' | 'circle') => void;
    onCancelDrawing: () => void;
    drawnPayload?: CreateZonePayload | null;
    monitoredZoneIds?: number[];
    onMonitorZones?: (zoneIds: number[]) => void;
    region?: 'TZ' | 'ZM';
    onRefresh?: () => void;
    viewMode?: 'locked' | 'unlocked';
}

const categoryIcons: Record<GeofenceCategory, React.ReactNode> = {
    port: <Anchor size={14} />,
    border: <Files size={14} />,
    warehouse: <Warehouse size={14} />,
    mining: <Truck size={14} />,
    depot: <Target size={14} />,
    custom: <MapPin size={14} />,
};

const categoryLabels: Record<GeofenceCategory, string> = {
    port: 'Terminal',
    border: 'Customs',
    warehouse: 'Hub',
    mining: 'Mining',
    depot: 'Depot',
    custom: 'Custom',
};

function truncateToWords(name: string, maxWords: number = 3): string {
    const words = name.split(/\s+/);
    if (words.length <= maxWords) return name;
    return words.slice(0, maxWords).join(' ') + '…';
}

const MAX_MONITOR_ZONES = 3;

export default function GeofencePanel({
    zones, selectedZoneId, trackerLabels,
    onSelectZone, onCreateZone, onStartDrawing, onCancelDrawing,
    drawnPayload, monitoredZoneIds = [], onMonitorZones,
    region = 'TZ', onRefresh, viewMode = 'unlocked'
}: GeofencePanelProps) {
    const [view, setView] = useState<PanelView>('list');
    const [createForm, setCreateForm] = useState({
        name: '',
        category: 'custom' as GeofenceCategory,
        type: 'polygon' as 'polygon' | 'corridor' | 'circle',
        radius: 1000,
    });
    const [saving, setSaving] = useState(false);
    const [selectedForMonitor, setSelectedForMonitor] = useState<Set<number>>(new Set());
    const [isRefreshing, setIsRefreshing] = useState(false);

    const selectedZone = zones.find(z => z.id === selectedZoneId);

    useEffect(() => {
        if (selectedZoneId && view === 'list') setView('detail');
    }, [selectedZoneId]);

    const handleCheckboxToggle = (e: React.MouseEvent, zoneId: number) => {
        e.stopPropagation();
        setSelectedForMonitor(prev => {
            const next = new Set(prev);
            if (next.has(zoneId)) next.delete(zoneId);
            else if (next.size < MAX_MONITOR_ZONES) next.add(zoneId);
            return next;
        });
    };

    const handleSaveZone = async () => {
        if (!createForm.name.trim() || !drawnPayload) return;
        setSaving(true);
        const payload = { ...drawnPayload, label: createForm.name.trim(), category: createForm.category, color: '#3b82f6' };
        await onCreateZone(payload);
        setSaving(false);
        setCreateForm({ name: '', category: 'custom', type: 'polygon', radius: 500 });
        onCancelDrawing();
        setView('list');
    };

    const handleManualRefresh = async (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (onRefresh) {
            setIsRefreshing(true);
            await onRefresh();
            setTimeout(() => setIsRefreshing(false), 800);
        }
    };

    // LIST VIEW
    if (view === 'list') {
        const hasSelections = selectedForMonitor.size > 0;
        const sortedZones = [...zones].sort((a, b) => b.vehicleCount - a.vehicleCount);

        return (
            <div className="flex flex-col h-full bg-surface-card rounded-2xl border border-border shadow-sm overflow-hidden animate-in fade-in duration-500">
                <div className="p-4 border-b border-border bg-muted/30">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <MapPin size={18} className="text-primary" />
                            <h2 className="text-sm font-black text-foreground uppercase tracking-tight">Geofence Registry</h2>
                        </div>
                        {viewMode === 'unlocked' && (
                            <button
                                onClick={() => setView('create')}
                                className="p-2 bg-primary text-white rounded-xl shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                            >
                                <Plus size={16} />
                            </button>
                        )}
                    </div>
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none">
                        {hasSelections ? `Selected: ${selectedForMonitor.size} / ${MAX_MONITOR_ZONES}` : `${zones.length} Active Zones`}
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {sortedZones.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center">
                            <MapPin className="text-muted-foreground opacity-10 mb-6" size={48} />
                            <p className="text-xs font-black text-muted-foreground uppercase tracking-widest">No zones detected</p>
                        </div>
                    ) : (
                        sortedZones.map(zone => {
                            const isSelectedForMonitor = selectedForMonitor.has(zone.id);
                            const isMonitored = monitoredZoneIds.includes(zone.id);
                            const isActive = selectedZoneId === zone.id;

                            return (
                                <div
                                    key={zone.id}
                                    onClick={() => { onSelectZone(zone.id); setView('detail'); }}
                                    className={cn(
                                        "group p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
                                        isActive ? "bg-primary/5 border-primary ring-1 ring-primary/20" : "bg-surface-raised border-border hover:border-primary/40 hover:shadow-md",
                                        isSelectedForMonitor && "border-emerald-500/50 bg-emerald-500/5"
                                    )}
                                >
                                    <div className="flex items-center justify-between relative z-10">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {viewMode === 'unlocked' && (
                                                <button
                                                    onClick={(e) => handleCheckboxToggle(e, zone.id)}
                                                    className={cn(
                                                        "w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all",
                                                        isSelectedForMonitor ? "bg-emerald-500 border-emerald-500" : "border-border bg-surface-raised group-hover:border-emerald-400"
                                                    )}
                                                >
                                                    {isSelectedForMonitor && <Check size={12} className="text-white" />}
                                                </button>
                                            )}

                                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: zone.color }} />

                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-[11px] font-black text-foreground uppercase truncate tracking-tight">{truncateToWords(zone.name, 4)}</span>
                                                    {isMonitored && <Eye size={10} className="text-primary shrink-0" />}
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <div className="opacity-50 group-hover:opacity-100 transition-opacity">{categoryIcons[zone.category]}</div>
                                                    <span className="text-[9px] font-bold text-muted-foreground uppercase">{zone.type}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 ml-2">
                                            <div className={cn(
                                                "px-2 py-1 rounded-lg text-[10px] font-black tracking-tighter transition-all",
                                                zone.vehicleCount > 0 ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"
                                            )}>
                                                {zone.vehicleCount}
                                            </div>
                                        </div>
                                    </div>
                                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                                </div>
                            );
                        })
                    )}
                </div>

                {viewMode === 'unlocked' && hasSelections && (
                    <div className="p-4 border-t border-border bg-surface-raised animate-in slide-in-from-bottom duration-300">
                        <div className="flex gap-2">
                            <button onClick={() => setSelectedForMonitor(new Set())} className="flex-1 h-10 px-4 border border-border rounded-xl text-[10px] font-black uppercase text-muted-foreground hover:bg-muted transition-all">Clear</button>
                            <button onClick={() => { onMonitorZones?.(Array.from(selectedForMonitor)); setSelectedForMonitor(new Set()); }} className="flex-[2] h-10 px-4 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 active:scale-95 transition-all">Start Monitor</button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // CREATE VIEW
    if (view === 'create') {
        return (
            <div className="flex flex-col h-full bg-surface-card rounded-2xl border border-border shadow-sm overflow-hidden animate-in slide-in-from-right duration-500">
                <div className="p-4 border-b border-border bg-muted/30 flex items-center gap-4">
                    <button onClick={() => { setView('list'); onCancelDrawing(); }} className="p-2 bg-surface-raised border border-border rounded-xl text-foreground hover:bg-muted transition-all shadow-sm">
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <h2 className="text-sm font-black text-foreground uppercase tracking-tight leading-none mb-1">Architect Mode</h2>
                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Define Geo-Boundary</p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Zone Identifier</label>
                        <input
                            type="text"
                            value={createForm.name}
                            onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                            placeholder="RECOVERY HUB 01"
                            className="w-full px-4 py-3 bg-surface-raised border border-border rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:opacity-30"
                        />
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Vector Category</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(categoryLabels) as GeofenceCategory[]).map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setCreateForm(p => ({ ...p, category: cat }))}
                                    className={cn(
                                        "flex items-center gap-3 px-4 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
                                        createForm.category === cat ? "bg-primary/5 border-primary text-primary" : "bg-surface-raised border-border text-muted-foreground hover:border-primary/40"
                                    )}
                                >
                                    {categoryIcons[cat]} {categoryLabels[cat]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Geometric Logic</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { val: 'polygon' as const, lbl: 'Polygon', icon: <Hexagon size={16} /> },
                                { val: 'corridor' as const, lbl: 'Route', icon: <Route size={16} /> },
                                { val: 'circle' as const, lbl: 'Radial', icon: <Circle size={16} /> },
                            ].map(opt => (
                                <button
                                    key={opt.val}
                                    onClick={() => setCreateForm(p => ({ ...p, type: opt.val }))}
                                    className={cn(
                                        "flex flex-col items-center gap-2 px-2 py-4 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all",
                                        createForm.type === opt.val ? "bg-primary/5 border-primary text-primary shadow-inner" : "bg-surface-raised border-border text-muted-foreground hover:border-primary/40"
                                    )}
                                >
                                    {opt.icon} {opt.lbl}
                                </button>
                            ))}
                        </div>
                    </div>

                    {!drawnPayload ? (
                        <button onClick={() => onStartDrawing(createForm.type)} className="w-full h-14 flex items-center justify-center gap-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 active:scale-[0.98]">
                            <MapPin size={18} /> Initialize Map Capture
                        </button>
                    ) : (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-4">
                            <div className="p-2 bg-emerald-500 rounded-lg text-white shadow-lg shadow-emerald-500/20"><Check size={20} /></div>
                            <div>
                                <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Vector Data Captured</p>
                                <p className="text-[9px] font-bold text-emerald-600/70 uppercase">Ready for transmission</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-border bg-surface-raised">
                    <button
                        onClick={handleSaveZone}
                        disabled={!createForm.name.trim() || !drawnPayload || saving}
                        className="w-full h-12 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] disabled:opacity-30 disabled:grayscale transition-all"
                    >
                        {saving ? 'Transmitting...' : 'Register Zone to Network'}
                    </button>
                </div>
            </div>
        );
    }

    // DETAIL VIEW
    if (view === 'detail' && selectedZone) {
        return (
            <div className="flex flex-col h-full bg-surface-card rounded-2xl border border-border shadow-sm overflow-hidden animate-in slide-in-from-right duration-500">
                <div className="p-4 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-4">
                        {viewMode === 'unlocked' && (
                            <button onClick={() => { setView('list'); onSelectZone(null); }} className="p-2 bg-surface-raised border border-border rounded-xl shadow-sm hover:bg-muted transition-all">
                                <ArrowLeft size={16} />
                            </button>
                        )}
                        <div className="flex-1 min-w-0">
                            <h2 className="text-sm font-black text-foreground uppercase tracking-tight truncate leading-none mb-1">{selectedZone.name}</h2>
                            <div className="flex items-center gap-2">
                                <span className="opacity-50">{categoryIcons[selectedZone.category]}</span>
                                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">{categoryLabels[selectedZone.category]} HUB</span>
                            </div>
                        </div>
                        <button onClick={handleManualRefresh} className="p-2 bg-surface-raised border border-border rounded-xl shadow-sm hover:bg-muted transition-all group">
                            <RefreshCw size={16} className={cn("text-muted-foreground group-hover:text-primary transition-colors", isRefreshing && "animate-spin text-primary")} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-primary/5 rounded-2xl p-5 border border-primary/20 text-center shadow-sm">
                            <p className="text-3xl font-black text-primary leading-none mb-1">{selectedZone.vehicleCount}</p>
                            <p className="text-[9px] font-black text-primary/70 uppercase tracking-widest">Live Assets</p>
                        </div>
                        <div className="bg-muted rounded-2xl p-5 border border-border text-center">
                            <p className="text-xl font-black text-foreground leading-none mb-1">
                                {selectedZone.radius ? `${(selectedZone.radius / 1000).toFixed(1)}km` : '--'}
                            </p>
                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Scope Range</p>
                        </div>
                    </div>

                    {/* WhatsApp Action */}
                    {viewMode === 'unlocked' && (
                        <div className="bg-emerald-600 rounded-3xl p-6 text-white shadow-xl shadow-emerald-500/20 relative overflow-hidden group">
                            <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
                                <Truck size={80} />
                            </div>
                            <h3 className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-80">Share Live Dashboard</h3>
                            <p className="text-xs font-bold leading-relaxed mb-6 opacity-90">Generate a permanent read-only link to share real-time tracking with external partners via WhatsApp.</p>
                            <button
                                onClick={() => {
                                    const baseUrl = window.location.origin + window.location.pathname;
                                    const shareUrl = `${baseUrl}?geofence_id=${selectedZone.id}&view=locked&region=${region}`;
                                    const message = `Live Geofence Surveillance – ${selectedZone.name}\nVector link:\n\n${shareUrl}`;
                                    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
                                }}
                                className="w-full h-11 bg-white text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md hover:bg-emerald-50 transition-all active:scale-95"
                            >
                                Share to WhatsApp
                            </button>
                        </div>
                    )}

                    {selectedZone.vehicleIds.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Active Network Nodes</h3>
                            <div className="space-y-2">
                                {[...selectedZone.vehicleIds]
                                    .sort((a, b) => (selectedZone.occupants?.[b]?.entryTime || 0) - (selectedZone.occupants?.[a]?.entryTime || 0))
                                    .map(tId => {
                                        const occ = selectedZone.occupants?.[tId];
                                        const dwell = occ ? Date.now() - occ.entryTime : 0;
                                        const isCritical = dwell > 4 * 60 * 60 * 1000;
                                        const isWarning = dwell > 60 * 60 * 1000;

                                        return (
                                            <div key={tId} className="group flex items-center justify-between p-4 bg-surface-raised border border-border rounded-2xl hover:border-primary/40 hover:shadow-sm transition-all">
                                                <div className="flex items-center gap-4 min-w-0">
                                                    <div className={cn("w-2 h-2 rounded-full", isCritical ? "bg-red-500 shadow-lg shadow-red-500/40" : isWarning ? "bg-amber-500 shadow-lg shadow-amber-500/40" : "bg-primary shadow-lg shadow-primary/40", "animate-pulse")} />
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-[11px] font-black text-foreground uppercase truncate tracking-tight">{trackerLabels[tId] || `ASSET-${tId}`}</span>
                                                        <span className="text-[9px] font-bold text-muted-foreground uppercase opacity-50">{occ?.status || 'Active'}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-lg border border-border/50">
                                                    <Clock size={10} className="text-muted-foreground" />
                                                    <span className={cn("text-[10px] font-black tracking-tighter", isCritical ? "text-red-600" : isWarning ? "text-amber-600" : "text-primary")}>
                                                        {formatDwellTime(dwell)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return null;
}

function formatDwellTime(ms: number) {
    if (ms < 60000) return 'NOW';
    const min = Math.floor(ms / 60000);
    const hrs = Math.floor(min / 60);
    const days = Math.floor(hrs / 24);
    if (days > 0) return `${days}D ${hrs % 24}H`;
    if (hrs > 0) return `${hrs}H ${min % 60}M`;
    return `${min}M`;
}
