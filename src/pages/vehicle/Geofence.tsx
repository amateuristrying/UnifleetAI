import { useState, useEffect, useRef, useCallback } from 'react';
import Map, { NavigationControl } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOps } from '@/context/OpsContext';
import type { OpsKey } from '@/context/OpsContext';
import { useTheme } from '@/context/ThemeProvider';

import { NavixyService, type NavixyTrackerState } from '@/services/navixy';
import { useNavixyRealtime } from '../../hooks/useNavixyRealtime';
import { useGeofences } from '@/hooks/useGeofences';
import GeofencePanel from '@/components/geofence/GeofencePanel';
import GeofenceMapOverlay from '@/components/geofence/GeofenceMapOverlay';
import { getTruckIconSvg } from '@/components/map/TruckIcon';
import type { CreateZonePayload } from '@/types/geofence';
import type { VehicleStatus } from '@/data/mock';

// ── Symbol-layer constants ──
const VEHICLE_SOURCE = 'geofence-vehicles-src';
const VEHICLE_LAYER = 'geofence-vehicles-layer';
const ICON_SIZE = 24;

/** Status keys used for icon image names */
const STATUS_LIST: VehicleStatus[] = ['Running', 'Stopped', 'Idle', 'Not Online', 'Not Working'];
const statusToIconName = (s: VehicleStatus) => `geo-vehicle-${s.replace(/\s+/g, '-').toLowerCase()}`;

/** Load the 5 status SVGs into a Mapbox map as images (idempotent) */
function ensureVehicleImages(map: mapboxgl.Map) {
    STATUS_LIST.forEach(status => {
        const name = statusToIconName(status);
        if (map.hasImage(name)) return;

        const svg = getTruckIconSvg(status, false, 0);
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const img = new Image(ICON_SIZE, ICON_SIZE);
        img.onload = () => {
            if (!map.hasImage(name)) {
                map.addImage(name, img, { sdf: false });
            }
            URL.revokeObjectURL(url);
        };
        img.src = url;
    });
}

/**
 * Determine display‐status from the raw Navixy tracker state.
 * Must return one of the VehicleStatus union values used by <TruckIcon>.
 */
function deriveVehicleStatus(
    state: NavixyTrackerState | undefined
): VehicleStatus {
    if (!state) return 'Not Online';

    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const lastUpdate = state.last_update
        ? new Date(state.last_update.replace(' ', 'T') + 'Z').getTime()
        : 0;
    const isStale = Date.now() - lastUpdate > TWENTY_FOUR_HOURS;

    if (state.connection_status === 'offline') {
        return isStale ? 'Not Working' : 'Not Online';
    }

    if (state.movement_status === 'moving') return 'Running';
    if (state.movement_status === 'stopped') {
        return state.ignition ? 'Idle' : 'Stopped';
    }
    if (state.movement_status === 'parked') return 'Stopped';

    return 'Not Online';
}

export function Geofence() {
    const navigate = useNavigate();
    const mapRef = useRef<MapRef>(null);
    const { ops, setOps } = useOps();
    const { resolved } = useTheme();
    const mapToken = import.meta.env.VITE_MAPBOX_TOKEN;

    // Region-specific session key
    const SESSION_KEYS: Record<OpsKey, string> = {
        zambia: import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM,
        tanzania: import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ,
    };
    const sessionKey = SESSION_KEYS[ops];

    // Load tracker IDs
    const [trackerIds, setTrackerIds] = useState<number[]>([]);
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});

    useEffect(() => {
        if (!sessionKey) return;
        NavixyService.listTrackers(sessionKey).then((list: any[]) => {
            if (list?.length > 0) {
                const ids: number[] = [];
                const labels: Record<number, string> = {};
                list.forEach((t: any) => {
                    const id = t.source?.id || t.id;
                    if (id) { ids.push(id); labels[id] = t.label; }
                });
                setTrackerIds(ids);
                setTrackerLabels(labels);
            }
        });
    }, [sessionKey]);

    // Real-time tracker states
    const { trackerStates, loading: trackersLoading } = useNavixyRealtime(trackerIds, sessionKey);

    // Geofences
    const {
        zones, loading: zonesLoading,
        selectedZoneId, setSelectedZoneId,
        createZone, deleteZone, refreshZones,
    } = useGeofences(trackerStates, sessionKey);

    // Drawing state
    const [drawingMode, setDrawingMode] = useState<'none' | 'polygon' | 'corridor' | 'circle'>('none');
    const [drawnPayload, setDrawnPayload] = useState<CreateZonePayload | null>(null);
    const [monitoredZoneIds, setMonitoredZoneIds] = useState<number[]>([]);

    const handleStartDrawing = (mode: 'polygon' | 'corridor' | 'circle') => {
        setDrawingMode(mode);
        setDrawnPayload(null);
    };

    const handleDrawComplete = (payload: CreateZonePayload) => {
        setDrawnPayload(payload);
        setDrawingMode('none');
    };

    const handleCancelDrawing = () => {
        setDrawingMode('none');
        setDrawnPayload(null);
    };

    // Map view state
    const [viewState, setViewState] = useState({
        longitude: 36.8,
        latitude: -1.3,
        zoom: 6,
    });

    // Center map on first tracker data
    useEffect(() => {
        const entries = Object.values(trackerStates) as NavixyTrackerState[];
        if (entries.length > 0 && viewState.zoom === 6) {
            const valid = entries.filter(s => s.gps?.location);
            if (valid.length === 0) return;

            const avgLat = valid.reduce((a, s) => a + (s.gps.location.lat || 0), 0) / valid.length;
            const avgLng = valid.reduce((a, s) => a + (s.gps.location.lng || 0), 0) / valid.length;

            if (avgLat && avgLng) {
                setViewState(prev => ({ ...prev, latitude: avgLat, longitude: avgLng }));
            }
        }
    }, [Object.keys(trackerStates).length > 0]);

    // ── GPU-rendered vehicle symbol layer (replaces 1200+ React Markers) ──
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const updateVehicleLayer = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map || !map.isStyleLoaded()) return;

        // Ensure SVG images are loaded
        ensureVehicleImages(map);

        // Build GeoJSON
        const features: GeoJSON.Feature[] = [];
        for (const [idStr, state] of Object.entries(trackerStates)) {
            const ts = state as NavixyTrackerState;
            const { lat, lng } = ts.gps?.location || { lat: 0, lng: 0 };
            if (!lat || !lng) continue;
            const status = deriveVehicleStatus(ts);
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: {
                    id: Number(idStr),
                    icon: statusToIconName(status),
                    heading: status === 'Running' ? (ts.gps?.heading ?? 0) : 0,
                    label: trackerLabels[Number(idStr)] || `#${idStr}`,
                },
            });
        }

        const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

        // Add or update source
        const src = map.getSource(VEHICLE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        if (src) {
            src.setData(geojson);
        } else {
            if (!map.getSource(VEHICLE_SOURCE)) {
                map.addSource(VEHICLE_SOURCE, { type: 'geojson', data: geojson });
            }
        }

        // Add layer (once)
        if (!map.getLayer(VEHICLE_LAYER)) {
            map.addLayer({
                id: VEHICLE_LAYER,
                type: 'symbol',
                source: VEHICLE_SOURCE,
                layout: {
                    'icon-image': ['get', 'icon'],
                    'icon-size': 1,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                },
            });
        }
    }, [trackerStates, trackerLabels]);

    // Run layer update whenever tracker data changes (throttled via rAF)
    useEffect(() => {
        const id = requestAnimationFrame(updateVehicleLayer);
        return () => cancelAnimationFrame(id);
    }, [updateVehicleLayer]);

    // Cleanup layer when component unmounts or region changes
    useEffect(() => {
        return () => {
            const map = mapRef.current?.getMap();
            if (!map) return;
            try {
                if (map.getLayer(VEHICLE_LAYER)) map.removeLayer(VEHICLE_LAYER);
                if (map.getSource(VEHICLE_SOURCE)) map.removeSource(VEHICLE_SOURCE);
            } catch { /* map may already be removed */ }
        };
    }, [sessionKey]);

    const loading = trackersLoading || zonesLoading;

    return (
        <div className="flex flex-1 flex-col overflow-hidden h-full">
            {/* Header strip */}
            <div className="flex items-center gap-3 px-6 pt-4 pb-2">
                <button
                    onClick={() => navigate('/vehicle')}
                    className="p-1.5 bg-surface-card border border-border rounded-lg hover:bg-muted text-muted-foreground shrink-0 shadow-sm transition-colors"
                >
                    <ArrowLeft size={16} />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="text-sm font-bold text-foreground">Geofence Management</h1>
                    <p className="text-xs text-muted-foreground">
                        {loading ? 'Loading...' : `${zones.length} zones · ${Object.keys(trackerStates).length} vehicles`}
                    </p>
                </div>

                {/* TZ / ZM Ops Toggle */}
                <div className="flex items-center bg-muted rounded-full p-1 border border-border shadow-sm">
                    <button
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${ops === 'tanzania'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                        onClick={() => setOps('tanzania')}
                    >
                        TZ Ops
                    </button>
                    <button
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${ops === 'zambia'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                        onClick={() => setOps('zambia')}
                    >
                        ZM Ops
                    </button>
                </div>

                {loading && <Loader2 size={16} className="animate-spin text-primary" />}
            </div>

            {/* Main Content Area - matches Home layout */}
            <main className="flex-1 overflow-hidden px-6 pt-2 pb-3 flex gap-4">
                {/* Left Panel: Zone List */}
                <div className="flex w-[380px] min-w-[320px] flex-col h-full rounded-[24px] bg-surface-card shadow-lg border border-border overflow-hidden">
                    <div className="flex-1 overflow-hidden">
                        <GeofencePanel
                            zones={zones}
                            selectedZoneId={selectedZoneId}
                            trackerLabels={trackerLabels}
                            onSelectZone={setSelectedZoneId}
                            onCreateZone={createZone}
                            onDeleteZone={deleteZone}
                            onStartDrawing={handleStartDrawing}
                            onCancelDrawing={handleCancelDrawing}
                            drawnPayload={drawnPayload}
                            monitoredZoneIds={monitoredZoneIds}
                            onMonitorZones={setMonitoredZoneIds}
                            onRefresh={refreshZones}
                        />
                    </div>
                </div>

                {/* Right Panel: Map */}
                <div className="flex-1 h-full rounded-[24px] overflow-hidden shadow-lg border border-border relative bg-surface-card">
                    <Map
                        ref={mapRef}
                        {...viewState}
                        onMove={evt => setViewState(evt.viewState)}
                        style={{ width: '100%', height: '100%' }}
                        mapStyle={resolved === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/satellite-streets-v12'}
                        mapboxAccessToken={mapToken}
                        attributionControl={false}
                    >
                        <NavigationControl position="top-left" showCompass={false} />
                    </Map>

                    {/* Geofence overlay on raw map */}
                    <GeofenceMapOverlay
                        map={mapRef.current?.getMap() ?? null}
                        zones={zones}
                        selectedZoneId={selectedZoneId}
                        onSelectZone={setSelectedZoneId}
                        drawingMode={drawingMode}
                        onDrawComplete={handleDrawComplete}
                        onDrawCancel={handleCancelDrawing}
                    />

                    {/* Drawing mode indicator */}
                    {drawingMode !== 'none' && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-800/90 text-white px-4 py-2 rounded-lg shadow-lg text-xs font-bold z-50 flex items-center gap-2 backdrop-blur-sm">
                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                            Drawing {drawingMode} — click on the map to draw
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
