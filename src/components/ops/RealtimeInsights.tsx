import { useState, useMemo } from 'react';
import {
    AlertTriangle,
    MapPin,
    Anchor,
    Warehouse,
    Files,
    ArrowRight,
    Truck,
    ShieldCheck,
    ArrowLeft,
    Eye,
    X,
    Clock
} from 'lucide-react';
import type { FleetAnalysis, ZoneType, ActionItem } from '@/types/fleet-analysis';
import type { Geofence } from '@/types/geofence';
import { cn } from '@/lib/utils';

interface RealtimeInsightsProps {
    analysis: FleetAnalysis | null;
    currentView: 'summary' | 'traffic' | 'geofences' | 'monitor';
    onViewChange: (view: 'summary' | 'traffic' | 'geofences' | 'monitor') => void;
    onActionSelect?: (action: ActionItem) => void;
    zones?: Geofence[];
    trackerLabels?: Record<number, string>;
    monitoredZoneIds?: number[];
    onMonitorZones?: (zoneIds: number[]) => void;
    onSelectZone?: (zoneId: number) => void;
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function StatusBadge({ status }: { status: string }) {
    const lowerStatus = status.toLowerCase();
    let bgColor = 'bg-muted';
    let textColor = 'text-muted-foreground';
    let dotColor = 'bg-muted-foreground';
    if (lowerStatus.includes('moving')) {
        bgColor = 'bg-green-500/10';
        textColor = 'text-green-600';
        dotColor = 'bg-green-500';
    } else if (lowerStatus.includes('parked')) {
        bgColor = 'bg-blue-500/10';
        textColor = 'text-blue-600';
        dotColor = 'bg-blue-500';
    } else if (lowerStatus.includes('stopped') || lowerStatus.includes('idle')) {
        bgColor = 'bg-orange-500/10';
        textColor = 'text-orange-600';
        dotColor = 'bg-orange-500';
    }
    return (
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest", bgColor, textColor)}>
            <span className={cn("w-1 h-1 rounded-full", dotColor, lowerStatus.includes('moving') && "animate-pulse")}></span>
            {status}
        </span>
    );
}

export default function RealtimeInsights({
    analysis,
    currentView,
    onViewChange,
    onActionSelect,
    zones = [],
    trackerLabels = {},
    monitoredZoneIds = [],
    onMonitorZones,
    onSelectZone
}: RealtimeInsightsProps) {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const monitoredGeofences = useMemo(() => {
        return zones.filter(zone => monitoredZoneIds.includes(zone.id));
    }, [zones, monitoredZoneIds]);

    if (!analysis) return (
        <div className="bg-surface-card rounded-2xl p-6 border border-border shadow-sm animate-pulse">
            <div className="h-4 bg-muted rounded-full w-1/3 mb-6"></div>
            <div className="h-24 bg-muted/30 rounded-2xl"></div>
        </div>
    );

    const getIcon = (type: ZoneType) => {
        switch (type) {
            case 'port': return <Anchor size={16} className="text-blue-600" />;
            case 'border': return <Files size={16} className="text-orange-600" />;
            case 'warehouse': return <Warehouse size={16} className="text-purple-600" />;
            case 'mining': return <Truck size={16} className="text-slate-600" />;
            default: return <AlertTriangle size={16} className="text-red-500" />;
        }
    };

    const handleActionClick = (item: ActionItem) => {
        setSelectedId(item.id);
        if (onActionSelect) onActionSelect(item);
    };

    const filteredActions = analysis.actions.filter((a: ActionItem) => {
        if (currentView === 'traffic') return true;
        if (currentView === 'geofences') return a.type !== 'road';
        return true;
    });

    const handleDragStart = (e: React.DragEvent, zoneId: number) => {
        e.dataTransfer.setData('zoneId', zoneId.toString());
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const zoneIdStr = e.dataTransfer.getData('zoneId');
        if (!zoneIdStr) return;

        const zoneId = Number(zoneIdStr);
        if (isNaN(zoneId)) return;

        // Check limit and duplicates
        const current = new Set(monitoredZoneIds);
        if (current.has(zoneId)) return; // Already exists

        if (current.size >= 4) {
            alert("Maximum 4 geofences can be monitored at once.");
            return;
        }

        const newIds = [...monitoredZoneIds, zoneId];
        onMonitorZones?.(newIds);
    };

    const handleRemoveMonitor = (zoneId: number) => {
        const newIds = monitoredZoneIds.filter(id => id !== zoneId);
        onMonitorZones?.(newIds);
    };

    if (currentView === 'summary') {
        return (
            <div className="space-y-6">
                <div className="flex justify-center">
                    <div
                        onClick={() => onViewChange('geofences')}
                        className="bg-surface-card rounded-[32px] border border-primary/30 mt-3 shadow-md p-6 w-full group hover:shadow-xl transition-all duration-500 cursor-pointer overflow-hidden relative"
                    >
                        <h3 className="text-muted-foreground text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                            <MapPin size={14} className="text-primary" /> Track Geofences
                        </h3>
                        {/* ... (Geofence List items remain same) ... */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 flex-1 content-start">
                            {[...zones].sort((a, b) => b.vehicleCount - a.vehicleCount).slice(0, 12).map((zone) => (
                                <div
                                    key={zone.id}
                                    draggable="true"
                                    onDragStart={(e) => handleDragStart(e, zone.id)}
                                    className="flex items-center justify-between p-3.5 rounded-xl bg-muted/30 border border-primary/20 hover:bg-surface-raised hover:shadow-sm transition-all cursor-grab active:cursor-grabbing"
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-1.5 h-1.5 shrink-0 rounded-full border-2 border-border" style={{ backgroundColor: zone.color }}></div>
                                        <span className="text-xs font-black text-foreground truncate uppercase">{zone.name}</span>
                                    </div>
                                    <div className="px-2 py-1 bg-surface-raised rounded-lg border border-border shadow-sm">
                                        <span className="text-[10px] font-black text-primary">{zone.vehicleCount}</span>
                                    </div>
                                </div>
                            ))}
                            {zones.length === 0 && (
                                <div className="col-span-full text-center py-6 text-muted-foreground text-[10px] font-black uppercase tracking-widest opacity-30">
                                    No Active Geofences
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex justify-center">
                    <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                        className="bg-surface-card rounded-[32px] border border-emerald-500/30 shadow-md p-6 w-full group hover:shadow-xl transition-all duration-500 overflow-hidden relative min-h-[200px]"
                    >
                        <h3 className="text-muted-foreground text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Eye size={14} className="text-emerald-500" /> Live Observation
                        </h3>

                        {monitoredGeofences.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[150px] border-2 border-dashed border-border rounded-xl bg-muted/10">
                                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground text-center px-8 opacity-50">
                                    Drag geofences from the above tab and put them here for monitoring
                                </p>
                            </div>
                        ) : (
                            <div className={cn("grid gap-4 animate-in fade-in zoom-in duration-500", monitoredGeofences.length === 1 ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-4')}>
                                {monitoredGeofences.map(zone => {
                                    const avgDwell = zone.vehicleCount > 0
                                        ? Object.values(zone.occupants).reduce((acc, occ) => acc + (Date.now() - occ.entryTime), 0) / zone.vehicleCount
                                        : 0;

                                    return (
                                        <div key={zone.id} className="bg-muted/20 rounded-2xl border border-border overflow-hidden flex flex-col h-[320px]">
                                            {/* Header */}
                                            <div className="p-4 bg-surface-card/50 border-b border-border flex flex-col gap-2 shrink-0 relative">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveMonitor(zone.id); }}
                                                    className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                                                >
                                                    <X size={14} />
                                                </button>

                                                <div className="flex items-center gap-2 pr-6">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
                                                    <span className="text-sm font-black uppercase truncate tracking-tight text-foreground" title={zone.name}>{zone.name}</span>
                                                </div>

                                                <div className="flex items-center gap-2 mt-1">
                                                    <div className="px-2 py-1 bg-surface-raised rounded-md text-[10px] font-bold border border-border shadow-sm">
                                                        {zone.vehicleCount} Assets Inside
                                                    </div>
                                                    {zone.vehicleCount > 0 && (
                                                        <div className="px-2 py-1 bg-blue-500/10 text-blue-600 rounded-md text-[10px] font-bold border border-blue-500/20">
                                                            Avg: {formatDuration(avgDwell)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-card/30 p-2">
                                                {zone.vehicleIds.length > 0 ? (
                                                    <div className="space-y-2">
                                                        {zone.vehicleIds.map(vId => {
                                                            const occupant = zone.occupants[vId];
                                                            const dwell = occupant ? formatDuration(Date.now() - occupant.entryTime) : '--';
                                                            return (
                                                                <div key={vId} className="px-3 py-2.5 bg-surface-card border border-border/50 rounded-xl shadow-sm hover:shadow-md transition-all flex flex-col gap-1.5 group">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-[11px] font-black truncate text-foreground group-hover:text-primary transition-colors">{trackerLabels[vId] || vId}</span>
                                                                        <StatusBadge status={occupant?.status || 'Active'} />
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                                                                        <Clock size={10} className="text-primary/70" />
                                                                        <span>{dwell}</span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                                                        <p className="text-[10px] font-black text-muted-foreground uppercase opacity-30 italic">No assets inside</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (currentView === 'monitor') {
        return (
            <div className="flex flex-col h-full bg-surface-card rounded-2xl border border-border shadow-md overflow-hidden min-h-[500px] animate-in slide-in-from-right duration-500">
                <div className="p-5 border-b border-border flex items-center gap-4 bg-muted/20">
                    <button onClick={() => onViewChange('summary')} className="p-2 bg-surface-raised border border-border rounded-xl shadow-sm hover:bg-muted transition-all"><ArrowLeft size={18} /></button>
                    <div>
                        <h2 className="text-sm font-black text-foreground uppercase tracking-tight leading-none mb-1">Observation Hub</h2>
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{monitoredGeofences.length} Monitors Active</p>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-muted/5 custom-scrollbar">
                    {monitoredGeofences.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 px-6 text-center bg-surface-card rounded-3xl border border-dashed border-border h-full">
                            <Eye className="text-muted-foreground opacity-10 mb-6" size={64} />
                            <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-8 max-w-[240px]">Queue observation targets in the registry section</p>
                            <button onClick={() => onViewChange('geofences')} className="px-8 py-3 bg-primary text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-primary/20 hover:scale-105 transition-all">Select Targets</button>
                        </div>
                    ) : (
                        monitoredGeofences.map(zone => (
                            <div key={zone.id} onClick={() => onSelectZone?.(zone.id)} className="bg-surface-card rounded-[32px] border border-border shadow-sm overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-500">
                                <div className="p-5 border-b border-border bg-muted/5 flex justify-between items-center group">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-surface-raised border border-border rounded-2xl shadow-sm text-primary group-hover:bg-primary group-hover:text-white transition-colors"><MapPin size={22} /></div>
                                        <div>
                                            <h3 className="font-black text-foreground text-sm uppercase tracking-tight">{zone.name}</h3>
                                            <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest">Surveillance Sector</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-6 pr-8">
                                        <div className="text-right">
                                            <p className="text-2xl font-black text-foreground leading-none">{Object.keys(zone.occupants || {}).length}</p>
                                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Occupants</p>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); handleRemoveMonitor(zone.id); }} className="p-2 text-muted-foreground hover:text-red-500"><X size={18} /></button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-4">Current Signals</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {Object.values(zone.occupants || {}).map(occ => (
                                            <div key={occ.trackerId} className="flex justify-between items-center p-4 bg-muted/20 rounded-2xl border border-border hover:bg-surface-raised hover:shadow-md transition-all">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn("w-1.5 h-1.5 rounded-full", occ.status.toLowerCase().includes('moving') ? 'bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-blue-500')}></div>
                                                    <div>
                                                        <div className="text-[11px] font-black text-foreground uppercase">{trackerLabels?.[occ.trackerId] || occ.trackerId}</div>
                                                        <div className="text-[8px] font-black text-muted-foreground uppercase tracking-widest opacity-50">{occ.status}</div>
                                                    </div>
                                                </div>
                                                <div className="px-3 py-1.5 bg-surface-raised rounded-lg border border-border shadow-inner font-black text-[10px] text-primary">{formatDuration(Date.now() - occ.entryTime)}</div>
                                            </div>
                                        ))}
                                        {Object.keys(zone.occupants || {}).length === 0 && <div className="col-span-2 py-8 text-center text-[10px] font-black text-muted-foreground uppercase opacity-20 italic">No signals identified</div>}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-surface-card rounded-2xl border border-border shadow-md overflow-hidden animate-in fade-in duration-500">
            <div className="p-5 border-b border-border bg-muted/10 flex items-center gap-4">
                <button onClick={() => { setSelectedId(null); onViewChange('summary'); }} className="p-2 bg-surface-raised border border-border rounded-xl shadow-sm hover:bg-muted transition-all">
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h2 className="text-sm font-black text-foreground uppercase tracking-tight">{currentView === 'traffic' ? 'Network Congestion' : 'Intelligence Report'}</h2>
                    <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{filteredActions.length} System Vectors</p>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/5 custom-scrollbar">
                {filteredActions.length === 0 ? (
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-3xl p-16 text-center">
                        <div className="inline-flex bg-surface-raised p-6 rounded-3xl shadow-lg border border-border mb-6"><ShieldCheck className="text-emerald-500" size={40} /></div>
                        <h4 className="font-black text-emerald-900 text-xs uppercase tracking-widest leading-none mb-2">Sector Normalized</h4>
                        <p className="text-[10px] font-bold text-emerald-600/50 uppercase">No anomalies detected in current radius</p>
                    </div>
                ) : (
                    filteredActions.map((item: ActionItem) => (
                        <div
                            key={item.id}
                            onClick={() => handleActionClick(item)}
                            className={cn(
                                "group bg-surface-card rounded-3xl border p-5 shadow-sm transition-all cursor-pointer relative overflow-hidden",
                                selectedId === item.id ? 'ring-2 ring-primary border-primary shadow-xl' : 'hover:border-primary/40 hover:shadow-xl hover:-translate-y-1'
                            )}
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-4">
                                    <div className={cn("p-3 rounded-2xl", item.severity === 'high' ? 'bg-red-500/10 text-red-600' : 'bg-orange-500/10 text-orange-600')}>
                                        {getIcon(item.type)}
                                    </div>
                                    <div>
                                        <h4 className="font-black text-foreground text-xs uppercase tracking-tight leading-tight mb-1">{item.title}</h4>
                                        <p className="text-[10px] text-muted-foreground font-black truncate uppercase max-w-[180px] opacity-60 tracking-wider font-mono">{item.location}</p>
                                    </div>
                                </div>
                                <div className="px-3 py-1.5 bg-primary text-white rounded-xl font-black text-[10px] shadow-lg shadow-primary/20">{item.count} NODES</div>
                            </div>
                            <div className="pl-14">
                                <p className="text-[11px] font-bold text-muted-foreground bg-muted p-4 rounded-2xl border border-border/50 leading-relaxed mb-4">{item.action}</p>
                                <div className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">
                                    Execute Target Sweep <ArrowRight size={12} />
                                </div>
                            </div>
                            {selectedId === item.id && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary shadow-[0_0_15px_rgba(59,130,246,0.5)]" />}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
