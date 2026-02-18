import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavixyRealtime } from '@/hooks/useNavixyRealtime';
import { useFleetAnalysis } from '@/hooks/useFleetAnalysis';
import { useGeofences } from '@/hooks/useGeofences';
import { useOps } from '@/context/OpsContext';
import { useAuth } from '@/context/AuthContext';

import RealtimeMap from '@/components/ops/RealtimeMap';
import RealtimeInsights from '@/components/ops/RealtimeInsights';
import GeofencePanel from '@/components/ops/GeofencePanel';
import NavixyDataInspector from '@/components/ops/NavixyDataInspector';

import { Loader2, ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { NavixyService } from '@/services/navixy';
import { cn } from '@/lib/utils';
import type { CreateZonePayload } from '@/types/geofence';
import { CUSTOM_TRACKER_LABELS } from '@/config/vehicleDirectory';

export default function LiveGeofences() {
    const [searchParams] = useSearchParams();
    const geofenceIdParam = searchParams.get('geofence_id');
    const viewModeParam = searchParams.get('view');
    const regionParam = searchParams.get('region') as 'TZ' | 'ZM' | null;

    const isLocked = viewModeParam === 'locked';
    const isGeofenceLocked = isLocked && !!geofenceIdParam;

    const { ops, setOps } = useOps();
    const { checkPermission } = useAuth();

    const [trackerIds, setTrackerIds] = useState<number[]>([]);
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});

    const [currentView, setCurrentView] = useState<'summary' | 'traffic' | 'geofences' | 'monitor'>(isGeofenceLocked ? 'geofences' : 'summary');

    const [focusedAction, setFocusedAction] = useState<any | null>(null);

    const [drawingMode, setDrawingMode] = useState<'none' | 'polygon' | 'circle'>('none');
    const [drawingRadius, setDrawingRadius] = useState<number>(0);
    const [drawnPayload, setDrawnPayload] = useState<CreateZonePayload | null>(null);

    // Persistence for monitored zones
    const [monitoredZoneIds, setMonitoredZoneIds] = useState<number[]>(() => {
        try {
            const key = ops === 'tanzania' ? 'monitored_zones_TZ' : 'monitored_zones_ZM';
            const saved = localStorage.getItem(key);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    // Save persistence
    useEffect(() => {
        const key = ops === 'tanzania' ? 'monitored_zones_TZ' : 'monitored_zones_ZM';
        localStorage.setItem(key, JSON.stringify(monitoredZoneIds));
    }, [monitoredZoneIds, ops]);

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [panelViewMode, setPanelViewMode] = useState<'list' | 'create' | 'detail'>('list');

    // Map Ops to Region
    const region = ops === 'tanzania' ? 'TZ' : 'ZM';

    // Session Key mapping
    const SESSION_KEYS: Record<'TZ' | 'ZM', string | undefined> = {
        TZ: import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ,
        ZM: import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM,
    };

    const sessionKey = SESSION_KEYS[region];

    useEffect(() => {
        if (!sessionKey) return;

        setTrackerIds([]);
        setTrackerLabels({});
        setMonitoredZoneIds([]);
        // Re-load per ops (though initial state handles mount, switching ops needs manual reload)
        const key = ops === 'tanzania' ? 'monitored_zones_TZ' : 'monitored_zones_ZM';
        try {
            const saved = localStorage.getItem(key);
            if (saved) setMonitoredZoneIds(JSON.parse(saved));
        } catch { }

        const initTrackers = async () => {
            try {
                const list = await NavixyService.listTrackers(sessionKey);
                if (list && list.length > 0) {
                    const labels: Record<number, string> = {};
                    const ids: number[] = [];
                    list.forEach((t: any) => {
                        const id = t.source?.id || t.id;
                        if (id) {
                            ids.push(id);
                            labels[id] = t.label;
                        }
                    });
                    setTrackerIds(ids);
                    setTrackerLabels({ ...labels, ...CUSTOM_TRACKER_LABELS });
                }
            } catch (err) {
                console.error('Failed to init trackers:', err);
            }
        };
        initTrackers();
    }, [sessionKey]);

    const { trackerStates, loading } = useNavixyRealtime(trackerIds, sessionKey || '');
    const analysis = useFleetAnalysis(trackerStates);
    const { zones, selectedZoneId, setSelectedZoneId, createZone, deleteZone, refreshZones } = useGeofences(trackerStates, sessionKey || '');

    // URL Sync
    useEffect(() => {
        if (isGeofenceLocked && geofenceIdParam) {
            setSelectedZoneId(Number(geofenceIdParam));
        }
        if (regionParam) {
            setOps(regionParam === 'TZ' ? 'tanzania' : 'zambia');
        }
    }, [isGeofenceLocked, geofenceIdParam, regionParam, setSelectedZoneId]);

    const handleGlobalRefresh = async () => {
        setIsRefreshing(true);
        await refreshZones();
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const handleRegionChange = (newRegion: 'TZ' | 'ZM') => {
        setOps(newRegion === 'TZ' ? 'tanzania' : 'zambia');
    };

    const showSidebar = !isLocked;

    if (!sessionKey) {
        return (
            <div className="p-8 flex items-center justify-center h-full">
                <div className="max-w-md bg-red-50 border border-red-200 p-6 rounded-2xl text-center">
                    <ShieldCheck className="mx-auto text-red-500 mb-4" size={48} />
                    <h2 className="text-xl font-black text-red-900 uppercase tracking-tight mb-2">Auth Required</h2>
                    <p className="text-sm text-red-700">Missing session key for {region} operations. Please check environment configuration.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col h-full bg-surface-main transition-all duration-500 overflow-hidden", !showSidebar ? "p-4" : "p-6 lg:p-8 gap-6")}>

            {/* Premium Header - Standalone Card */}
            {!isLocked && (
                <div className="bg-surface-card border border-border rounded-3xl px-8 py-6 flex items-center justify-between shadow-sm shrink-0">
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter leading-none">
                                Live Geofence Monitoring
                            </h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Network Surveillance Mode</span>
                                <div className="w-1 h-1 rounded-full bg-border" />
                                <span className="text-[10px] font-black text-primary uppercase tracking-widest">{region} Sector</span>
                            </div>
                        </div>

                        {/* Ops Switch */}
                        {checkPermission('admin_only') && (
                            <div className="flex bg-muted p-1 rounded-xl border border-border ml-8">
                                <button
                                    onClick={() => handleRegionChange('TZ')}
                                    className={cn(
                                        "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        region === 'TZ' ? "bg-surface-raised text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Tanzania
                                </button>
                                <button
                                    onClick={() => handleRegionChange('ZM')}
                                    className={cn(
                                        "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        region === 'ZM' ? "bg-surface-raised text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Zambia
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-6">
                        {loading && <Loader2 className="animate-spin text-primary" size={20} />}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    setCurrentView('geofences');
                                    setPanelViewMode('create');
                                }}
                                className="h-10 px-4 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-primary/90 transition-all shadow-sm flex items-center gap-2 active:scale-95"
                            >
                                <span className="text-lg leading-none">+</span> Add Zone
                            </button>
                            <button
                                onClick={handleGlobalRefresh}
                                className="h-10 px-4 bg-surface-raised border border-border rounded-xl hover:bg-muted text-foreground transition-all shadow-sm flex items-center gap-3 active:scale-95"
                            >
                                <RefreshCw size={14} className={cn(isRefreshing && "animate-spin text-primary")} />
                                <span className="text-[10px] font-black uppercase tracking-widest">Resync</span>
                            </button>
                            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Signal Active</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Workspace */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0 w-full">
                <div className="flex-1 flex flex-col min-h-0 gap-6">
                    {currentView === 'summary' ? (
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                            <RealtimeInsights
                                analysis={analysis}
                                currentView={currentView}
                                onViewChange={setCurrentView}
                                onActionSelect={setFocusedAction}
                                zones={zones}
                                trackerLabels={trackerLabels}
                                monitoredZoneIds={monitoredZoneIds}
                                onMonitorZones={setMonitoredZoneIds}
                            />
                        </div>
                    ) : (
                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
                            {/* Side Panel (4 cols) */}
                            <div className="lg:col-span-4 flex flex-col min-h-0">
                                <div className="mb-4 flex items-center justify-between">
                                    <button
                                        onClick={() => setCurrentView('summary')}
                                        className="group flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                                        Return to Intelligence
                                    </button>
                                </div>

                                <GeofencePanel
                                    zones={zones}
                                    selectedZoneId={selectedZoneId}
                                    trackerLabels={trackerLabels}
                                    onSelectZone={setSelectedZoneId}
                                    onCreateZone={createZone}
                                    onDeleteZone={deleteZone}
                                    onStartDrawing={setDrawingMode}
                                    onCancelDrawing={() => { setDrawingMode('none'); setDrawnPayload(null); setDrawingRadius(0); }}
                                    drawnPayload={drawnPayload}
                                    monitoredZoneIds={monitoredZoneIds}
                                    onMonitorZones={setMonitoredZoneIds}
                                    region={region}
                                    onRefresh={refreshZones}
                                    viewMode={isLocked ? 'locked' : 'unlocked'}
                                    externalViewMode={panelViewMode}
                                    onViewModeChange={setPanelViewMode}
                                    drawingRadius={drawingRadius}
                                    onRadiusChange={setDrawingRadius}
                                />
                            </div>

                            {/* Map Area (8 cols) */}
                            <div className="lg:col-span-8 h-full min-h-[500px]">
                                <RealtimeMap
                                    trackers={trackerStates}
                                    trackerLabels={trackerLabels}
                                    analysis={analysis}
                                    showDelays={currentView === 'traffic'}
                                    focusedAction={focusedAction}
                                    zones={zones}
                                    selectedZoneId={selectedZoneId}
                                    onSelectZone={setSelectedZoneId}
                                    drawingMode={drawingMode}
                                    onDrawComplete={(p) => {
                                        setDrawnPayload(p);
                                        // For circles, keep drawingMode so preview stays visible
                                        // For others, exit drawing mode
                                        if (p.type !== 'circle') {
                                            setDrawingMode('none');
                                        }
                                    }}
                                    onDrawCancel={() => setDrawingMode('none')}
                                    viewMode={isLocked ? 'locked' : 'unlocked'}
                                    drawingRadius={drawingRadius}
                                    onRadiusChange={setDrawingRadius}
                                    drawnPayload={drawnPayload}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Debug Inspector */}
            {!isLocked && <NavixyDataInspector trackerStates={trackerStates} trackerLabels={trackerLabels} />}
        </div>
    );
}
