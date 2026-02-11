import React, { useState } from 'react';
import {
    MapPin, Plus, Trash2, Clock, ArrowLeft,
    Anchor, Files, Warehouse, Truck, Target,
    Hexagon, Route, Circle,
    Eye, Check, X,
} from 'lucide-react';
import type { Geofence, CreateZonePayload, GeofenceCategory } from '../../types/geofence';

type PanelView = 'list' | 'create' | 'detail';

interface GeofencePanelProps {
    zones: Geofence[];
    selectedZoneId: number | null;
    trackerLabels: Record<number, string>;
    onSelectZone: (zoneId: number | null) => void;
    onCreateZone: (payload: CreateZonePayload) => Promise<number | null>;
    onDeleteZone: (zoneId: number) => Promise<boolean>;
    onStartDrawing: (mode: 'polygon' | 'corridor' | 'circle') => void;
    onCancelDrawing: () => void;
    drawnPayload?: CreateZonePayload | null;
    monitoredZoneIds?: number[];
    onMonitorZones?: (zoneIds: number[]) => void;
    onRefresh?: () => void;
}

const categoryIcons: Record<GeofenceCategory, React.ReactNode> = {
    port: <Anchor size={14} className="text-blue-600" />,
    border: <Files size={14} className="text-amber-600" />,
    warehouse: <Warehouse size={14} className="text-purple-600" />,
    mining: <Truck size={14} className="text-slate-600" />,
    depot: <Target size={14} className="text-emerald-600" />,
    custom: <MapPin size={14} className="text-sky-600" />,
};

const categoryLabels: Record<GeofenceCategory, string> = {
    port: 'Port / Terminal',
    border: 'Border / Customs',
    warehouse: 'Warehouse / Hub',
    mining: 'Mining Site',
    depot: 'Depot',
    custom: 'Custom Zone',
};

const MAX_MONITOR_ZONES = 3;

export default function GeofencePanel({
    zones, selectedZoneId, trackerLabels,
    onSelectZone, onCreateZone, onDeleteZone, onStartDrawing, onCancelDrawing,
    drawnPayload, monitoredZoneIds = [], onMonitorZones,
    onRefresh: _onRefresh
}: GeofencePanelProps) {
    const [view, setView] = useState<PanelView>('list');
    const [createForm, setCreateForm] = useState({
        name: '',
        category: 'custom' as GeofenceCategory,
        type: 'polygon' as 'polygon' | 'corridor' | 'circle',
        radius: 1000,
    });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showVehicleToast, setShowVehicleToast] = useState(false);

    const [selectedForMonitor, setSelectedForMonitor] = useState<Set<number>>(new Set());

    // Force re-render every minute for duration updates
    const [, setTick] = useState(0);
    React.useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(timer);
    }, []);

    const selectedZone = zones.find(z => z.id === selectedZoneId);

    React.useEffect(() => {
        if (selectedZoneId && view === 'list') {
            setView('detail');
        }
    }, [selectedZoneId]);

    const handleCheckboxToggle = (e: React.MouseEvent, zoneId: number) => {
        e.stopPropagation();
        setSelectedForMonitor(prev => {
            const next = new Set(prev);
            if (next.has(zoneId)) {
                next.delete(zoneId);
            } else if (next.size < MAX_MONITOR_ZONES) {
                next.add(zoneId);
            }
            return next;
        });
    };

    const handleZoneClick = (zoneId: number) => {
        onSelectZone(zoneId);
        setView('detail');
    };

    const handleDelete = async (zoneId: number) => {
        setDeleting(true);
        await onDeleteZone(zoneId);
        setDeleting(false);
        setView('list');
    };

    const handleStartDraw = () => {
        onStartDrawing(createForm.type);
    };

    const handleSaveZone = async () => {
        if (!createForm.name.trim()) return;
        setSaving(true);

        let payload: CreateZonePayload;
        if (drawnPayload) {
            payload = { ...drawnPayload, label: createForm.name.trim(), category: createForm.category, color: '#3b82f6' };
        } else {
            setSaving(false);
            return;
        }

        await onCreateZone(payload);
        setSaving(false);
        setCreateForm({ name: '', category: 'custom', type: 'polygon', radius: 500 });
        onCancelDrawing();
        setView('list');
    };

    const handleClearSelection = () => {
        setSelectedForMonitor(new Set());
    };

    const handleConfirmMonitorSelection = () => {
        if (onMonitorZones && selectedForMonitor.size > 0) {
            onMonitorZones(Array.from(selectedForMonitor));
        }
        setSelectedForMonitor(new Set());
    };

    // ── LIST VIEW ──────────────────────────────────────────
    if (view === 'list') {
        const hasSelections = selectedForMonitor.size > 0;
        const sortedZones = [...zones].sort((a, b) => b.vehicleCount - a.vehicleCount);

        return (
            <div className="flex flex-col h-full bg-surface-card overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/50 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-bold text-foreground">Geofence Zones</h2>
                        <p className="text-xs text-muted-foreground">
                            {hasSelections
                                ? `${selectedForMonitor.size} of ${MAX_MONITOR_ZONES} zones selected for monitoring`
                                : `${zones.length} zones configured`
                            }
                        </p>
                    </div>
                    <button
                        onClick={() => setView('create')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
                    >
                        <Plus size={12} /> New Zone
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {sortedZones.length === 0 ? (
                        <div className="text-center py-12">
                            <MapPin className="mx-auto text-muted-foreground/50 mb-3" size={32} />
                            <p className="text-sm font-medium text-muted-foreground">No geofence zones</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">Create your first zone to start monitoring</p>
                            <button
                                onClick={() => setView('create')}
                                className="mt-4 px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:bg-primary/90"
                            >
                                <Plus size={12} className="inline mr-1" /> Create Zone
                            </button>
                        </div>
                    ) : (
                        sortedZones.map(zone => {
                            const isSelectedForMonitor = selectedForMonitor.has(zone.id);
                            const isMonitored = monitoredZoneIds.includes(zone.id);

                            return (
                                <div
                                    key={zone.id}
                                    onClick={() => handleZoneClick(zone.id)}
                                    className={`p-3 rounded-xl border transition-all cursor-pointer ${selectedZoneId === zone.id
                                        ? 'ring-2 ring-primary border-primary bg-primary/10'
                                        : isSelectedForMonitor
                                            ? 'ring-2 ring-green-500 border-green-400 bg-green-50/50 dark:bg-green-500/10'
                                            : 'border-border hover:border-primary/50 hover:shadow-sm bg-surface-card'
                                        }`}
                                >
                                    {/* Row 1: Checkbox + Color + Name */}
                                    <div className="flex items-start gap-2">
                                        <button
                                            onClick={(e) => handleCheckboxToggle(e, zone.id)}
                                            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0 mt-0.5 ${isSelectedForMonitor
                                                ? 'bg-green-500 border-green-500 hover:bg-green-600'
                                                : 'border-border bg-surface-card hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-500/10'
                                                } ${selectedForMonitor.size >= MAX_MONITOR_ZONES && !isSelectedForMonitor ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            disabled={selectedForMonitor.size >= MAX_MONITOR_ZONES && !isSelectedForMonitor}
                                            title={isSelectedForMonitor ? 'Remove from monitoring' : 'Add to monitoring'}
                                        >
                                            {isSelectedForMonitor && <Check size={12} className="text-white" />}
                                        </button>

                                        <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: zone.color }}></div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="shrink-0">{categoryIcons[zone.category]}</span>
                                                <span className="text-sm font-medium text-foreground break-words leading-snug">
                                                    {zone.name}
                                                </span>
                                                {isMonitored && (
                                                    <span title="Currently monitored" className="shrink-0">
                                                        <Eye size={12} className="text-blue-500" />
                                                    </span>
                                                )}
                                            </div>

                                            {/* Row 2: Type + Count */}
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[10px] uppercase text-muted-foreground font-medium">
                                                    {zone.type === 'sausage' ? 'corridor' : zone.type}
                                                </span>
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${zone.vehicleCount > 0
                                                    ? 'bg-primary/10 text-primary'
                                                    : 'bg-muted text-muted-foreground'
                                                    }`}>
                                                    {zone.vehicleCount}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-border bg-surface-card">
                    {hasSelections ? (
                        <div className="flex gap-2">
                            <button
                                onClick={handleClearSelection}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-border text-muted-foreground text-xs font-bold rounded-lg hover:bg-muted transition-colors"
                            >
                                <X size={12} /> Clear
                            </button>
                            <button
                                onClick={handleConfirmMonitorSelection}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors"
                            >
                                <Eye size={12} /> + Monitor ({selectedForMonitor.size})
                            </button>
                        </div>
                    ) : (
                        <div className="text-center text-xs text-muted-foreground/60 py-1">
                            <Eye size={14} className="inline mr-1 opacity-50" />
                            Select zones using checkboxes to monitor them
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── CREATE VIEW ────────────────────────────────────────
    if (view === 'create') {
        return (
            <div className="flex flex-col h-full bg-surface-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/50 flex items-center gap-3">
                    <button
                        onClick={() => { setView('list'); onCancelDrawing(); }}
                        className="p-1.5 bg-surface-card border border-border rounded-lg hover:bg-muted text-muted-foreground"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <h2 className="text-sm font-bold text-foreground">Create Geofence</h2>
                        <p className="text-xs text-muted-foreground">Draw a zone on the map</p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">Zone Name</label>
                        <input
                            type="text"
                            value={createForm.name}
                            onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="e.g., Dar es Salaam Port Terminal"
                            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted/20 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">Category</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(categoryLabels) as GeofenceCategory[]).map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setCreateForm(prev => ({ ...prev, category: cat }))}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${createForm.category === cat
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-muted-foreground hover:border-primary/50'
                                        }`}
                                >
                                    {categoryIcons[cat]}
                                    {categoryLabels[cat]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">Zone Shape</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { value: 'polygon' as const, label: 'Polygon', icon: <Hexagon size={14} /> },
                                { value: 'corridor' as const, label: 'Corridor', icon: <Route size={14} /> },
                                { value: 'circle' as const, label: 'Circle', icon: <Circle size={14} /> },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setCreateForm(prev => ({ ...prev, type: opt.value }))}
                                    className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${createForm.type === opt.value
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-muted-foreground hover:border-primary/50'
                                        }`}
                                >
                                    {opt.icon}
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {(createForm.type === 'circle' || createForm.type === 'corridor') && (
                        <div>
                            <label className="block text-xs font-bold text-muted-foreground mb-1.5">
                                {createForm.type === 'circle' ? 'Radius' : 'Corridor Width'} (meters)
                            </label>
                            <input
                                type="number"
                                value={createForm.radius}
                                onChange={e => setCreateForm(prev => ({ ...prev, radius: Number(e.target.value) }))}
                                min={50}
                                max={50000}
                                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted/20 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    )}

                    {!drawnPayload ? (
                        <button
                            onClick={handleStartDraw}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-foreground text-background text-sm font-bold rounded-lg hover:bg-foreground/90 transition-colors"
                        >
                            <MapPin size={16} /> Draw on Map
                        </button>
                    ) : (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                            <p className="text-xs font-bold text-green-700">Zone drawn on map</p>
                            <p className="text-[10px] text-green-600 mt-0.5">
                                {drawnPayload.type === 'polygon' && drawnPayload.points && `${drawnPayload.points.length} points`}
                                {(drawnPayload.type === 'sausage' || drawnPayload.type === 'corridor') && drawnPayload.points && `${drawnPayload.points.length} waypoints`}
                                {drawnPayload.type === 'circle' && `${drawnPayload.radius}m radius`}
                            </p>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-border">
                    <button
                        onClick={handleSaveZone}
                        disabled={!createForm.name.trim() || !drawnPayload || saving}
                        className="w-full px-4 py-2.5 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {saving ? 'Saving...' : 'Save Geofence'}
                    </button>
                </div>
            </div>
        );
    }

    // ── DETAIL VIEW ────────────────────────────────────────
    if (view === 'detail' && selectedZone) {
        return (
            <div className="flex flex-col h-full bg-surface-card rounded-xl border border-border shadow-sm overflow-hidden relative">
                <div className="p-4 border-b border-border bg-muted/50 flex items-center gap-3">
                    <button
                        onClick={() => { setView('list'); onSelectZone(null); }}
                        className="p-1.5 bg-surface-card border border-border rounded-lg hover:bg-muted text-muted-foreground"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-bold text-foreground truncate">{selectedZone.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            {categoryIcons[selectedZone.category]}
                            <span className="text-xs text-muted-foreground">
                                {categoryLabels[selectedZone.category]} &middot; {selectedZone.type === 'sausage' ? 'Corridor' : selectedZone.type}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-primary/10 rounded-lg p-3 text-center border border-primary/20">
                            <div className="text-2xl font-black text-primary">{selectedZone.vehicleCount}</div>
                            <div className="text-[10px] text-primary/80 font-bold uppercase">Vehicles Inside</div>
                        </div>
                        <div className="bg-muted rounded-lg p-3 text-center border border-border">
                            <div className="text-2xl font-black text-foreground">
                                {selectedZone.radius ? `${(selectedZone.radius / 1000).toFixed(1)}km` : '--'}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-bold uppercase">
                                {selectedZone.type === 'sausage' ? 'Width' : 'Radius'}
                            </div>
                        </div>
                    </div>

                    {selectedZone.vehicleIds.length > 0 && (
                        <div>
                            <h3 className="text-xs font-bold text-muted-foreground mb-2">Vehicles Currently Inside</h3>
                            <div className="space-y-1">
                                {selectedZone.vehicleIds.map(tId => {
                                    const occupant = selectedZone.occupants?.[tId];
                                    const now = Date.now();
                                    const durationMs = occupant ? now - occupant.entryTime : 0;

                                    const formatDwellTime = (ms: number) => {
                                        if (ms < 60000) return 'Just now';
                                        const totalMins = Math.floor(ms / 60000);
                                        const totalHrs = Math.floor(totalMins / 60);
                                        const totalDays = Math.floor(totalHrs / 24);

                                        if (totalDays >= 365) {
                                            const y = Math.floor(totalDays / 365);
                                            const remDays = totalDays % 365;
                                            const mo = Math.floor(remDays / 30);
                                            const d = remDays % 30;
                                            return `${y}y ${mo}mo ${d}d`;
                                        }
                                        if (totalDays >= 30) {
                                            const mo = Math.floor(totalDays / 30);
                                            const d = totalDays % 30;
                                            return `${mo}mo ${d}d`;
                                        }
                                        if (totalDays >= 1) {
                                            const h = totalHrs % 24;
                                            return `${totalDays}d ${h}h`;
                                        }
                                        if (totalHrs > 0) {
                                            return `${totalHrs}h ${totalMins % 60}m`;
                                        }
                                        return `${totalMins}m`;
                                    };

                                    const durationStr = formatDwellTime(durationMs);

                                    let dotColor = 'bg-primary';
                                    let timerColor = 'text-muted-foreground';

                                    if (durationMs > 4 * 60 * 60 * 1000) {
                                        dotColor = 'bg-red-500';
                                        timerColor = 'text-red-500';
                                    } else if (durationMs > 1 * 60 * 60 * 1000) {
                                        dotColor = 'bg-amber-500';
                                        timerColor = 'text-amber-600 dark:text-amber-500';
                                    }

                                    return (
                                        <div
                                            key={tId}
                                            onClick={() => { setShowVehicleToast(true); setTimeout(() => setShowVehicleToast(false), 4000); }}
                                            className="flex items-center justify-between p-2 bg-muted/20 rounded border border-border cursor-pointer hover:bg-muted/50 transition-colors relative"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${dotColor} ${durationMs < 60000 ? 'animate-pulse' : ''}`}></div>
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-medium text-foreground">
                                                        {trackerLabels[tId] || `Tracker #${tId}`}
                                                    </span>
                                                    {occupant?.status && (
                                                        <span className="text-[10px] text-muted-foreground font-medium">
                                                            {occupant.status}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Clock size={10} className={timerColor} />
                                                <span className={`text-[10px] font-bold ${timerColor}`}>
                                                    {durationStr}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-border">
                    <button
                        onClick={() => handleDelete(selectedZone.id)}
                        disabled={deleting}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                    >
                        <Trash2 size={12} /> {deleting ? 'Deleting...' : 'Delete Zone'}
                    </button>
                </div>

                {
                    showVehicleToast && (
                        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-foreground text-background text-xs px-4 py-2 rounded-lg shadow-lg z-50 whitespace-nowrap pointer-events-none">
                            You can see vehicle details in geofence monitor
                        </div>
                    )
                }
            </div >
        );
    }

    return null;
}
