'use client';

import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { NavixyTrackerState } from '../services/navixy';
import { FleetAnalysis, ActionItem } from '../hooks/useFleetAnalysis';
import { getVehicleStatus } from '../hooks/useTrackerStatusDuration';
import { parseNavixyDate } from '@/lib/utils';
import GeofenceMapOverlay from './GeofenceMapOverlay';
import type { Geofence, CreateZonePayload } from '../types/geofence';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface RealtimeMapProps {
    trackers: Record<number, NavixyTrackerState>;
    trackerLabels?: Record<number, string>;
    analysis?: FleetAnalysis | null;
    showDelays?: boolean; // New Prop to Toggle Delay Layers
    focusedAction?: ActionItem | null; // New Prop for Zooming
    focusedTrackerId?: number | null;

    // Geofence Props
    zones?: Geofence[];
    selectedZoneId?: number | null;
    onSelectZone?: (zoneId: number | null) => void;
    drawingMode?: 'none' | 'polygon' | 'corridor' | 'circle';
    onDrawComplete?: (payload: CreateZonePayload) => void;
    onDrawCancel?: () => void;
}

const getDirection = (heading: number): string => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((heading %= 360) < 0 ? heading + 360 : heading) / 45) % 8;
    return directions[index];
};

// Generate marker SVG based on vehicle status
const getMarkerSVG = (status: string, color: string, heading: number): string => {
    const size = 24; // Slightly bigger, minimal size

    switch (status) {
        case 'moving':
            // Clean directional arrow
            return `
                <div class="tracker-wrapper transition-transform duration-500 will-change-transform flex items-center justify-center hover:scale-110 transition-all origin-center" style="transform: rotate(${heading}deg)">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">
                        <path d="M12 2L4 20L12 16L20 20L12 2Z" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round" class="tracker-path"/>
                    </svg>
                </div>`;

        case 'stopped':
            // Solid red circle
            return `
                <div class="tracker-wrapper flex items-center justify-center hover:scale-110 transition-all">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">
                        <circle cx="12" cy="12" r="8" fill="${color}" stroke="white" stroke-width="2" class="tracker-path"/>
                    </svg>
                </div>`;

        case 'parked':
            // Blue circle with P symbol
            return `
                <div class="tracker-wrapper flex items-center justify-center hover:scale-110 transition-all">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">
                        <circle cx="12" cy="12" r="9" fill="${color}" stroke="white" stroke-width="2" class="tracker-path"/>
                        <text x="12" y="17" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="14" font-weight="bold">P</text>
                    </svg>
                </div>`;

        case 'idle-stopped':
            // Orange circle with inner ring
            return `
                <div class="tracker-wrapper flex items-center justify-center hover:scale-110 transition-all">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">
                        <circle cx="12" cy="12" r="9" fill="${color}" stroke="white" stroke-width="2" class="tracker-path"/>
                        <circle cx="12" cy="12" r="5" fill="none" stroke="white" stroke-width="1.5" opacity="0.7">
                            <animate attributeName="opacity" values="0.7;0.3;0.7" dur="2s" repeatCount="indefinite"/>
                        </circle>
                    </svg>
                </div>`;

        case 'idle-parked':
            // Purple circle with P and outline
            return `
                <div class="tracker-wrapper flex items-center justify-center hover:scale-110 transition-all">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">
                        <circle cx="12" cy="12" r="9" fill="${color}" stroke="white" stroke-width="2" class="tracker-path">
                            <animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite"/>
                        </circle>
                        <text x="12" y="17" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="14" font-weight="bold">P</text>
                    </svg>
                </div>`;

        case 'offline':
        default:
            // Gray hollow circle with X
            return `
                <div class="tracker-wrapper flex items-center justify-center hover:scale-110 transition-all">
                    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15));">
                        <circle cx="12" cy="12" r="8" fill="white" stroke="${color}" stroke-width="2" class="tracker-path"/>
                        <line x1="8" y1="8" x2="16" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
                        <line x1="16" y1="8" x2="8" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>`;
    }
};

const formatTimeAgo = (dateString: string): string => {
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
    zones = [], selectedZoneId = null, onSelectZone = () => { }, drawingMode = 'none', onDrawComplete = () => { }, onDrawCancel = () => { }
}: RealtimeMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [mapInstance, setMapInstance] = React.useState<mapboxgl.Map | null>(null);
    const markersRef = useRef<Record<number, mapboxgl.Marker>>({});
    const animationFrameRef = useRef<number | null>(null);

    // Initialize Map
    useEffect(() => {
        if (!mapContainer.current || !MAPBOX_TOKEN) return;
        if (map.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [30.0, -10.0],
            zoom: 4,
            attributionControl: false
        });

        map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

        // Add Delay Layers on Load (Hidden by default unless showDelays is true)
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
                    'circle-opacity': 0.2,
                    'circle-blur': 0.5
                },
                layout: {
                    'visibility': 'none' // Default hidden
                }
            });

            map.current.addLayer({
                id: 'delays-point',
                type: 'circle',
                source: 'delays',
                paint: {
                    'circle-radius': 15,
                    'circle-color': ['get', 'color'],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff',
                    'circle-opacity': 0.8
                },
                layout: {
                    'visibility': 'none'
                }
            });

            map.current.addLayer({
                id: 'delays-count',
                type: 'symbol',
                source: 'delays',
                layout: {
                    'text-field': '{count}',
                    'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                    'text-size': 12,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#ffffff'
                }
            });
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    // 2. Handle Focus Zooming (When user clicks a list item)
    useEffect(() => {
        if (!map.current || !focusedAction) return;

        map.current.flyTo({
            center: [focusedAction.lng, focusedAction.lat],
            zoom: 12, // Zoom in close to see individual trucks
            speed: 1.2
        });

        // Optional: Open a popup immediately?
        // We could trigger a popup here programmatically if desired.

    }, [focusedAction]);

    // 3. Update & Toggle Delays Layer
    useEffect(() => {
        if (!map.current || !analysis) return;

        // Wait for style load
        if (!map.current.isStyleLoaded()) return;

        // Toggle Visibility based on prop
        const visibility = showDelays ? 'visible' : 'none';
        if (map.current.getLayer('delays-glow')) map.current.setLayoutProperty('delays-glow', 'visibility', visibility);
        if (map.current.getLayer('delays-point')) map.current.setLayoutProperty('delays-point', 'visibility', visibility);
        if (map.current.getLayer('delays-count')) map.current.setLayoutProperty('delays-count', 'visibility', visibility);

        if (!showDelays) return; // Don't update data if hidden

        const source = map.current.getSource('delays') as mapboxgl.GeoJSONSource;
        if (!source) return;

        const features = analysis.actions.map(action => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [action.lng, action.lat]
            },
            properties: {
                id: action.id,
                title: action.title,
                count: action.count,
                location: action.location,
                action: action.action,
                color: action.severity === 'high' ? '#ef4444' : '#f59e0b'
            }
        }));

        source.setData({
            type: 'FeatureCollection',
            features: features as any
        });

    }, [analysis, showDelays]); // React to prop change

    // 4. Update Vehicle Markers (Same as before)
    useEffect(() => {
        if (!map.current) return;

        const updateMarkers = () => {
            if (!map.current) return;
            const currentIds = new Set<number>();
            Object.entries(trackers).forEach(([idStr, state]) => {
                const id = Number(idStr);
                currentIds.add(id);
                const { lat, lng } = state.gps.location;
                const speed = state.gps.speed;
                const label = trackerLabels[id] || `Vehicle #${id}`;
                const status = getVehicleStatus(state);

                let statusColor = '#94a3b8';
                let statusText = 'Offline';
                let statusBgClass = 'bg-slate-100 text-slate-600';

                switch (status) {
                    case 'moving':
                        statusColor = '#22c55e';
                        statusText = 'Moving';
                        statusBgClass = 'bg-green-100 text-green-700 border-green-200';
                        break;
                    case 'stopped':
                        statusColor = '#ef4444';
                        statusText = 'Stopped';
                        statusBgClass = 'bg-red-100 text-red-700 border-red-200';
                        break;
                    case 'parked':
                        statusColor = '#3b82f6';
                        statusText = 'Parked';
                        statusBgClass = 'bg-blue-100 text-blue-700 border-blue-200';
                        break;
                    case 'idle-stopped':
                        statusColor = '#f97316';
                        statusText = 'Idle-Stopped';
                        statusBgClass = 'bg-orange-100 text-orange-700 border-orange-200';
                        break;
                    case 'idle-parked':
                        statusColor = '#a855f7';
                        statusText = 'Idle-Parked';
                        statusBgClass = 'bg-purple-100 text-purple-700 border-purple-200';
                        break;
                    case 'offline':
                    default:
                        statusColor = '#94a3b8';
                        statusText = 'Offline';
                        statusBgClass = 'bg-slate-100 text-slate-600';
                        break;
                }

                let marker = markersRef.current[id];
                if (marker) {
                    marker.setLngLat([lng, lat]);
                    const el = marker.getElement();

                    // Check if status or heading changed - if so, regenerate marker
                    const currentStatus = el.dataset.status;
                    const currentHeading = el.dataset.heading;

                    if (currentStatus !== status || (status === 'moving' && currentHeading !== String(state.gps.heading))) {
                        el.innerHTML = getMarkerSVG(status, statusColor, state.gps.heading);
                        el.dataset.status = status;
                        el.dataset.heading = String(state.gps.heading);
                    }

                    const popup = marker.getPopup();
                    if (popup && popup.isOpen()) {
                        const contentEl = document.getElementById(`popup-content-${id}`);
                        if (contentEl) {
                            const newHTML = getPopupHTML(id, label, speed, state.gps.heading, state.last_update, statusText, statusBgClass, status);
                            if (contentEl.outerHTML !== newHTML) popup.setHTML(newHTML);
                        }
                    }
                } else {
                    const el = document.createElement('div');
                    el.className = 'custom-marker';
                    el.style.cursor = 'pointer';
                    el.dataset.status = status;
                    el.dataset.heading = String(state.gps.heading);
                    el.innerHTML = getMarkerSVG(status, statusColor, state.gps.heading);

                    const popupHTML = getPopupHTML(id, label, speed, state.gps.heading, state.last_update, statusText, statusBgClass, status);
                    const popup = new mapboxgl.Popup({ offset: 15, closeButton: true, closeOnClick: false, maxWidth: '300px', className: 'custom-mapbox-popup' }).setHTML(popupHTML);
                    marker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).setPopup(popup).addTo(map.current!);
                    markersRef.current[id] = marker;
                }
            });
            Object.keys(markersRef.current).forEach(idStr => {
                const id = Number(idStr);
                if (!currentIds.has(id)) {
                    markersRef.current[id].remove();
                    delete markersRef.current[id];
                }
            });
        };
        animationFrameRef.current = requestAnimationFrame(updateMarkers);
        return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
    }, [trackers, trackerLabels]);

    // Focus on specific tracker when focusedTrackerId changes
    useEffect(() => {
        if (!map.current || focusedTrackerId === null || focusedTrackerId === undefined) return;

        const tracker = trackers[focusedTrackerId];
        if (!tracker) return;

        const { lat, lng } = tracker.gps.location;

        console.log(`Zooming to tracker ${focusedTrackerId} at [${lng}, ${lat}]`);

        map.current.flyTo({
            center: [lng, lat],
            zoom: 15,
            speed: 1.2,
            curve: 1.42,
            essential: true
        });

        // Small delay to ensure marker is updated and then open popup
        setTimeout(() => {
            const marker = markersRef.current[focusedTrackerId];
            if (marker) {
                const popup = marker.getPopup();
                if (popup) {
                    if (!popup.isOpen()) {
                        marker.togglePopup();
                    }
                }
            }
        }, 500);
    }, [focusedTrackerId, trackers]);

    return (
        <div className="relative w-full h-[600px] rounded-xl overflow-hidden border border-gray-200 shadow-sm">
            <style jsx global>{`
                .mapboxgl-popup-content {
                    padding: 0 !important;
                    border-radius: 12px !important;
                    overflow: hidden;
                    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.1) !important;
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
            />
        </div>
    );
}

function getPopupHTML(id: number, label: string, speed: number, heading: number, lastUpdate: string, statusText: string, statusBgClass: string, status: string) {
    const direction = getDirection(heading);
    const timeAgo = formatTimeAgo(lastUpdate);
    const speedDisplay = Math.round(speed);

    // Contextual label for speed
    const speedLabel = status === 'offline' ? 'Last Speed' : 'Speed';

    return `
        <div id="popup-content-${id}" class="w-64 bg-white font-sans text-slate-800">
            <div class="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center pr-8">
                <h3 class="font-bold text-slate-900 truncate text-sm" title="${label}">${label} <span class="text-slate-400 font-normal text-xs">(#${id})</span></h3>
                <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${statusBgClass}">
                    ${statusText}
                </span>
            </div>
            <div class="p-4 space-y-3">
                 <div class="flex justify-between items-center">
                   <div class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">${speedLabel}</div>
                   <div class="font-mono text-sm font-bold text-slate-700">${speedDisplay} <span class="text-xs font-sans font-normal text-slate-400">km/h</span></div>
                 </div>
                 <div class="flex justify-between items-center">
                   <div class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Direction</div>
                   <div class="flex items-center gap-1.5">
                     <span class="text-xs font-medium text-slate-700">${direction} <span class="text-slate-300">(${Math.round(heading)}°)</span></span>
                   </div>
                 </div>
                   <div class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Last Active</div>
                   <div class="text-xs font-medium text-slate-500">${timeAgo}</div>
                 </div>
            </div>
        </div>
    `;
}
