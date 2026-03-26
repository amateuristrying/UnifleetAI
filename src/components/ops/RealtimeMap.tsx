import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import type { NavixyTrackerState } from '@/services/navixy';
import type { FleetAnalysis, ActionItem } from '@/types/fleet-analysis';
import { getVehicleStatus } from '@/hooks/useTrackerStatusDuration';

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
    drawingMode?: 'none' | 'polygon' | 'circle';
    onDrawComplete?: (payload: CreateZonePayload) => void;
    onDrawCancel?: () => void;
    viewMode?: 'locked' | 'unlocked';
    drawingRadius?: number;
    onRadiusChange?: (radius: number) => void;
    drawnPayload?: CreateZonePayload | null;
}



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



export default function RealtimeMap({
    trackers, trackerLabels = {}, analysis, showDelays = false, focusedAction, focusedTrackerId,
    zones = [], selectedZoneId = null, onSelectZone = () => { }, drawingMode = 'none', onDrawComplete = () => { }, onDrawCancel = () => { },
    viewMode = 'unlocked', drawingRadius, onRadiusChange, drawnPayload
}: RealtimeMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
    const markersRef = useRef<Record<number, mapboxgl.Marker>>({});
    const animationFrameRef = useRef<number | null>(null);
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/satellite-streets-v12');

    // Function to add delay layers - reused for style changes
    const addDelayLayers = (map: mapboxgl.Map) => {
        if (!map.getSource('delays')) {
            map.addSource('delays', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        if (!map.getLayer('delays-glow')) {
            map.addLayer({
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
        }

        if (!map.getLayer('delays-point')) {
            map.addLayer({
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
        }

        if (!map.getLayer('delays-count')) {
            map.addLayer({
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
        }
    };

    useEffect(() => {
        if (!mapContainer.current || !MAPBOX_TOKEN) return;
        if (map.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: mapStyle,
            center: [30.0, -10.0],
            zoom: 4,
            attributionControl: false,
            antialias: true
        });

        map.current.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

        // Add Geocoder
        const geocoder = new MapboxGeocoder({
            accessToken: MAPBOX_TOKEN,
            mapboxgl: mapboxgl as any,
            marker: false, // Do not add a default marker
            placeholder: 'Search for places...',
            collapsed: true, // Collapse by default to save space
        });
        map.current.addControl(geocoder, 'top-right');

        map.current.on('load', () => {
            setMapInstance(map.current);
            if (!map.current) return;
            addDelayLayers(map.current);
        });

        // Restore layers on style change
        map.current.on('styledata', () => {
            if (map.current && map.current.isStyleLoaded()) {
                addDelayLayers(map.current);
            }
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []); // Run once on mount

    // Handle style updates dynamically
    useEffect(() => {
        if (!mapInstance) return;
        // Defer style change to avoid Mapbox `continuePlacement` race condition
        const timer = setTimeout(() => {
            try {
                if (mapInstance && mapInstance.isStyleLoaded()) {
                    mapInstance.setStyle(mapStyle);
                } else if (mapInstance) {
                    mapInstance.once('idle', () => {
                        mapInstance.setStyle(mapStyle);
                    });
                }
            } catch (e) {
                console.warn('Style change deferred:', e);
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [mapStyle, mapInstance]);

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


                const status = getVehicleStatus(state);

                let statusColor = '#64748b';

                switch (status) {
                    case 'moving': statusColor = '#10b981'; break;
                    case 'stopped': statusColor = '#ef4444'; break;
                    case 'parked': statusColor = '#3b82f6'; break;
                    case 'idle-stopped': statusColor = '#f59e0b'; break;
                    case 'idle-parked': statusColor = '#8b5cf6'; break;
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


                } else {
                    const el = document.createElement('div');
                    el.className = 'custom-tracker-marker cursor-pointer';
                    el.style.zIndex = '10';
                    const currentHeading = String(state.gps.heading || 0);
                    el.dataset.status = status;
                    el.dataset.heading = currentHeading;
                    el.innerHTML = getMarkerSVG(status, statusColor, Number(currentHeading));

                    marker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(mapInstance);
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


    }, [focusedTrackerId, trackers, mapInstance]);

    return (
        <div className="relative w-full h-full rounded-[30px] overflow-hidden border border-border shadow-2xl bg-muted group">
            <style>{`
                .mapboxgl-ctrl-group {
                    border-radius: 12px !important;
                    border: 1px solid rgba(0,0,0,0.05) !important;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
                }
                .mapboxgl-ctrl-top-right {
                    top: 10px;
                    right: 10px;
                }
            `}</style>

            {/* Map Style Toggle */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 p-1.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md rounded-full shadow-lg border border-white/20 dark:border-slate-700/50 transition-all duration-300 opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0">
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/light-v11')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${mapStyle.includes('light')
                        ? 'bg-amber-400 text-amber-900 shadow-sm scale-110'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    title="Day Mode"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
                </button>
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/dark-v11')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${mapStyle.includes('dark')
                        ? 'bg-slate-800 text-slate-100 shadow-sm scale-110 border border-slate-600'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    title="Night Mode"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
                </button>
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/satellite-streets-v12')}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${mapStyle.includes('satellite')
                        ? 'bg-emerald-500 text-white shadow-sm scale-110'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    title="Satellite Mode"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
                </button>
            </div>

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
                drawingRadius={drawingRadius}
                onRadiusChange={onRadiusChange}
                drawnPayload={drawnPayload}
            />
        </div>
    );
}

