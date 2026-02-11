import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { NavixyTrackerState } from '@/services/navixy';
import type { FleetAnalysis, ActionItem } from '@/hooks/useFleetAnalysis';
import { getVehicleStatus } from '@/hooks/useTrackerStatusDuration';
import { parseNavixyDate } from '@/lib/utils';
import GeofenceMapOverlay from '../geofence/GeofenceMapOverlay';
import type { Geofence, CreateZonePayload } from '@/types/geofence';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface RealtimeMapProps {
    trackers: Record<number, NavixyTrackerState>;
    trackerLabels?: Record<number, string>;
    analysis?: FleetAnalysis | null;
    showDelays?: boolean;
    focusedAction?: ActionItem | null;
    focusedTrackerId?: number | null;
    zones?: Geofence[];
    selectedZoneId?: number | null;
    onSelectZone?: (zoneId: number | null) => void;
    drawingMode?: 'none' | 'polygon' | 'corridor' | 'circle';
    onDrawComplete?: (payload: CreateZonePayload) => void;
    onDrawCancel?: () => void;
    viewMode?: 'locked' | 'unlocked';
}

const getDirection = (heading: number): string => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((heading %= 360) < 0 ? heading + 360 : heading) / 45) % 8;
    return directions[index];
};

const getMarkerSVG = (status: string, color: string, heading: number): string => {
    const size = 32;

    switch (status) {
        case 'moving':
            return `
                <div class="tracker-marker transition-all duration-300 ease-out" style="transform: rotate(${heading}deg); transform-origin: center; display: flex; align-items: center; justify-content: center;">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.2))">
                        <path d="M12 2L4 20L12 16L20 20L12 2Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
                    </svg>
                </div>`;
        case 'stopped':
            return `
                <div class="tracker-marker hover:scale-125 transition-transform duration-300" style="display: flex; align-items: center; justify-content: center;">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.2))">
                        <circle cx="12" cy="12" r="8" fill="${color}" stroke="white" stroke-width="2"/>
                    </svg>
                </div>`;
        case 'parked':
            return `
                <div class="tracker-marker hover:scale-125 transition-transform duration-300" style="display: flex; align-items: center; justify-content: center;">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.2))">
                        <circle cx="12" cy="12" r="9" fill="${color}" stroke="white" stroke-width="2"/>
                        <text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" fill="white" font-family="Inter, system-ui, sans-serif" font-size="10" font-weight="900">P</text>
                    </svg>
                </div>`;
        case 'idle-stopped':
        case 'idle-parked':
            return `
                <div class="tracker-marker hover:scale-125 transition-transform duration-300" style="display: flex; align-items: center; justify-content: center;">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 0 4px rgba(0,0,0,0.2))">
                        <circle cx="12" cy="12" r="9" fill="${color}" stroke="white" stroke-width="2"/>
                        <circle cx="12" cy="12" r="5" stroke="white" stroke-width="1.5" stroke-dasharray="2 2">
                            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="3s" repeatCount="indefinite"/>
                        </circle>
                    </svg>
                </div>`;
        default:
            return `
                <div class="tracker-marker opacity-60" style="display: flex; align-items: center; justify-content: center;">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="8" fill="white" stroke="${color}" stroke-width="2"/>
                        <path d="M9 9L15 15M15 9L9 15" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>`;
    }
};

const formatTimeAgoLocal = (dateString: string): string => {
    if (!dateString) return 'Unknown';
    const date = parseNavixyDate(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

export default function RealtimeMap({
    trackers, trackerLabels = {}, analysis, showDelays = false, focusedAction, focusedTrackerId,
    zones = [], selectedZoneId = null, onSelectZone = () => { }, drawingMode = 'none', onDrawComplete = () => { }, onDrawCancel = () => { },
    viewMode = 'unlocked'
}: RealtimeMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
    const markersRef = useRef<Record<number, mapboxgl.Marker>>({});
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        if (!mapContainer.current || !MAPBOX_TOKEN) return;
        if (map.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            center: [30.0, -10.0],
            zoom: 4,
            attributionControl: false,
            antialias: true
        });

        map.current.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

        map.current.on('load', () => {
            setMapInstance(map.current);
            if (!map.current) return;

            map.current.addSource('delays', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });

            map.current.addLayer({
                id: 'delays-glow',
                type: 'circle',
                source: 'delays',
                paint: {
                    'circle-radius': 40,
                    'circle-color': ['get', 'color'],
                    'circle-opacity': 0.15,
                    'circle-blur': 0.8
                },
                layout: { 'visibility': 'none' }
            });

            map.current.addLayer({
                id: 'delays-point',
                type: 'circle',
                source: 'delays',
                paint: {
                    'circle-radius': 16,
                    'circle-color': ['get', 'color'],
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#fff',
                    'circle-opacity': 0.9,
                    'circle-translate': [0, -2]
                },
                layout: { 'visibility': 'none' }
            });

            map.current.addLayer({
                id: 'delays-count',
                type: 'symbol',
                source: 'delays',
                layout: {
                    'text-field': ['get', 'count'],
                    'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                    'text-size': 14,
                    'visibility': 'none'
                },
                paint: { 'text-color': '#ffffff' }
            });
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    useEffect(() => {
        if (!map.current || !focusedAction) return;
        map.current.flyTo({
            center: [focusedAction.lng, focusedAction.lat],
            zoom: 14,
            speed: 1.5,
            curve: 1.2,
            essential: true
        });
    }, [focusedAction]);

    useEffect(() => {
        if (!mapInstance || !analysis) return;
        const visibility = showDelays ? 'visible' : 'none';

        ['delays-glow', 'delays-point', 'delays-count'].forEach(layerId => {
            if (mapInstance.getLayer(layerId)) {
                mapInstance.setLayoutProperty(layerId, 'visibility', visibility);
            }
        });

        if (!showDelays) return;

        const source = mapInstance.getSource('delays') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: analysis.actions.map(action => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [action.lng, action.lat] },
                    properties: {
                        id: action.id,
                        title: action.title,
                        count: action.count,
                        color: action.severity === 'high' ? '#ef4444' : '#f59e0b'
                    }
                })) as any
            });
        }
    }, [analysis, showDelays, mapInstance]);

    useEffect(() => {
        if (!mapInstance) return;

        const updateMarkers = () => {
            if (!mapInstance) return;
            const currentIds = new Set<number>();

            Object.entries(trackers).forEach(([idStr, state]) => {
                if (!state || !state.gps || !state.gps.location) return;

                const id = Number(idStr);
                currentIds.add(id);
                const { lat, lng } = state.gps.location;
                if (!lat || !lng) return;

                const label = trackerLabels[id] || `Asset #${id}`;
                const status = getVehicleStatus(state);

                let statusColor = '#64748b';
                let statusText = 'Offline';
                let statusClass = 'bg-slate-100 text-slate-600 border-slate-200';

                switch (status) {
                    case 'moving': statusColor = '#10b981'; statusText = 'Moving'; statusClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'; break;
                    case 'stopped': statusColor = '#ef4444'; statusText = 'Stopped'; statusClass = 'bg-red-500/10 text-red-600 border-red-500/20'; break;
                    case 'parked': statusColor = '#3b82f6'; statusText = 'Parked'; statusClass = 'bg-blue-500/10 text-blue-600 border-blue-500/20'; break;
                    case 'idle-stopped': statusColor = '#f59e0b'; statusText = 'IDLE-STOP'; statusClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20'; break;
                    case 'idle-parked': statusColor = '#8b5cf6'; statusText = 'IDLE-PARK'; statusClass = 'bg-violet-500/10 text-violet-600 border-violet-500/20'; break;
                }

                let marker = markersRef.current[id];
                if (marker) {
                    marker.setLngLat([lng, lat]);
                    const el = marker.getElement();

                    // Force update if status or heading changed
                    const currentHeading = String(state.gps.heading || 0);
                    if (el.dataset.status !== status || (status === 'moving' && el.dataset.heading !== currentHeading)) {
                        el.innerHTML = getMarkerSVG(status, statusColor, Number(currentHeading));
                        el.dataset.status = status;
                        el.dataset.heading = currentHeading;
                    }

                    const popup = marker.getPopup();
                    if (popup && popup.isOpen()) {
                        popup.setHTML(getPopupHTML(id, label, state.gps.speed, state.gps.heading, state.last_update, statusText, statusClass));
                    }
                } else {
                    const el = document.createElement('div');
                    el.className = 'custom-tracker-marker cursor-pointer';
                    el.style.zIndex = '10';
                    const currentHeading = String(state.gps.heading || 0);
                    el.dataset.status = status;
                    el.dataset.heading = currentHeading;
                    el.innerHTML = getMarkerSVG(status, statusColor, Number(currentHeading));

                    const popup = new mapboxgl.Popup({
                        offset: 15,
                        closeButton: true,
                        maxWidth: '280px',
                        className: 'premium-map-popup'
                    }).setHTML(getPopupHTML(id, label, state.gps.speed, state.gps.heading, state.last_update, statusText, statusClass));

                    marker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).setPopup(popup).addTo(mapInstance);
                    markersRef.current[id] = marker;
                }
            });

            Object.keys(markersRef.current).forEach(idStr => {
                const id = Number(idStr);
                if (!currentIds.has(id)) { markersRef.current[id].remove(); delete markersRef.current[id]; }
            });
        };

        animationFrameRef.current = requestAnimationFrame(updateMarkers);
        return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
    }, [trackers, trackerLabels, mapInstance]);

    useEffect(() => {
        if (!mapInstance || !focusedTrackerId || !trackers[focusedTrackerId]) return;
        const { lat, lng } = trackers[focusedTrackerId].gps.location;
        mapInstance.flyTo({ center: [lng, lat], zoom: 16, speed: 1.2, essential: true });

        setTimeout(() => {
            const m = markersRef.current?.[focusedTrackerId];
            const popup = m?.getPopup();
            if (m && popup && !popup.isOpen()) m.togglePopup();
        }, 600);
    }, [focusedTrackerId, trackers, mapInstance]);

    return (
        <div className="relative w-full h-full rounded-[32px] overflow-hidden border border-border shadow-2xl bg-muted">
            <style>{`
                .premium-map-popup .mapboxgl-popup-content {
                    padding: 0 !important;
                    border-radius: 20px !important;
                    overflow: hidden;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
                    border: 1px solid rgba(255,255,255,0.1) !important;
                }
                .premium-map-popup .mapboxgl-popup-close-button {
                    padding: 12px !important;
                    font-size: 14px !important;
                    color: #fff !important;
                    background: rgba(0,0,0,0.1) !important;
                    border-radius: 0 0 0 12px !important;
                }
                .premium-map-popup .mapboxgl-popup-close-button:hover {
                    background: rgba(239, 68, 68, 0.8) !important;
                }
                .mapboxgl-ctrl-group {
                    border-radius: 12px !important;
                    border: 1px solid rgba(0,0,0,0.05) !important;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
                }
            `}</style>
            <div ref={mapContainer} className="w-full h-full" />

            <GeofenceMapOverlay
                map={mapInstance}
                zones={zones}
                selectedZoneId={selectedZoneId}
                onSelectZone={onSelectZone}
                drawingMode={drawingMode}
                onDrawComplete={onDrawComplete}
                onDrawCancel={onDrawCancel}
                viewMode={viewMode}
            />
        </div>
    );
}

function getPopupHTML(_id: number, label: string, speed: number, heading: number, lastUpdate: string, statusText: string, statusClass: string) {
    const timeAgo = formatTimeAgoLocal(lastUpdate);
    return `
        <div class="w-full font-sans bg-white overflow-hidden">
            <div class="bg-slate-900 px-4 py-3 pb-4">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Live Asset Track</p>
                <div class="flex items-start justify-between">
                    <h3 class="font-black text-white text-base leading-tight uppercase truncate mr-4">${label}</h3>
                    <div class="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter border ${statusClass.includes('emerald') ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}">
                        ${statusText}
                    </div>
                </div>
            </div>
            <div class="p-4 space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-0.5">
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Velocity</p>
                        <p class="text-xl font-black text-slate-900">${Math.round(speed)} <span class="text-[10px] text-slate-400 uppercase">KM/H</span></p>
                    </div>
                    <div class="space-y-0.5">
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Heading</p>
                        <p class="text-xl font-black text-slate-900">${getDirection(heading)} <span class="text-[10px] text-slate-400 uppercase font-mono tracking-tighter">${Math.round(heading)}°</span></p>
                    </div>
                </div>
                <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <div class="w-1 h-1 rounded-full bg-slate-300"></div>
                        <p class="text-[10px] font-bold text-slate-500 uppercase tracking-tight truncate">Updated ${timeAgo}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}
