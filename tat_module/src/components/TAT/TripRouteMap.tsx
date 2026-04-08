'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { NavixyService } from '@/services/navixy';
import {
    Clock3,
    Gauge,
    LocateFixed,
    Maximize2,
    Minimize2,
    MoonStar,
    Pause,
    Play,
    Route,
    Satellite,
    Sparkles,
    SunMedium,
} from 'lucide-react';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SESSION_KEY = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
const MAP_STYLES: Record<'light' | 'dark' | 'satellite', string> = {
    light: 'mapbox://styles/mapbox/navigation-day-v1',
    dark: 'mapbox://styles/mapbox/navigation-night-v1',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
};

interface VisitEvent {
    geofence_name: string;
    in_time: string;
    out_time: string | null;
    event_type: string;
}

interface TrackPoint {
    lat: number;
    lng: number;
    time?: string;
    get_time?: string;
}

interface ZonePoint {
    lat: number;
    lng: number;
}

interface ZoneBounds {
    nw: ZonePoint;
    se: ZonePoint;
}

interface NavixyZone {
    label: string;
    type: 'circle' | 'polygon' | 'sausage' | string;
    center?: ZonePoint;
    radius?: number;
    points?: ZonePoint[];
    bounds?: ZoneBounds;
}

interface TripRouteMapProps {
    trackerId: number;
    startTime: string;
    endTime: string;
    visitChain?: VisitEvent[];
}

const EVENT_COLORS: Record<string, string> = {
    loading: '#22c55e',
    unloading: '#a855f7',
    border: '#f59e0b',
    transit: '#6b7280',
};

function formatHrs(hrs: number | null): string {
    if (hrs === null || hrs === undefined) return '--';
    if (hrs < 0) return '0m';
    if (hrs < 1) return `${Math.round(hrs * 60)}m`;
    return `${hrs.toFixed(1)}h`;
}

function formatUtcDate(ts: string | null | undefined): string {
    if (!ts) return '--';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    });
}

function getTrackPointTime(point: TrackPoint | undefined): string | undefined {
    return point?.time || point?.get_time;
}

function toTimestampMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

export default function TripRouteMap({ trackerId, startTime, endTime, visitChain }: TripRouteMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef<mapboxgl.Marker[]>([]);
    const animMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const coordsRef = useRef<[number, number][]>([]);
    const rawPointsRef = useRef<TrackPoint[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pointCount, setPointCount] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [animProgress, setAnimProgress] = useState(0);
    const [animSpeed, setAnimSpeed] = useState(1);
    const [currentTimestamp, setCurrentTimestamp] = useState<string>('');
    const [mapStyle, setMapStyle] = useState<'light' | 'dark' | 'satellite'>('dark');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const trackDataRef = useRef<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
    const zonesDataRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Polygon> | null>(null);

    const tripStartMs = useMemo(() => toTimestampMs(startTime), [startTime]);
    const tripEndMs = useMemo(() => toTimestampMs(endTime), [endTime]);
    const tripWindowHours = useMemo(() => {
        if (tripStartMs == null || tripEndMs == null || tripEndMs <= tripStartMs) return null;
        return (tripEndMs - tripStartMs) / 3_600_000;
    }, [tripEndMs, tripStartMs]);
    const filteredVisitChain = useMemo(() => {
        if (!visitChain || tripStartMs == null || tripEndMs == null) return [];
        return visitChain.filter((visit) => {
            const inMs = toTimestampMs(visit.in_time);
            const outMs = toTimestampMs(visit.out_time) ?? inMs;
            if (inMs == null && outMs == null) return false;
            const effectiveStart = inMs ?? outMs ?? tripStartMs;
            const effectiveEnd = outMs ?? inMs ?? tripEndMs;
            return effectiveStart <= tripEndMs && effectiveEnd >= tripStartMs;
        });
    }, [tripEndMs, tripStartMs, visitChain]);
    const uniqueStopCount = useMemo(
        () => new Set(filteredVisitChain.map((visit) => visit.geofence_name).filter(Boolean)).size,
        [filteredVisitChain]
    );
    const loadingStopCount = useMemo(
        () => filteredVisitChain.filter((visit) => visit.event_type === 'loading').length,
        [filteredVisitChain]
    );
    const borderStopCount = useMemo(
        () => filteredVisitChain.filter((visit) => visit.event_type === 'border').length,
        [filteredVisitChain]
    );
    const styleOptions = [
        { key: 'dark' as const, label: 'Night', icon: MoonStar },
        { key: 'light' as const, label: 'Day', icon: SunMedium },
        { key: 'satellite' as const, label: 'Satellite', icon: Satellite },
    ];

    const fitToRoute = useCallback((fullscreenMode = isFullscreen) => {
        const map = mapRef.current;
        const coordinates = coordsRef.current;
        if (!map || coordinates.length === 0) return;

        const bounds = new mapboxgl.LngLatBounds();
        coordinates.forEach((coordinate) => bounds.extend(coordinate));
        map.fitBounds(bounds, {
            padding: fullscreenMode ? 96 : 56,
            maxZoom: 14,
            duration: 900,
        });
    }, [isFullscreen]);

    // Init map
    useEffect(() => {
        if (!mapContainer.current || !MAPBOX_TOKEN || !SESSION_KEY) return;
        if (mapRef.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;
        mapRef.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: MAP_STYLES.dark,
            center: [35, -6],
            zoom: 5,
            attributionControl: false,
        });
        mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, []);

    // Fetch & render track
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !MAPBOX_TOKEN || !SESSION_KEY || !trackerId) return;

        let isActive = true;

        const loadTrack = async () => {
            setIsLoading(true);
            setError(null);
            setIsPlaying(false);
            setAnimProgress(0);

            try {
                // 1. Fetch track data first as it's the primary content
                let rawPoints: TrackPoint[] = [];
                try {
                    rawPoints = (await NavixyService.getTrack(trackerId, startTime, endTime, SESSION_KEY)) as TrackPoint[];
                } catch (trackErr) {
                    console.error('[TripRouteMap] getTrack failed:', trackErr);
                    setError('Failed to load track data.');
                    setIsLoading(false);
                    return;
                }

                if (!isActive) return;

                const filteredPoints = rawPoints
                    .filter((point) => {
                        const pointTime = toTimestampMs(getTrackPointTime(point));
                        if (pointTime == null || tripStartMs == null || tripEndMs == null) return false;
                        return pointTime >= tripStartMs && pointTime <= tripEndMs;
                    })
                    .sort((a, b) => {
                        const aTime = toTimestampMs(getTrackPointTime(a)) ?? 0;
                        const bTime = toTimestampMs(getTrackPointTime(b)) ?? 0;
                        return aTime - bTime;
                    });

                if (!filteredPoints || filteredPoints.length < 2) {
                    setError('No track data available inside the selected trip window.');
                    setIsLoading(false);
                    return;
                }

                setPointCount(filteredPoints.length);
                rawPointsRef.current = filteredPoints;
                const firstTimestamp = getTrackPointTime(filteredPoints[0]);
                setCurrentTimestamp(firstTimestamp ? new Date(firstTimestamp).toUTCString().replace('GMT', 'UTC') : '');

                const coordinates: [number, number][] = filteredPoints.map((point) => [point.lng, point.lat]);
                coordsRef.current = coordinates;

                const lineGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates },
                };
                trackDataRef.current = lineGeoJSON;

                // 2. Now that we have track data, we can already prepare the map.
                // We don't hide the loading yet if we want to try fetching zones too,
                // BUT we shouldn't block indefinitely.

                // 3. Fetch geofence zones in parallel (optional enhancement)
                let zones: NavixyZone[] = [];
                try {
                    zones = (await NavixyService.listZones(SESSION_KEY)) as NavixyZone[];
                } catch (zoneErr) {
                    console.warn('[TripRouteMap] listZones failed, proceeding without zone shapes:', zoneErr);
                }

                if (!isActive) return;

                // --- Build GeoJSON for Visited Geofence Shapes ---
                const visitedZoneFeatures: GeoJSON.Feature<GeoJSON.Polygon, { color: string }>[] = [];
                const addedZoneIds = new Set<string>();

                if (filteredVisitChain.length > 0 && zones && zones.length > 0) {
                    filteredVisitChain.forEach((visit) => {
                        const zone = zones.find((candidate) => candidate.label === visit.geofence_name);
                        if (zone && !addedZoneIds.has(zone.label)) {
                            addedZoneIds.add(zone.label);
                            const color = EVENT_COLORS[visit.event_type] || '#6b7280';

                            let polygonCoords: number[][][] = [];

                            if (zone.type === 'circle' && zone.center && zone.radius) {
                                // Mathematically approximate a circle in GeoJSON coordinates
                                const points = 64;
                                const km = zone.radius / 1000;
                                const distanceX = km / (111.320 * Math.cos(zone.center.lat * Math.PI / 180));
                                const distanceY = km / 110.574;
                                const ret: number[][] = [];
                                for (let i = 0; i < points; i++) {
                                    const theta = (i / points) * (2 * Math.PI);
                                    const x = distanceX * Math.cos(theta);
                                    const y = distanceY * Math.sin(theta);
                                    ret.push([zone.center.lng + x, zone.center.lat + y]);
                                }
                                ret.push(ret[0]); // Close polygon
                                polygonCoords = [ret];
                            } else if ((zone.type === 'polygon' || zone.type === 'sausage') && zone.points) {
                                // Use the exact polygon points
                                const ret = zone.points.map((point) => [point.lng, point.lat]);
                                if (ret.length > 0 && (ret[0][0] !== ret[ret.length - 1][0] || ret[0][1] !== ret[ret.length - 1][1])) {
                                    ret.push([...ret[0]]); // Close polygon
                                }
                                polygonCoords = [ret];
                            }

                            if (polygonCoords.length > 0 && polygonCoords[0].length > 3) {
                                visitedZoneFeatures.push({
                                    type: 'Feature',
                                    properties: { color },
                                    geometry: { type: 'Polygon', coordinates: polygonCoords }
                                });
                            }
                        }
                    });
                }

                zonesDataRef.current = {
                    type: 'FeatureCollection',
                    features: visitedZoneFeatures
                };

                const addData = () => {
                    if (!isActive || !mapRef.current || mapRef.current !== map) return;
                    setIsLoading(false);

                    // --- Clean previous sources/layers ---
                    [
                        'track-route-arrows', 'track-route-line', 'track-route-glow', 'track-progress-line',
                        'visited-zones-fill', 'visited-zones-line'
                    ].forEach(id => {
                        if (map.getLayer(id)) map.removeLayer(id);
                    });
                    ['track-route', 'track-progress', 'visited-zones'].forEach(id => {
                        if (map.getSource(id)) map.removeSource(id);
                    });

                    // --- Visited Zones ---
                    if (zonesDataRef.current && zonesDataRef.current.features.length > 0) {
                        map.addSource('visited-zones', { type: 'geojson', data: zonesDataRef.current });
                        map.addLayer({
                            id: 'visited-zones-fill',
                            type: 'fill',
                            source: 'visited-zones',
                            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 }
                        });
                        map.addLayer({
                            id: 'visited-zones-line',
                            type: 'line',
                            source: 'visited-zones',
                            paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] }
                        });
                    }

                    // --- Route Source ---
                    map.addSource('track-route', { type: 'geojson', data: lineGeoJSON });

                    // Glow
                    map.addLayer({
                        id: 'track-route-glow',
                        type: 'line',
                        source: 'track-route',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: { 'line-color': '#22d3ee', 'line-width': 10, 'line-blur': 1.6, 'line-opacity': 0.18 },
                    });

                    // Core line
                    map.addLayer({
                        id: 'track-route-line',
                        type: 'line',
                        source: 'track-route',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: { 'line-color': '#7dd3fc', 'line-width': 3.5, 'line-opacity': 0.86 },
                    });

                    // --- Direction Arrows ---
                    // Load arrow image if not already loaded
                    if (!map.hasImage('arrow-icon')) {
                        const arrowCanvas = document.createElement('canvas');
                        arrowCanvas.width = 20;
                        arrowCanvas.height = 20;
                        const ctx = arrowCanvas.getContext('2d')!;
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.moveTo(10, 2);
                        ctx.lineTo(18, 16);
                        ctx.lineTo(10, 12);
                        ctx.lineTo(2, 16);
                        ctx.closePath();
                        ctx.fill();
                        map.addImage('arrow-icon', ctx.getImageData(0, 0, 20, 20), { sdf: true });
                    }

                    map.addLayer({
                        id: 'track-route-arrows',
                        type: 'symbol',
                        source: 'track-route',
                        layout: {
                            'symbol-placement': 'line',
                            'symbol-spacing': 80,
                            'icon-image': 'arrow-icon',
                            'icon-size': 0.6,
                            'icon-rotate': 90,
                            'icon-allow-overlap': true,
                            'icon-ignore-placement': true,
                        },
                        paint: {
                            'icon-color': '#cffafe',
                            'icon-opacity': 0.72,
                        },
                    });

                    // --- Animation progress line (will be updated during playback) ---
                    map.addSource('track-progress', {
                        type: 'geojson',
                        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [coordinates[0], coordinates[0]] } },
                    });
                    map.addLayer({
                        id: 'track-progress-line',
                        type: 'line',
                        source: 'track-progress',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: { 'line-color': '#f59e0b', 'line-width': 4.5, 'line-opacity': 0.95 },
                    });

                    // --- Markers ---
                    markersRef.current.forEach(m => m.remove());
                    markersRef.current = [];
                    if (animMarkerRef.current) { animMarkerRef.current.remove(); animMarkerRef.current = null; }

                    // Start marker
                    const startEl = document.createElement('div');
                    startEl.innerHTML = `
                        <div style="width:22px;height:22px;border-radius:9999px;background:rgba(16,185,129,0.16);border:1px solid rgba(110,231,183,0.55);box-shadow:0 12px 26px -14px rgba(16,185,129,0.95);display:flex;align-items:center;justify-content:center;">
                            <div style="width:8px;height:8px;border-radius:9999px;background:#34d399;border:2px solid #ecfdf5;"></div>
                        </div>
                    `;
                    markersRef.current.push(
                        new mapboxgl.Marker(startEl).setLngLat(coordinates[0])
                            .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`<div style="color:#0f172a;font-size:12px"><b>Trip start</b><br/>${new Date(startTime).toUTCString()}</div>`))
                            .addTo(map)
                    );

                    // End marker
                    const endEl = document.createElement('div');
                    endEl.innerHTML = `
                        <div style="width:22px;height:22px;border-radius:9999px;background:rgba(248,113,113,0.16);border:1px solid rgba(252,165,165,0.55);box-shadow:0 12px 26px -14px rgba(239,68,68,0.95);display:flex;align-items:center;justify-content:center;">
                            <div style="width:8px;height:8px;border-radius:9999px;background:#fb7185;border:2px solid #fff1f2;"></div>
                        </div>
                    `;
                    markersRef.current.push(
                        new mapboxgl.Marker(endEl).setLngLat(coordinates[coordinates.length - 1])
                            .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`<div style="color:#0f172a;font-size:12px"><b>Trip end</b><br/>${new Date(endTime).toUTCString()}</div>`))
                            .addTo(map)
                    );

                    // Geofence visit markers
                    if (filteredVisitChain.length > 0) {
                        // Group fragmented visits by geofence to calculate total absolute dwell time
                        // and prevent stacking multiple identical markers on top of each other
                        const aggregatedVisits = Array.from(filteredVisitChain.reduce((acc, visit) => {
                            if (!acc.has(visit.geofence_name)) {
                                acc.set(visit.geofence_name, { ...visit });
                            } else {
                                const exist = acc.get(visit.geofence_name)!;
                                const inT = Math.min(new Date(exist.in_time).getTime(), new Date(visit.in_time).getTime());
                                if (!isNaN(inT)) {
                                    exist.in_time = new Date(inT).toISOString();
                                }

                                if (visit.out_time || exist.out_time) {
                                    const eOut = exist.out_time ? new Date(exist.out_time).getTime() : Date.now();
                                    const nOut = visit.out_time ? new Date(visit.out_time).getTime() : Date.now();
                                    const outT = Math.max(eOut, nOut);
                                    if (!isNaN(outT)) {
                                        exist.out_time = new Date(outT).toISOString();
                                    }
                                }
                            }
                            return acc;
                        }, new Map<string, VisitEvent>()).values());

                        aggregatedVisits.forEach((visit) => {
                            // First, try to perfectly match the zone by name to get its TRUE geographic center
                            const zone = zones.find((candidate) => candidate.label === visit.geofence_name);

                            let matchedLng: number | undefined;
                            let matchedLat: number | undefined;

                            if (zone && zone.center) {
                                // EXACT Placement based on actual Geofence Definition (Circles)
                                matchedLng = zone.center.lng;
                                matchedLat = zone.center.lat;
                            } else if (zone && zone.bounds) {
                                // Calculate Centroid for Polygons based on bounding box
                                matchedLng = (zone.bounds.nw.lng + zone.bounds.se.lng) / 2;
                                matchedLat = (zone.bounds.nw.lat + zone.bounds.se.lat) / 2;
                            } else {
                                // Fallback: Interpolate from nearest GPS track point if zone magically disappeared
                                const visitTime = new Date(visit.in_time).getTime();
                                let nearest = filteredPoints[0];
                                let minDiff = Infinity;
                                for (const p of filteredPoints) {
                                    const diff = Math.abs(new Date(getTrackPointTime(p) || '').getTime() - visitTime);
                                    if (diff < minDiff) { minDiff = diff; nearest = p; }
                                }
                                if (nearest?.lat && nearest?.lng) {
                                    matchedLng = nearest.lng;
                                    matchedLat = nearest.lat;
                                }
                            }

                            if (matchedLng !== undefined && matchedLat !== undefined) {
                                const color = EVENT_COLORS[visit.event_type] || '#6b7280';
                                const el = document.createElement('div');
                                el.innerHTML = `
                                    <div style="width:18px;height:18px;border-radius:9999px;background:rgba(2,6,23,0.78);border:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px -16px ${color};cursor:pointer;position:relative;z-index:2;">
                                        <div style="width:8px;height:8px;border-radius:9999px;background:${color};box-shadow:0 0 10px ${color};"></div>
                                    </div>
                                `;

                                let dwell = 'ongoing';
                                if (visit.in_time && visit.out_time) {
                                    const diffHrs = (new Date(visit.out_time).getTime() - new Date(visit.in_time).getTime()) / 3600000;
                                    dwell = formatHrs(diffHrs);
                                }

                                markersRef.current.push(
                                    new mapboxgl.Marker(el).setLngLat([matchedLng, matchedLat])
                                        .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(
                                            `<div style="color:#333;font-size:11px;max-width:180px"><b>${visit.geofence_name}</b><br/><span style="color:${color};font-weight:600;text-transform:uppercase;font-size:10px">${visit.event_type}</span><br/><span style="color:#666">Dwell: ${dwell}</span></div>`
                                        ))
                                        .addTo(map)
                                );
                            }
                        });
                    }

                    // --- Animated truck marker (initially hidden) ---
                    const truckEl = document.createElement('div');
                    truckEl.innerHTML = `
                        <div style="width:28px;height:28px;border-radius:9999px;background:rgba(245,158,11,0.16);border:1px solid rgba(251,191,36,0.65);box-shadow:0 0 0 6px rgba(245,158,11,0.12),0 18px 30px -18px rgba(245,158,11,0.9);display:flex;align-items:center;justify-content:center;">
                            <div style="width:10px;height:10px;border-radius:9999px;background:#f59e0b;border:2px solid #fffbeb;"></div>
                        </div>
                    `;
                    animMarkerRef.current = new mapboxgl.Marker(truckEl)
                        .setLngLat(coordinates[0])
                        .addTo(map);

                    // Fit bounds
                    const bounds = new mapboxgl.LngLatBounds();
                    coordinates.forEach(c => bounds.extend(c));
                    map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 900 });
                };

                if (map.isStyleLoaded()) {
                    addData();
                } else {
                    map.once('style.load', addData);
                }

            } catch (err: unknown) {
                console.error('[TripRouteMap] Failed:', err);
                setError(err instanceof Error ? err.message : 'Failed to load track data');
            } finally {
                setIsLoading(false);
            }
        };

        loadTrack();

        return () => {
            isActive = false;
        };
    }, [trackerId, startTime, endTime, filteredVisitChain, tripEndMs, tripStartMs]);

    // --- Animation Loop ---
    const progressRef = useRef(0);

    const animate = useCallback(() => {
        const coords = coordsRef.current;
        const rawPts = rawPointsRef.current;
        const map = mapRef.current;
        if (!map || coords.length < 2) return;

        const step = (0.0005 * animSpeed); // advance per frame
        progressRef.current = Math.min(progressRef.current + step, 1);
        const progress = progressRef.current;

        // Calculate current index (interpolated)
        const totalIdx = progress * (coords.length - 1);
        const idx = Math.floor(totalIdx);
        const frac = totalIdx - idx;

        // Interpolate position
        const lng = coords[idx][0] + (idx < coords.length - 1 ? frac * (coords[idx + 1][0] - coords[idx][0]) : 0);
        const lat = coords[idx][1] + (idx < coords.length - 1 ? frac * (coords[idx + 1][1] - coords[idx][1]) : 0);

        // Update truck marker
        animMarkerRef.current?.setLngLat([lng, lat]);

        // Update progress line (yellow overlay up to current position)
        const progressCoords = coords.slice(0, idx + 1).concat([[lng, lat]]);
        const progressSource = map.getSource('track-progress') as mapboxgl.GeoJSONSource;
        if (progressSource) {
            progressSource.setData({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: progressCoords },
            });
        }

        // Update timestamp display
        if (rawPts[idx]) {
            const t = getTrackPointTime(rawPts[idx]);
            if (t) setCurrentTimestamp(new Date(t).toUTCString().replace('GMT', 'UTC'));
        }

        setAnimProgress(progress);

        if (progress >= 1) {
            setIsPlaying(false);
            return;
        }

        animFrameRef.current = requestAnimationFrame(animate);
    }, [animSpeed]);

    // Start/stop animation
    useEffect(() => {
        if (isPlaying) {
            if (progressRef.current >= 1) progressRef.current = 0; // restart if ended
            animFrameRef.current = requestAnimationFrame(animate);
        } else {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        }
        return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
    }, [isPlaying, animate]);

    // Handle seek (slider drag)
    const handleSeek = (val: number) => {
        progressRef.current = val;
        setAnimProgress(val);

        const coords = coordsRef.current;
        const rawPts = rawPointsRef.current;
        const map = mapRef.current;
        if (!map || coords.length < 2) return;

        const totalIdx = val * (coords.length - 1);
        const idx = Math.floor(totalIdx);
        const frac = totalIdx - idx;
        const lng = coords[idx][0] + (idx < coords.length - 1 ? frac * (coords[idx + 1][0] - coords[idx][0]) : 0);
        const lat = coords[idx][1] + (idx < coords.length - 1 ? frac * (coords[idx + 1][1] - coords[idx][1]) : 0);

        animMarkerRef.current?.setLngLat([lng, lat]);

        const progressCoords = coords.slice(0, idx + 1).concat([[lng, lat]]);
        const progressSource = map.getSource('track-progress') as mapboxgl.GeoJSONSource;
        if (progressSource) {
            progressSource.setData({
                type: 'Feature', properties: {},
                geometry: { type: 'LineString', coordinates: progressCoords },
            });
        }

        if (rawPts[idx]) {
            const t = getTrackPointTime(rawPts[idx]);
            if (t) setCurrentTimestamp(new Date(t).toUTCString().replace('GMT', 'UTC'));
        }
    };

    // --- Map Style Change Effect ---
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        let isActive = true;
        map.setStyle(MAP_STYLES[mapStyle]);

        // Re-add layers after style loads
        map.once('style.load', () => {
            if (!isActive || !mapRef.current || mapRef.current !== map) return;

            const lineData = trackDataRef.current;
            if (!lineData || coordsRef.current.length < 2) return;

            // Re-add visited zones
            const zonesData = zonesDataRef.current;
            if (zonesData && zonesData.features.length > 0) {
                map.addSource('visited-zones', { type: 'geojson', data: zonesData });
                map.addLayer({ id: 'visited-zones-fill', type: 'fill', source: 'visited-zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } });
                map.addLayer({ id: 'visited-zones-line', type: 'line', source: 'visited-zones', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] } });
            }

            // Re-add track source & layers
            map.addSource('track-route', { type: 'geojson', data: lineData });
            map.addLayer({ id: 'track-route-glow', type: 'line', source: 'track-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#22d3ee', 'line-width': 10, 'line-blur': 1.6, 'line-opacity': 0.18 } });
            map.addLayer({ id: 'track-route-line', type: 'line', source: 'track-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#7dd3fc', 'line-width': 3.5, 'line-opacity': 0.86 } });

            // Re-add arrow image
            const arrowCanvas = document.createElement('canvas');
            arrowCanvas.width = 20; arrowCanvas.height = 20;
            const ctx = arrowCanvas.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(18, 16); ctx.lineTo(10, 12); ctx.lineTo(2, 16); ctx.closePath(); ctx.fill();
            if (!map.hasImage('arrow-icon')) map.addImage('arrow-icon', ctx.getImageData(0, 0, 20, 20), { sdf: true });

            map.addLayer({ id: 'track-route-arrows', type: 'symbol', source: 'track-route', layout: { 'symbol-placement': 'line', 'symbol-spacing': 80, 'icon-image': 'arrow-icon', 'icon-size': 0.6, 'icon-rotate': 90, 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': '#cffafe', 'icon-opacity': 0.72 } });

            // Re-add progress source
            const progressCoords = coordsRef.current.slice(0, Math.max(1, Math.floor(progressRef.current * coordsRef.current.length)));
            map.addSource('track-progress', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: progressCoords.length > 1 ? progressCoords : [coordsRef.current[0], coordsRef.current[0]] } } });
            map.addLayer({ id: 'track-progress-line', type: 'line', source: 'track-progress', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f59e0b', 'line-width': 4.5, 'line-opacity': 0.95 } });
        });

        return () => {
            isActive = false;
        };
    }, [mapStyle]);

    if (!MAPBOX_TOKEN) {
        return (
            <div className="flex min-h-[320px] items-center justify-center rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-6 text-center text-sm text-rose-100">
                Missing `NEXT_PUBLIC_MAPBOX_TOKEN`
            </div>
        );
    }

    if (!SESSION_KEY) {
        return (
            <div className="flex min-h-[320px] items-center justify-center rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-6 text-center text-sm text-rose-100">
                Missing `NEXT_PUBLIC_NAVIXY_SESSION_KEY`
            </div>
        );
    }

    return (
        <div
            className={`relative overflow-hidden border border-slate-800/80 bg-slate-950/75 shadow-[0_28px_80px_-42px_rgba(8,15,32,0.95)] transition-all ${
                isFullscreen ? 'fixed inset-0 z-[9999] rounded-none border-none' : 'rounded-[28px]'
            }`}
        >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.12),_transparent_24%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-slate-950/80 via-slate-950/20 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-transparent" />

            <div ref={mapContainer} className={`w-full ${isFullscreen ? 'h-full' : 'h-[560px] sm:h-[620px] xl:h-[720px]'}`} />

            {isLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/65 backdrop-blur-md">
                    <div className="rounded-[24px] border border-slate-700/70 bg-slate-950/85 px-5 py-4 shadow-[0_20px_50px_-30px_rgba(34,211,238,0.55)]">
                        <div className="flex items-center gap-3 text-slate-200">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-300/80 border-t-transparent" />
                            <div>
                                <div className="text-sm font-medium">Loading route intelligence</div>
                                <div className="text-xs text-slate-400">Fetching GPS trace and matched geofence overlays.</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {error && !isLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 backdrop-blur-md">
                    <div className="max-w-md rounded-[24px] border border-amber-400/20 bg-amber-500/10 px-6 py-5 text-center text-sm text-amber-50">
                        <div className="text-base font-semibold">Route data unavailable</div>
                        <div className="mt-2 leading-6 text-amber-100/80">{error}</div>
                    </div>
                </div>
            )}

            {pointCount > 0 && !isLoading && (
                <>
                    <div className="pointer-events-none absolute inset-x-5 top-5 z-20 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="pointer-events-auto max-w-xl rounded-[24px] border border-slate-700/70 bg-slate-950/78 p-4 backdrop-blur-xl shadow-[0_24px_60px_-36px_rgba(34,211,238,0.45)]">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                                        <Sparkles className="h-3.5 w-3.5" />
                                        Route Intelligence
                                    </div>
                                    <h4 className="mt-3 text-lg font-semibold tracking-tight text-white">Playback-ready trip trace</h4>
                                    <p className="mt-1 text-sm text-slate-400">
                                        Cyan route line, amber playback progression, and geofence overlays matched to the selected lifecycle window.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-slate-700/70 bg-slate-900/65 px-3 py-2 text-right">
                                    <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">Window</div>
                                    <div className="mt-1 text-sm font-semibold text-slate-100">{formatHrs(tripWindowHours)}</div>
                                    <div className="mt-1 text-[11px] text-slate-400">{formatUtcDate(startTime)} to {formatUtcDate(endTime)}</div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">GPS samples</div>
                                    <div className="mt-2 text-lg font-semibold text-white">{pointCount.toLocaleString()}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Visited stops</div>
                                    <div className="mt-2 text-lg font-semibold text-white">{uniqueStopCount}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Loading stops</div>
                                    <div className="mt-2 text-lg font-semibold text-white">{loadingStopCount}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/65 p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Border stops</div>
                                    <div className="mt-2 text-lg font-semibold text-white">{borderStopCount}</div>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-300">
                                <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-950/70 px-3 py-1.5">
                                    <span className="h-2 w-8 rounded-full bg-cyan-300" />
                                    Route trace
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-950/70 px-3 py-1.5">
                                    <span className="h-2 w-8 rounded-full bg-amber-400" />
                                    Playback progress
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-950/70 px-3 py-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                                    Start marker
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-950/70 px-3 py-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                                    End marker
                                </span>
                            </div>
                        </div>

                        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
                            <div className="flex items-center gap-1 rounded-[20px] border border-slate-700/70 bg-slate-950/78 p-1 backdrop-blur-xl">
                                {styleOptions.map(({ key, label, icon: Icon }) => (
                                    <button
                                        key={key}
                                        onClick={() => setMapStyle(key)}
                                        className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-[11px] font-medium transition ${
                                            mapStyle === key
                                                ? 'bg-cyan-500/16 text-cyan-100 shadow-[0_10px_26px_-18px_rgba(34,211,238,0.8)]'
                                                : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100'
                                        }`}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => {
                                    fitToRoute();
                                }}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/78 px-3 py-2 text-[11px] font-medium text-slate-200 backdrop-blur-xl transition hover:border-slate-600 hover:text-white"
                                title="Fit route to viewport"
                            >
                                <LocateFixed className="h-3.5 w-3.5" />
                                Fit route
                            </button>

                            <button
                                onClick={() => {
                                    const nextFullscreen = !isFullscreen;
                                    setIsFullscreen((full) => !full);
                                    window.setTimeout(() => {
                                        mapRef.current?.resize();
                                        fitToRoute(nextFullscreen);
                                    }, 120);
                                }}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/78 px-3 py-2 text-[11px] font-medium text-slate-200 backdrop-blur-xl transition hover:border-slate-600 hover:text-white"
                                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                            >
                                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                                {isFullscreen ? 'Exit full view' : 'Expand'}
                            </button>
                        </div>
                    </div>

                    <div className="pointer-events-none absolute inset-x-5 bottom-5 z-20">
                        <div className="pointer-events-auto rounded-[24px] border border-slate-700/70 bg-slate-950/82 p-4 backdrop-blur-xl shadow-[0_24px_60px_-36px_rgba(249,115,22,0.32)]">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setIsPlaying(!isPlaying)}
                                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-amber-400/20 bg-amber-500/12 text-amber-300 transition hover:bg-amber-500/18 hover:text-amber-100"
                                    >
                                        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                                    </button>

                                    <div>
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Playback</div>
                                        <div className="mt-1 text-sm font-medium text-white">
                                            {isPlaying ? 'Animation in progress' : 'Playback paused'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex min-w-[110px] items-center justify-end gap-2 rounded-2xl border border-slate-800/80 bg-slate-900/65 px-3 py-2 text-slate-300">
                                    <Gauge className="h-3.5 w-3.5 text-slate-400" />
                                    <button
                                        onClick={() => setAnimSpeed((speed) => (speed === 1 ? 2 : speed === 2 ? 4 : speed === 4 ? 8 : 1))}
                                        className="text-xs font-semibold tracking-[0.18em] text-slate-200 transition hover:text-white"
                                    >
                                        {animSpeed}x
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4">
                                <div className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
                                    <span>Route progress</span>
                                    <span>{Math.round(animProgress * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.001}
                                    value={animProgress}
                                    onChange={(e) => {
                                        handleSeek(parseFloat(e.target.value));
                                        setIsPlaying(false);
                                    }}
                                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-amber-400"
                                />
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
                                <span className="inline-flex items-center gap-2 rounded-full border border-slate-800/80 bg-slate-900/65 px-3 py-1.5">
                                    <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                                    {currentTimestamp || formatUtcDate(startTime)}
                                </span>
                                <span className="inline-flex items-center gap-2 rounded-full border border-slate-800/80 bg-slate-900/65 px-3 py-1.5">
                                    <Route className="h-3.5 w-3.5 text-slate-500" />
                                    {formatUtcDate(startTime)} to {formatUtcDate(endTime)}
                                </span>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
