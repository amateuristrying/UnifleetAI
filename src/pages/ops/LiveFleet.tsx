import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavixyRealtime } from '@/hooks/useNavixyRealtime';
import { useFleetAnalysis } from '@/hooks/useFleetAnalysis';
import { useGeofences } from '@/hooks/useGeofences';
import { useOps } from '@/context/OpsContext';

import RealtimeMap from '@/components/ops/RealtimeMap';
import VehicleSearch from '@/components/ops/VehicleSearch';
import VehiclePanel from '@/components/ops/VehiclePanel';
import NavixyDataInspector from '@/components/ops/NavixyDataInspector';

import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { NavixyService } from '@/services/navixy';
import { cn } from '@/lib/utils';
import { CUSTOM_TRACKER_LABELS } from '@/config/vehicleDirectory';

export default function LiveFleet() {
    const [searchParams] = useSearchParams();
    const trackerIdParam = searchParams.get('tracker_id');
    const viewModeParam = searchParams.get('view');
    const regionParam = searchParams.get('region') as 'TZ' | 'ZM' | null;

    const isLocked = viewModeParam === 'locked';
    const isVehicleLocked = isLocked && !!trackerIdParam;

    const { ops, setOps } = useOps();

    const [trackerIds, setTrackerIds] = useState<number[]>([]);
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});

    const [selectedTrackerId, setSelectedTrackerId] = useState<number | null>(trackerIdParam ? Number(trackerIdParam) : null);
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
    const { zones, refreshZones } = useGeofences(trackerStates, sessionKey || '', trackerIds);

    // URL Sync
    useEffect(() => {
        if (isVehicleLocked && trackerIdParam) {
            setSelectedTrackerId(Number(trackerIdParam));
        }
        if (regionParam) {
            setOps(regionParam === 'TZ' ? 'tanzania' : 'zambia');
        }
    }, [isVehicleLocked, trackerIdParam, regionParam]);

    const handleGlobalRefresh = async () => {
        setIsRefreshing(true);
        await refreshZones();
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const handleRegionChange = (newRegion: 'TZ' | 'ZM') => {
        setOps(newRegion === 'TZ' ? 'tanzania' : 'zambia');
        setSelectedTrackerId(null);
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
        <div className={cn("flex flex-col h-full transition-all duration-500", !showSidebar && "p-4")}>
            <div className="flex-1 flex flex-col min-h-0 m-4 lg:m-6 rounded-[40px] bg-surface-card shadow-xl border border-border/50 overflow-hidden">
                {/* Premium Header - Nested in surface box for better containment */}
                {!isLocked && (
                    <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-surface-card/80 backdrop-blur-xl sticky top-0 z-20">
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col">
                                <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter leading-none">
                                    Live Fleet Monitoring
                                </h1>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Network Surveillance Mode</span>
                                    <div className="w-1 h-1 rounded-full bg-border" />
                                    <span className="text-[10px] font-black text-primary uppercase tracking-widest">{region} Sector</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-6">
                            {loading && <Loader2 className="animate-spin text-primary" size={20} />}
                            <div className="flex items-center gap-3">
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
                <div className="flex-1 p-6 lg:p-10 overflow-hidden flex flex-col min-h-0 w-full">
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
                </div>
            </div>

            {/* Debug Inspector */}
            {!isLocked && <NavixyDataInspector trackerStates={trackerStates} trackerLabels={trackerLabels} />}
        </div>
    );
}
