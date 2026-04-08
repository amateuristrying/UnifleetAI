'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import { NavixyService } from '@/services/navixy';
import { analyzeRouteDeviation } from '@/lib/route-analysis'; // Shared Logic
import type { RouteAnalysisResult, StopEvent } from '@/types/security';

// Ensure you have this token in your .env.local as NEXT_PUBLIC_MAPBOX_TOKEN
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface RouteAnomaliesMapProps {
    startGeom: any;
    endGeom: any;
    efficiencyRatio?: number; // Crow Flight Ratio
    trackerId?: number;
    startTime?: string;
    endTime?: string;
    sessionKey?: string;
    onAnalysisComplete?: (results: RouteAnalysisResult) => void;
}

export default function RouteAnomaliesMap({
    startGeom,
    endGeom,
    trackerId,
    startTime,
    endTime,
    sessionKey,
    onAnalysisComplete
}: RouteAnomaliesMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);

    // State
    const [optimalRouteGeoJSON, setOptimalRouteGeoJSON] = useState<any>(null);
    const [actualRouteGeoJSON, setActualRouteGeoJSON] = useState<any>(null); // Visual Blue Line
    const [speedLimitSegments, setSpeedLimitSegments] = useState<any>(null); // For colored line segments
    const [speedLimitPoints, setSpeedLimitPoints] = useState<any>(null); // For Sign posts
    const [deviationSegments, setDeviationSegments] = useState<any>(null);
    const [unauthorizedStops, setUnauthorizedStops] = useState<StopEvent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const stopMarkers = useRef<mapboxgl.Marker[]>([]);

    // Helper to extract [lon, lat] from GeoJSON Point
    const startPos = React.useMemo((): [number, number] | null => {
        if (!startGeom || !startGeom?.coordinates) return null;
        return [startGeom.coordinates[0], startGeom.coordinates[1]];
    }, [startGeom]);

    const endPos = React.useMemo((): [number, number] | null => {
        if (!endGeom || !endGeom?.coordinates) return null;
        return [endGeom.coordinates[0], endGeom.coordinates[1]];
    }, [endGeom]);

    // 1. Initialize Map
    useEffect(() => {
        if (!mapContainer.current || !startPos || !MAPBOX_TOKEN) return;
        if (map.current) return; // initialize map only once

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v12', // Standard streets style
            center: startPos,
            zoom: 10,
            attributionControl: false
        });

        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
        map.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        // Add markers when map loads
        map.current.on('load', () => {
            if (!map.current) return;

            // Start Marker
            const startEl = document.createElement('div');
            startEl.className = 'w-4 h-4 bg-slate-800 rounded-full border-2 border-white shadow-sm';
            new mapboxgl.Marker(startEl)
                .setLngLat(startPos)
                .setPopup(new mapboxgl.Popup({ offset: 25 }).setText('Origin'))
                .addTo(map.current);

            // End Marker
            if (endPos) {
                const endEl = document.createElement('div');
                endEl.className = 'w-4 h-4 bg-slate-800 rounded-full border-2 border-white shadow-sm';
                new mapboxgl.Marker(endEl)
                    .setLngLat(endPos)
                    .setPopup(new mapboxgl.Popup({ offset: 25 }).setText('Destination'))
                    .addTo(map.current);
            }
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []); // Run once on mount

    // 2. Fetch & Analyze Data (Unified Logic)
    useEffect(() => {
        if (!startPos || !endPos || !MAPBOX_TOKEN || !trackerId || !startTime || !endTime || !sessionKey) return;

        const performAnalysis = async () => {
            setIsLoading(true);
            try {
                // A. Fetch Navixy Track
                const rawPoints = await NavixyService.getTrack(trackerId, startTime, endTime, sessionKey);

                if (!rawPoints || rawPoints.length < 2) {
                    console.warn('[RouteMap] Insufficient track points');
                    setIsLoading(false);
                    return;
                }

                // Map to Analysis Params
                const trackPoints = rawPoints.map((p: any) => ({
                    lat: p.lat,
                    lng: p.lng,
                    time: p.time,
                    sat: p.satellites ?? p.sat,
                    alt: p.altitude ?? p.alt,
                    speed: p.speed
                }));

                // B. Run Shared Analysis (Adaptive Tolerance + Map Matching)
                const result = await analyzeRouteDeviation({
                    startCoords: startPos,
                    endCoords: endPos,
                    trackPoints,
                    mapboxToken: MAPBOX_TOKEN,
                    enableMapMatching: true, // Use PRO features
                    profile: 'mapbox/driving',
                });

                // C. Update State
                setSpeedLimitSegments(result.speedLimitSegments);
                setSpeedLimitPoints(result.speedLimitPoints);
                setActualRouteGeoJSON(result.speedLimitSegments); // Speed segments cover the whole path

                // Note: We need to fetch Optimal Route GeoJSON separately for display because 
                // analyzeRouteDeviation uses it internally but only returns stats/lengths.
                // We'll quickly fetch it here for the gray dashed line.
                const optimalRes = await fetch(
                    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${startPos[0]},${startPos[1]};${endPos[0]},${endPos[1]}?steps=true&geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
                );
                const optimalJson = await optimalRes.json();
                if (optimalJson.routes?.[0]) {
                    setOptimalRouteGeoJSON({
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'LineString', coordinates: optimalJson.routes[0].geometry.coordinates }
                    });
                }

                setDeviationSegments(result.deviationSegments);
                setUnauthorizedStops(result.stopEvents);

                if (onAnalysisComplete) {
                    onAnalysisComplete(result);
                }

            } catch (err) {
                console.error('[RouteMap] Analysis failed:', err);
            } finally {
                setIsLoading(false);
            }
        };

        performAnalysis();
    }, [trackerId, startTime, endTime, sessionKey, startPos, endPos, onAnalysisComplete]);


    // Helper for Severity Badge
    const getSeverityDetails = () => {
        if (!deviationSegments) return null;
        let devKm = 0;
        deviationSegments.features.forEach((f: any) => devKm += turf.length(f, { units: 'kilometers' }));

        const totalKm = actualRouteGeoJSON ?
            (actualRouteGeoJSON.type === 'FeatureCollection'
                ? actualRouteGeoJSON.features.reduce((acc: number, f: any) => acc + turf.length(f, { units: 'kilometers' }), 0)
                : turf.length(actualRouteGeoJSON, { units: 'kilometers' }))
            : 1;

        const ratio = totalKm > 0 ? (devKm / totalKm) * 100 : 0;

        if (ratio > 15) return { label: 'CRITICAL', color: 'bg-red-600', text: 'text-red-600', desc: 'Unauthorized Route' };
        if (ratio > 5) return { label: 'WARNING', color: 'bg-yellow-500', text: 'text-yellow-600', desc: 'Inefficient' };
        return { label: 'MINOR', color: 'bg-blue-500', text: 'text-blue-600', desc: 'Acceptable Variance' };
    };

    const severity = getSeverityDetails();

    // 4. Draw Layers
    useEffect(() => {
        const mapInstance = map.current;
        if (!mapInstance) return;

        const addLayers = () => {
            if (!mapInstance) return;

            // A. Optimal Path (Gray Dashed)
            if (optimalRouteGeoJSON) {
                if (mapInstance.getSource('optimal')) {
                    (mapInstance.getSource('optimal') as mapboxgl.GeoJSONSource).setData(optimalRouteGeoJSON);
                } else {
                    mapInstance.addSource('optimal', { type: 'geojson', data: optimalRouteGeoJSON });
                    mapInstance.addLayer({
                        id: 'optimal',
                        type: 'line',
                        source: 'optimal',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: {
                            'line-color': '#94a3b8',
                            'line-width': 4,
                            'line-dasharray': [2, 2],
                            'line-opacity': 0.8
                        }
                    });
                }
            }

            // B. Actual Path (Speed Segments)
            if (speedLimitSegments) {
                if (mapInstance.getSource('actual')) {
                    (mapInstance.getSource('actual') as mapboxgl.GeoJSONSource).setData(speedLimitSegments);
                } else {
                    mapInstance.addSource('actual', { type: 'geojson', data: speedLimitSegments });

                    // Base Blue Line
                    mapInstance.addLayer({
                        id: 'actual',
                        type: 'line',
                        source: 'actual',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: {
                            'line-color': '#3b82f6',
                            'line-width': 4,
                            'line-opacity': 0.8
                        }
                    });

                    // mapInstance.addLayer({ /* Removed old line text layer */ }); 
                }
            }

            // D. Speed Limit SIGNS (Points) - Visual "Sign" style
            if (speedLimitPoints) {
                const sourceId = 'speed-limit-points';
                if (mapInstance.getSource(sourceId)) {
                    (mapInstance.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(speedLimitPoints);
                } else {
                    mapInstance.addSource(sourceId, { type: 'geojson', data: speedLimitPoints });

                    // 1. White Background Circle
                    mapInstance.addLayer({
                        id: 'speed-sign-bg',
                        type: 'circle',
                        source: sourceId,
                        minzoom: 10,
                        paint: {
                            'circle-radius': 12,
                            'circle-color': '#ffffff',
                            'circle-stroke-width': 2,
                            // Red stroke for legal, Gray Dashed (simulated by non-red) for Typical
                            'circle-stroke-color': [
                                'case',
                                ['get', 'isTypical'],
                                '#64748b', // Gray for typical
                                '#ef4444'  // Red for legal
                            ]
                        },
                        filter: ['>', ['get', 'displaySpeed'], 0]
                    });

                    // 2. The Number
                    mapInstance.addLayer({
                        id: 'speed-sign-text',
                        type: 'symbol',
                        source: sourceId,
                        minzoom: 10,
                        layout: {
                            'text-field': ['to-string', ['get', 'displaySpeed']],
                            'text-size': 11,
                            'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                            'text-allow-overlap': true
                        },
                        paint: {
                            'text-color': '#1f2937' // Gray 800
                        },
                        filter: ['>', ['get', 'displaySpeed'], 0]
                    });

                    // 3. "LIMIT" or "~" Label (tiny above/below?)
                    // Optional: Keep it simple first. "50" in a red circle is universal.
                    // For typical, maybe add a tiny "~" prefix in the text field?
                }
            }

            // C. Deviations (Red)
            if (deviationSegments) {
                if (mapInstance.getSource('deviations')) {
                    (mapInstance.getSource('deviations') as mapboxgl.GeoJSONSource).setData(deviationSegments);
                } else {
                    mapInstance.addSource('deviations', { type: 'geojson', data: deviationSegments });
                    mapInstance.addLayer({
                        id: 'deviations',
                        type: 'line',
                        source: 'deviations',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: {
                            'line-color': '#ef4444',
                            'line-width': 6,
                            'line-opacity': 0.9
                        }
                    });

                    mapInstance.addLayer({
                        id: 'deviations-label',
                        type: 'symbol',
                        source: 'deviations',
                        layout: {
                            'symbol-placement': 'line',
                            'text-field': 'Review Route',
                            'text-size': 10,
                            'text-offset': [0, 1]
                        },
                        paint: {
                            'text-color': '#ef4444',
                            'text-halo-color': '#fff',
                            'text-halo-width': 2
                        }
                    });
                }
            }

            // Fit Bounds
            const bounds = new mapboxgl.LngLatBounds();
            let hasBounds = false;

            if (optimalRouteGeoJSON) {
                const coords = optimalRouteGeoJSON.geometry.coordinates;
                coords.forEach((c: any) => bounds.extend(c));
                hasBounds = true;
            }
            if (speedLimitSegments) {
                // Features -> Geometry -> Coords
                speedLimitSegments.features.forEach((f: any) => {
                    f.geometry.coordinates.forEach((c: any) => bounds.extend(c));
                });
                hasBounds = true;
            }

            if (hasBounds) {
                mapInstance.fitBounds(bounds, { padding: 50 });
            }
        };

        // --- Clear Old Markers ---
        stopMarkers.current.forEach(m => m.remove());
        stopMarkers.current = [];

        // --- B. Stop Markers ---
        if (unauthorizedStops.length > 0) {
            unauthorizedStops.forEach((stop) => {
                const isAuth = stop.isAuthorized;
                const colorClass = isAuth ? 'bg-green-500' : 'bg-red-600';
                const icon = isAuth ? '✓' : '!';
                const title = isAuth ? 'Authorized Stop' : 'High Risk Stop Detected';
                const titleColor = isAuth ? 'text-green-600' : 'text-red-600';
                const desc = isAuth
                    ? `Zone: ${stop.zoneLabel || 'Safe Zone'}`
                    : 'Suspected fuel theft / unauthorized access area.';

                const el = document.createElement('div');
                el.className = `w-6 h-6 ${colorClass} rounded-full border-2 border-white shadow-lg flex items-center justify-center cursor-pointer ${!isAuth ? 'animate-pulse' : ''}`;
                el.innerHTML = `<span class="text-white font-bold text-[10px]">${icon}</span>`;

                const marker = new mapboxgl.Marker(el)
                    .setLngLat([stop.lng, stop.lat])
                    .setPopup(new mapboxgl.Popup({ offset: 25 })
                        .setHTML(`
                            <div class="p-2">
                                <p class="text-[10px] font-bold ${titleColor} uppercase mb-1">${title}</p>
                                <p class="text-xs font-medium text-slate-800">Duration: <b>${stop.duration_mins} mins</b></p>
                                <p class="text-[9px] text-slate-400 mt-1 italic">${desc}</p>
                            </div>
                        `)
                    )
                    .addTo(mapInstance);

                stopMarkers.current.push(marker);
            });
        }

        if (mapInstance.isStyleLoaded()) {
            addLayers();
        } else {
            mapInstance.once('style.load', addLayers);
        }

    }, [optimalRouteGeoJSON, speedLimitSegments, speedLimitPoints, deviationSegments, unauthorizedStops]);

    if (!MAPBOX_TOKEN) return <div>Missing Mapbox Token</div>;
    if (!startPos || !endPos) return <div>Invalid GPS Data</div>;

    return (
        <div className="h-[400px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm relative">
            <div ref={mapContainer} className="w-full h-full" />

            {/* Loading Indicator */}
            {isLoading && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            )}

            {/* Legend Overlay */}
            <div className="absolute top-2 left-2 bg-white/95 backdrop-blur px-3 py-2 rounded-lg border border-gray-200 shadow-sm text-xs font-medium text-slate-600 flex flex-col gap-1 z-20">
                <div className="flex items-center">
                    <span className="w-3 h-1 bg-slate-400 border-b border-dashed mr-2"></span>
                    <span>Proposed Route</span>
                </div>
                <div className="flex items-center">
                    <span className="w-3 h-1 bg-blue-500 rounded-full mr-2"></span>
                    <span>Actual Path</span>
                </div>
                {/* Speed Limit Indicator in Legend */}
                <div className="flex items-center ml-5 text-[10px] text-blue-800">
                    <span>(Shows Speed Limits)</span>
                </div>

                {severity ? (
                    <div className={`mt-1 pt-1 border-t border-gray-100`}>
                        <div className="flex items-center justify-between gap-4 mb-0.5">
                            <span className="font-bold text-gray-800">Deviation Severity</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${severity.color}`}>
                                {severity.label}
                            </span>
                        </div>
                        <p className={`text-[10px] ${severity.text}`}>{severity.desc}</p>
                    </div>
                ) : deviationSegments && (
                    <div className="flex items-center font-bold text-red-600 animate-pulse">
                        <span className="w-3 h-1 bg-red-500 rounded-full mr-2"></span>
                        <span>Deviation Detected!</span>
                    </div>
                )}
            </div>
        </div>
    );
}
