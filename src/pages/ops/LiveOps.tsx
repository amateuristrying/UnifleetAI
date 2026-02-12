import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavixyRealtime } from '@/hooks/useNavixyRealtime';
import { useFleetAnalysis } from '@/hooks/useFleetAnalysis';
import { useGeofences } from '@/hooks/useGeofences';
import { useOps } from '@/context/OpsContext';

import RealtimeMap from '@/components/ops/RealtimeMap';
import RealtimeInsights from '@/components/ops/RealtimeInsights';
import GeofencePanel from '@/components/ops/GeofencePanel';
import VehicleSearch from '@/components/ops/VehicleSearch';
import VehiclePanel from '@/components/ops/VehiclePanel';
import NavixyDataInspector from '@/components/ops/NavixyDataInspector';

import { Loader2, ArrowLeft, RefreshCw, MapPin, Truck, ShieldCheck, Zap } from 'lucide-react';
import { NavixyService } from '@/services/navixy';
import { cn } from '@/lib/utils';
import type { CreateZonePayload } from '@/types/geofence';
import { CUSTOM_TRACKER_LABELS } from '@/config/vehicleDirectory';

type MainMode = 'geofence' | 'fleet';

export default function LiveOps() {
    const [searchParams] = useSearchParams();
    const geofenceIdParam = searchParams.get('geofence_id');
    const trackerIdParam = searchParams.get('tracker_id');
    const viewModeParam = searchParams.get('view');
    const regionParam = searchParams.get('region') as 'TZ' | 'ZM' | null;

    const isLocked = viewModeParam === 'locked';
    const isVehicleLocked = isLocked && !!trackerIdParam;
    const isGeofenceLocked = isLocked && !!geofenceIdParam;

    const { ops, setOps } = useOps();

    const [trackerIds, setTrackerIds] = useState<number[]>([]);
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});

    const [mainMode, setMainMode] = useState<MainMode>(isVehicleLocked ? 'fleet' : 'geofence');
    const [currentView, setCurrentView] = useState<'summary' | 'traffic' | 'geofences' | 'monitor'>(isGeofenceLocked ? 'geofences' : 'summary');

    const [focusedAction, setFocusedAction] = useState<any | null>(null);
    const [selectedTrackerId, setSelectedTrackerId] = useState<number | null>(trackerIdParam ? Number(trackerIdParam) : null);

    const [drawingMode, setDrawingMode] = useState<'none' | 'polygon' | 'corridor' | 'circle'>('none');
    const [drawnPayload, setDrawnPayload] = useState<CreateZonePayload | null>(null);
    const [monitoredZoneIds, setMonitoredZoneIds] = useState<number[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);

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
    const { zones, selectedZoneId, setSelectedZoneId, createZone, refreshZones } = useGeofences(trackerStates, sessionKey || '');

    // URL Sync
    useEffect(() => {
        if (isGeofenceLocked && geofenceIdParam) {
            setSelectedZoneId(Number(geofenceIdParam));
        }
        if (isVehicleLocked && trackerIdParam) {
            setSelectedTrackerId(Number(trackerIdParam));
        }
        if (regionParam) {
            setOps(regionParam === 'TZ' ? 'tanzania' : 'zambia');
        }
    }, [isGeofenceLocked, geofenceIdParam, isVehicleLocked, trackerIdParam, regionParam, setSelectedZoneId]);

    const handleGlobalRefresh = async () => {
        setIsRefreshing(true);
        await refreshZones();
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const handleRegionChange = (newRegion: 'TZ' | 'ZM') => {
        setOps(newRegion === 'TZ' ? 'tanzania' : 'zambia');
        setSelectedTrackerId(null);
    };

    // Layout configuration
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
        <div className={cn("flex flex-col h-full bg-background transition-all duration-500", !showSidebar && "p-4")}>
            {/* Premium Header */}
            {!isLocked && (
                <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-white/50 backdrop-blur-xl sticky top-0 z-20">
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter leading-none flex items-center gap-2">
                                <Zap className="text-primary fill-primary" size={24} />
                                Live Operations Hub
                            </h1>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Network Surveillance Mode</span>
                                <div className="w-1 h-1 rounded-full bg-border" />
                                <span className="text-[10px] font-black text-primary uppercase tracking-widest">{region} Sector</span>
                            </div>
                        </div>

                        {/* Mode Switcher */}
                        <div className="flex bg-muted p-1 rounded-xl border border-border ml-8">
                            <button
                                onClick={() => setMainMode('geofence')}
                                className={cn(
                                    "flex items-center gap-2 px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                    mainMode === 'geofence' ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <MapPin size={14} /> Geofences
                            </button>
                            <button
                                onClick={() => setMainMode('fleet')}
                                className={cn(
                                    "flex items-center gap-2 px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                    mainMode === 'fleet' ? "bg-white text-emerald-600 shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Truck size={14} /> Global Fleet
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        {loading && <Loader2 className="animate-spin text-primary" size={20} />}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleGlobalRefresh}
                                className="h-10 px-4 bg-white border border-border rounded-xl hover:bg-muted text-foreground transition-all shadow-sm flex items-center gap-3 active:scale-95"
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
            <div className="flex-1 p-8 overflow-hidden flex flex-col min-h-0">

                {/* Geofence Mode */}
                {mainMode === 'geofence' && (
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

                                        {currentView === 'geofences' && (
                                            <div className="flex bg-muted p-0.5 rounded-lg border border-border">
                                                <button onClick={() => handleRegionChange('TZ')} className={cn("px-3 py-1 rounded-md text-[9px] font-black uppercase", region === 'TZ' ? "bg-white text-primary" : "text-muted-foreground")}>TZ</button>
                                                <button onClick={() => handleRegionChange('ZM')} className={cn("px-3 py-1 rounded-md text-[9px] font-black uppercase", region === 'ZM' ? "bg-white text-primary" : "text-muted-foreground")}>ZM</button>
                                            </div>
                                        )}
                                    </div>

                                    {currentView === 'geofences' ? (
                                        <GeofencePanel
                                            zones={zones}
                                            selectedZoneId={selectedZoneId}
                                            trackerLabels={trackerLabels}
                                            onSelectZone={setSelectedZoneId}
                                            onCreateZone={createZone}
                                            onStartDrawing={setDrawingMode}
                                            onCancelDrawing={() => setDrawingMode('none')}
                                            drawnPayload={drawnPayload}
                                            monitoredZoneIds={monitoredZoneIds}
                                            onMonitorZones={setMonitoredZoneIds}
                                            region={region}
                                            onRefresh={refreshZones}
                                            viewMode={isLocked ? 'locked' : 'unlocked'}
                                        />
                                    ) : (
                                        <RealtimeInsights
                                            analysis={analysis}
                                            currentView={currentView}
                                            onViewChange={setCurrentView}
                                            onActionSelect={setFocusedAction}
                                            zones={zones}
                                            trackerLabels={trackerLabels}
                                            monitoredZoneIds={monitoredZoneIds}
                                            onToggleMonitorZone={(id) => setMonitoredZoneIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])}
                                            onSelectZone={setSelectedZoneId}
                                        />
                                    )}
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
                                        onDrawComplete={(p) => { setDrawnPayload(p); setDrawingMode('none'); }}
                                        onDrawCancel={() => setDrawingMode('none')}
                                        viewMode={isLocked ? 'locked' : 'unlocked'}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Fleet Mode */}
                {mainMode === 'fleet' && (
                    <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
                        <div className="lg:col-span-4 flex flex-col min-h-0">
                            {selectedTrackerId ? (
                                <VehiclePanel
                                    trackerId={selectedTrackerId}
                                    trackerState={trackerStates[selectedTrackerId] || null}
                                    trackerLabel={trackerLabels[selectedTrackerId] || `Asset #${selectedTrackerId}`}
                                    region={region}
                                    viewMode={isLocked ? 'locked' : 'unlocked'}
                                    zones={zones}
                                    onBack={() => setSelectedTrackerId(null)}
                                    onRefresh={handleGlobalRefresh}
                                />
                            ) : (
                                <VehicleSearch
                                    trackerLabels={trackerLabels}
                                    trackerStates={trackerStates}
                                    region={region}
                                    onRegionChange={handleRegionChange}
                                    onSelectVehicle={setSelectedTrackerId}
                                />
                            )}
                        </div>
                        <div className="lg:col-span-8 h-full min-h-[500px]">
                            <RealtimeMap
                                trackers={selectedTrackerId && trackerStates[selectedTrackerId] ? { [selectedTrackerId]: trackerStates[selectedTrackerId] } : trackerStates}
                                trackerLabels={trackerLabels}
                                analysis={selectedTrackerId ? null : analysis}
                                focusedTrackerId={selectedTrackerId}
                                zones={zones}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Debug Inspector */}
            {!isLocked && <NavixyDataInspector trackerStates={trackerStates} trackerLabels={trackerLabels} />}
        </div>
    );
}
