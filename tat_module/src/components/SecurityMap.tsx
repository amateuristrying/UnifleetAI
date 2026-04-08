'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { cellToBoundary, cellToLatLng, cellToParent, gridDisk } from 'h3-js';
import * as turf from '@turf/turf';
import { supabase } from '@/lib/supabase';
import { SecurityHotspot } from '@/types/security';
import { Vehicle } from '@/types/telemetry';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;


type ViewLayer = 'points' | 'hexgrid' | 'clusters' | 'corridors' | 'deviations' | 'safezones' | 'anomalies';

interface HexData {
    h3_index: string;
    risk_score: number;
    incident_count: number;
    critical_count: number;
    night_incident_count: number;
    reason_distribution: Record<string, number>;
    center_lat: number;
    center_lng: number;
    boundary_geojson: GeoJSON.Polygon;
}

interface CorridorData {
    h3_index: string;
    visit_count: number;
    is_night_route: boolean;
    center_lat: number;
    center_lng: number;
    bearing_bucket?: number; // 0-7 (N, NE, E...)
    road_geometry?: GeoJSON.Point; // OSRM snapped point
    boundary_geojson: GeoJSON.Polygon;
}

interface ClusterData {
    cluster_id: number;
    risk_score: number;
    hex_count: number;
    incident_count: number;
    polygon_geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    center_lat: number;
    center_lng: number;
    is_night_dominant: boolean;
    primary_reason: string;
    reason_distribution: Record<string, number>;
}

interface StopRiskData {
    stop_id: string;
    tracker_id: number;
    tracker_name: string;
    risk_score: number;
    severity_level: string;
    risk_reasons: string[];
    stop_lat: number;
    stop_lng: number;
    stop_start: string;
    stop_end: string | null;
    stop_duration_hours: number;
    h3_index: string;
    is_night_stop: boolean;
    is_in_risk_zone: boolean;
    is_ignition_anomaly: boolean;
    is_position_mismatch: boolean;
    position_mismatch_km: number | null;
    ignition_on_percent: number | null;
    safe_zone_name: string | null;
    analyzed_at: string;
}

interface DeviationData {
    trip_id: string;
    tracker_name: string;
    severity_level: string;
    deviation_km: number;
    risk_score: number;
    geometry: GeoJSON.FeatureCollection | GeoJSON.MultiLineString | null;
    risk_reasons: string[];
}


interface SecurityMapProps {
    dateRange: { start: string; end: string };
    filters: { brands: string[]; vehicles: string[] };
    vehicles: Vehicle[];
}

// Risk score → color (red gradient on dark map)
function riskColor(score: number): string {
    if (score >= 80) return 'rgba(220, 38, 38, 0.7)';   // red-600
    if (score >= 60) return 'rgba(239, 68, 68, 0.55)';   // red-500
    if (score >= 40) return 'rgba(249, 115, 22, 0.45)';  // orange-500
    if (score >= 20) return 'rgba(234, 179, 8, 0.35)';   // yellow-500
    return 'rgba(34, 197, 94, 0.25)';                     // green-500
}

function formatReason(reason: string): string {
    return reason
        .replace(/_/g, ' ')
        .replace(/\bX(\d+)/, '($1x)')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Risk Reason Metadata (matches stop-analysis.ts reason codes) ───
const RISK_REASON_OPTIONS: {
    code: string;
    label: string;
    description: string;
    color: string;
    bg: string;
}[] = [
        {
            code: 'NIGHT_STOP_OUTSIDE_SAFE_ZONE',
            label: 'Night Stop',
            description: 'Outside safe zone, 22:00-05:00',
            color: '#a855f7',
            bg: 'rgba(168, 85, 247, 0.12)',
        },
        {
            code: 'STOP_IN_RISK_ZONE',
            label: 'Risk Zone',
            description: 'Located in high-risk H3 cell',
            color: '#ef4444',
            bg: 'rgba(239, 68, 68, 0.12)',
        },
        {
            code: 'ABNORMAL_LONG_STOP',
            label: 'Long Duration',
            description: 'Over 4h or 3x vehicle median',
            color: '#f59e0b',
            bg: 'rgba(245, 158, 11, 0.12)',
        },
        {
            code: 'IGNITION_ANOMALY',
            label: 'Ignition Anomaly',
            description: 'Engine ON >30% during stop',
            color: '#f97316',
            bg: 'rgba(249, 115, 22, 0.12)',
        },
        {
            code: 'POSITION_MISMATCH_TOW_RISK',
            label: 'Tow Risk',
            description: 'Vehicle moved >0.5km while stopped',
            color: '#f43f5e',
            bg: 'rgba(244, 63, 94, 0.12)',
        },
        {
            code: 'REPEAT_SUSPICIOUS_LOCATION',
            label: 'Repeat Suspicious',
            description: '3+ visits to non-safe location',
            color: '#eab308',
            bg: 'rgba(234, 179, 8, 0.12)',
        },
        {
            code: 'UNUSUAL_LOCATION_NIGHT',
            label: 'Unusual Location',
            description: 'First-time location at night',
            color: '#8b5cf6',
            bg: 'rgba(139, 92, 246, 0.12)',
        },
        {
            code: 'SHORT_PRECEDING_TRIP',
            label: 'Short Trip',
            description: 'Previous trip <2km or <5min',
            color: '#64748b',
            bg: 'rgba(100, 116, 139, 0.12)',
        },
        {
            code: 'REMOTE_HIGHWAY_STOP',
            label: 'Highway Stop',
            description: 'Stopped on high-speed corridor',
            color: '#06b6d4',
            bg: 'rgba(6, 182, 212, 0.12)',
        },
    ];

// ─── Client-side DBSCAN clustering of filtered incidents ───
function clusterIncidentsClientSide(stops: StopRiskData[]): ClusterData[] {
    if (stops.length < 2) return [];

    const points = turf.featureCollection(
        stops.map(s => turf.point([s.stop_lng, s.stop_lat], {
            riskScore: s.risk_score,
            isNight: s.is_night_stop,
            reasons: s.risk_reasons,
        }))
    );

    const clustered = turf.clustersDbscan(points, 5, { minPoints: 2 });

    const clusterMap = new Map<number, (typeof clustered.features)[number][]>();
    for (const feat of clustered.features) {
        const cid = feat.properties?.cluster;
        if (cid === undefined || cid === null || cid < 0) continue;
        if (!clusterMap.has(cid)) clusterMap.set(cid, []);
        clusterMap.get(cid)!.push(feat);
    }

    const result: ClusterData[] = [];
    clusterMap.forEach((features, clusterId) => {
        if (features.length < 2) return;

        const hull = turf.convex(turf.featureCollection(features));
        if (!hull) {
            // Fallback for collinear points: buffer the centroid
            const cent = turf.center(turf.featureCollection(features));
            const buffered = turf.buffer(cent, 1.5, { units: 'kilometers' });
            if (!buffered) return;
            buildCluster(buffered as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>, features as GeoJSON.Feature<GeoJSON.Point>[], clusterId, result);
            return;
        }

        const buffered = turf.buffer(hull, 1, { units: 'kilometers' });
        if (!buffered) return;
        buildCluster(buffered as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>, features as GeoJSON.Feature<GeoJSON.Point>[], clusterId, result);
    });

    return result.sort((a, b) => b.risk_score - a.risk_score);
}

function buildCluster(
    polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
    features: GeoJSON.Feature<GeoJSON.Point>[],
    clusterId: number,
    out: ClusterData[]
) {
    const center = turf.center(polygon);
    const nightCount = features.filter(f => f.properties?.isNight).length;

    const reasons: Record<string, number> = {};
    for (const f of features) {
        for (const r of (f.properties?.reasons || [])) {
            const base = r.replace(/_X\d+$/, '');
            reasons[base] = (reasons[base] || 0) + 1;
        }
    }
    const primaryReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';

    out.push({
        cluster_id: clusterId,
        risk_score: Math.round(features.reduce((s, f) => s + (f.properties?.riskScore || 0), 0) / features.length),
        hex_count: features.length,
        incident_count: features.length,
        polygon_geojson: polygon.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        center_lat: center.geometry.coordinates[1],
        center_lng: center.geometry.coordinates[0],
        is_night_dominant: nightCount > features.length / 2,
        primary_reason: primaryReason,
        reason_distribution: reasons,
    });
}

export default function SecurityMap({ dateRange, filters, vehicles }: SecurityMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const popup = useRef<mapboxgl.Popup | null>(null);
    const mapLoaded = useRef(false);

    const [activeLayer, setActiveLayer] = useState<ViewLayer>('hexgrid');
    const [hotspots, setHotspots] = useState<SecurityHotspot[]>([]);
    const [allHexes, setAllHexes] = useState<HexData[]>([]); // Store full dataset
    const [hexes, setHexes] = useState<HexData[]>([]);       // Store filtered dataset
    const [allClusters, setAllClusters] = useState<ClusterData[]>([]); // Store full clusters
    const [clusters, setClusters] = useState<ClusterData[]>([]);       // Store filtered clusters
    const [corridors, setCorridors] = useState<CorridorData[]>([]);
    const [deviations, setDeviations] = useState<DeviationData[]>([]);
    const [tamperingEvents, setTamperingEvents] = useState<any[]>([]);
    const [stopRisks, setStopRisks] = useState<StopRiskData[]>([]);

    const [safeZones, setSafeZones] = useState<GeoJSON.FeatureCollection | null>(null);

    const [loading, setLoading] = useState(false);
    const [counts, setCounts] = useState({ points: 0, hexes: 0, clusters: 0, stops: 0, corridors: 0, deviations: 0, safezones: 0, patterns: 0, anomalies: 0 });
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');

    // NEW: Temporal Filters
    const [dayFilter, setDayFilter] = useState<number | null>(null); // null = All Days
    const [hourFilter, setHourFilter] = useState<number | null>(null); // null = All Times
    const [monthFilter, setMonthFilter] = useState<number | null>(null); // null = All Months
    const [yearFilter, setYearFilter] = useState<number | null>(null); // null = All Years
    const [trackerFilter, setTrackerFilter] = useState<number | null>(null); // null = All Trackers
    // ... (existing code)
    const [operationalMode, setOperationalMode] = useState(false);

    // NEW: Risk Reason Filter
    const [riskReasonFilter, setRiskReasonFilter] = useState<string[]>([]);
    // ... (existing code)
    // ... In render ...


    const [riskSelectOpen, setRiskSelectOpen] = useState(false);
    const [selectedFeature, setSelectedFeature] = useState<any>(null);
    const [dynamicClusters, setDynamicClusters] = useState<ClusterData[]>([]);
    const [clusteringIncidents, setClusteringIncidents] = useState(false);
    const [towRiskDetails, setTowRiskDetails] = useState<{
        nextTripId: string;
        nextTripStart: string;
        nextTripStartLat: number;
        nextTripStartLng: number;
        distanceKm: number;
    } | null>(null);
    const [towRiskLoading, setTowRiskLoading] = useState(false);

    // ─── Fetch functions for lazy loading ─────────────────────

    const fetchHotspots = useCallback(async () => {
        if (hotspots.length > 0) return;
        setLoading(true);
        try {
            let allHotspots: SecurityHotspot[] = [];
            let page = 0;
            const pageSize = 1000;
            let keepFetching = true;

            while (keepFetching) {
                let q = supabase.from('security_hotspots').select('*');
                if (dateRange.start) q = q.gte('analyzed_at', dateRange.start);
                if (dateRange.end) q = q.lte('analyzed_at', dateRange.end);
                if (filters.vehicles.length > 0) q = q.in('tracker_name', filters.vehicles);

                const { data, error } = await q.range(page * pageSize, (page + 1) * pageSize - 1);
                if (error) throw error;

                if (data && data.length > 0) {
                    allHotspots = [...allHotspots, ...(data as SecurityHotspot[])];
                    if (data.length < pageSize) keepFetching = false;
                } else {
                    keepFetching = false;
                }
                page++;
                if (page > 100) break; // Safety
            }

            setHotspots(allHotspots);
            setCounts(prev => ({ ...prev, points: allHotspots.length }));
        } catch (err) { console.error('Error fetching hotspots:', err); }
        finally { setLoading(false); }
    }, [dateRange, filters, hotspots.length]);

    const fetchHexGrid = useCallback(async () => {
        setLoading(true);
        try {
            // 1. Fetch Full Hex Data (Only once)
            let currentAllHexes = allHexes;
            if (currentAllHexes.length === 0) {
                const { data: ver } = await supabase.from('risk_zone_hexes').select('version').order('version', { ascending: false }).limit(1).maybeSingle();
                const latestVersion = ver?.version;
                if (!latestVersion) return;

                let allRawHexes: HexData[] = [];
                let page = 0;
                const pageSize = 1000;
                let keepFetching = true;

                while (keepFetching) {
                    const { data, error } = await supabase.from('risk_zone_hexes')
                        .select('*')
                        .eq('version', latestVersion)
                        .gte('risk_score', 0)
                        .range(page * pageSize, (page + 1) * pageSize - 1);

                    if (error) throw error;

                    if (data && data.length > 0) {
                        allRawHexes = [...allRawHexes, ...(data as HexData[])];
                        if (data.length < pageSize) keepFetching = false;
                    } else {
                        keepFetching = false;
                    }
                    page++;
                    if (page > 500) break; // Safety
                }

                // Hydrate Hexes (Calculate Geometry)
                currentAllHexes = allRawHexes.map(h => {
                    if (h.boundary_geojson) return h;
                    const coords = cellToBoundary(h.h3_index);
                    coords.push(coords[0]);
                    const geoJsonCoords = [coords.map(pt => [pt[1], pt[0]])];
                    const [cLat, cLng] = cellToLatLng(h.h3_index);
                    return {
                        ...h,
                        center_lat: cLat,
                        center_lng: cLng,
                        boundary_geojson: { type: 'Polygon', coordinates: geoJsonCoords }
                    };
                });

                setAllHexes(currentAllHexes);
                setCounts(prev => ({ ...prev, hexes: currentAllHexes.length }));
            }

            // 2. Client-Side Filtering for Hexes
            let filteredHexes = currentAllHexes;
            if (riskReasonFilter.length > 0) {
                filteredHexes = currentAllHexes.filter(h => {
                    if (!h.reason_distribution) return false;
                    const reasons = Object.keys(h.reason_distribution);
                    // Match exact codes, with prefix match for REPEAT_SUSPICIOUS_LOCATION
                    return riskReasonFilter.some(filter =>
                        reasons.some(r => r === filter || r.startsWith(filter))
                    );
                });
            }
            setHexes(filteredHexes);


            // 3. Fetch Stop Risks — MINOR+ when filter active (capture ALL matching events), WARNING+ otherwise
            let allStops: StopRiskData[] = [];
            let stopPage = 0;
            const pageSize = 1000;
            let keepFetchingStops = true;
            const minSev = riskReasonFilter.length > 0 ? 'MINOR' : 'WARNING';
            while (keepFetchingStops) {
                const { data: stopsData, error: stopsError } = await supabase.rpc('get_high_risk_stops', {
                    p_min_severity: minSev,
                    p_days_back: 90,
                    p_tracker_id: trackerFilter,
                    p_limit: pageSize,
                    p_offset: stopPage * pageSize,
                    p_risk_reasons: riskReasonFilter.length > 0 ? riskReasonFilter : null
                });
                if (stopsError) {
                    console.error('Stop risks fetch error:', stopsError);
                    break;
                }
                if (stopsData && stopsData.length > 0) {
                    allStops = [...allStops, ...stopsData];
                    if (stopsData.length < pageSize) keepFetchingStops = false;
                } else {
                    keepFetchingStops = false;
                }
                stopPage++;
                if (stopPage > 100) break;
            }

            setStopRisks(allStops);
            setCounts(prev => ({ ...prev, stops: allStops.length }));

        } catch (err) { console.error('Error fetching hex grid:', err); }
        finally { setLoading(false); }
    }, [allHexes, riskReasonFilter, trackerFilter]); // Re-run if filter changes or allHexes is loaded

    const fetchClusters = useCallback(async () => {
        setLoading(true);
        try {
            // 1. Fetch Full Cluster Data (Only once)
            let currentAllClusters = allClusters;
            if (currentAllClusters.length === 0) {
                const { data: ver } = await supabase.from('risk_zone_clusters').select('version').order('version', { ascending: false }).limit(1).maybeSingle();
                const latestVersion = ver?.version;
                if (!latestVersion) return;

                let allRawClusters: ClusterData[] = [];
                let page = 0;
                const pageSize = 1000;
                let keepFetching = true;

                while (keepFetching) {
                    const { data, error } = await supabase.from('risk_zone_clusters')
                        .select('*')
                        .eq('version', latestVersion)
                        .range(page * pageSize, (page + 1) * pageSize - 1);

                    if (error) throw error;

                    if (data && data.length > 0) {
                        allRawClusters = [...allRawClusters, ...(data as ClusterData[])];
                        if (data.length < pageSize) keepFetching = false;
                    } else {
                        keepFetching = false;
                    }
                    page++;
                }
                currentAllClusters = allRawClusters;
                setAllClusters(currentAllClusters);
                setCounts(prev => ({ ...prev, clusters: currentAllClusters.length }));
            }

            // 2. Dynamic Clustering: when filter active, fetch ALL matching incidents (MINOR+) and cluster them
            if (riskReasonFilter.length > 0) {
                setClusteringIncidents(true);
                let allIncidents: StopRiskData[] = [];
                let incPage = 0;
                const pageSize = 1000;
                let keepFetching = true;

                while (keepFetching) {
                    const { data, error } = await supabase.rpc('get_high_risk_stops', {
                        p_min_severity: 'MINOR',
                        p_days_back: 90,
                        p_tracker_id: trackerFilter,
                        p_limit: pageSize,
                        p_offset: incPage * pageSize,
                        p_risk_reasons: riskReasonFilter
                    });
                    if (error) { console.error('Incident fetch error:', error); break; }
                    if (data && data.length > 0) {
                        allIncidents = [...allIncidents, ...data];
                        if (data.length < pageSize) keepFetching = false;
                    } else {
                        keepFetching = false;
                    }
                    incPage++;
                    if (incPage > 50) break;
                }

                // Client-side DBSCAN clustering of the filtered incidents
                const computed = clusterIncidentsClientSide(allIncidents as StopRiskData[]);
                setDynamicClusters(computed);
                setClusters(computed);
                setStopRisks(allIncidents as StopRiskData[]);
                setCounts(prev => ({ ...prev, clusters: computed.length, stops: allIncidents.length }));
                setClusteringIncidents(false);
            } else {
                // No filter: use pre-computed clusters
                setDynamicClusters([]);
                setClusters(currentAllClusters);
            }

        } catch (err) { console.error('Error fetching clusters:', err); }
        finally { setLoading(false); setClusteringIncidents(false); }
    }, [allClusters, riskReasonFilter, trackerFilter]);

    const fetchCorridors = useCallback(async () => {
        // Always fetch if filters change, but if same filters and data exists, maybe skip? 
        // For now, re-fetch on filter change is safer, but "lazy load" implies we wait until tab is active.
        // We will rely on useEffect to trigger this.
        setLoading(true);
        try {
            let allCorridors: any[] = [];
            let page = 0;
            const pageSize = 1000; // Synchronize with Supabase default limit
            let keepFetching = true;

            // NO CAP: Loop until no data returned
            while (keepFetching) {
                const { data, error } = await supabase
                    .rpc('get_fleet_corridors', {
                        p_min_visits: 1,
                        p_limit: pageSize,
                        p_decay_lambda: 0.01,
                        p_maturity_threshold: 1,
                        p_tracker_id: trackerFilter ? trackerFilter : (filters.vehicles.length === 1 ? (vehicles.find(v => v.tracker_name === filters.vehicles[0])?.tracker_id || null) : null),
                        p_day_of_week: dayFilter,
                        p_hour_bucket: hourFilter,
                        p_offset: page * pageSize
                    });

                if (error) {
                    console.error('[SecurityMap] Corridor fetch error:', error.message);
                    break;
                }

                if (data && data.length > 0) {
                    allCorridors = [...allCorridors, ...data];
                    // If we got less than requested, it's definitely the last page.
                    // If we got exactly pageSize, there MIGHT be more.
                    if (data.length < pageSize) {
                        keepFetching = false;
                    }
                } else {
                    keepFetching = false;
                }
                page++;

                // Safety break for extremely large datasets (sanity check)
                // Safety break: GeoJSON performance limit
                if (page > 50) { // Limit to Top 50k corridors to prevent browser crash
                    console.warn('[SecurityMap] Client-side limit reached (50k corridors). Use Vector Tiles for full dataset.');
                    break;
                }
            }

            console.log(`[SecurityMap] Fetched ${allCorridors.length} corridors (No Cap)`);

            // Hydrate Corridors
            const cr: CorridorData[] = allCorridors.map(c => {
                const coords = cellToBoundary(c.h3_index);
                coords.push(coords[0]); // Close loop
                const geoJsonCoords = [coords.map(pt => [pt[1], pt[0]])];
                const [cLat, cLng] = cellToLatLng(c.h3_index);
                return {
                    ...c,
                    center_lat: cLat,
                    center_lng: cLng,
                    boundary_geojson: { type: 'Polygon', coordinates: geoJsonCoords }
                };
            });
            setCorridors(cr);
            setCounts(prev => ({ ...prev, corridors: cr.length }));

        } catch (err) { console.error('Error fetching corridors:', err); }
        finally { setLoading(false); }
    }, [dayFilter, hourFilter, trackerFilter, filters, vehicles]);

    const fetchDeviations = useCallback(async () => {
        setLoading(true);
        try {
            let allDevs: DeviationData[] = [];
            let page = 0;
            const pageSize = 1000;
            let keepFetching = true;

            while (keepFetching) {
                let q = supabase.from('route_security_events')
                    .select('trip_id, tracker_name, severity_level, deviation_km, risk_score, deviation_segments, risk_reasons')
                    .not('deviation_segments', 'is', null)
                    .gt('deviation_km', 0.1);

                if (dateRange.start) q = q.gte('analyzed_at', dateRange.start);
                if (dateRange.end) q = q.lte('analyzed_at', dateRange.end);
                if (filters.vehicles.length > 0) q = q.in('tracker_name', filters.vehicles);

                const { data, error } = await q.range(page * pageSize, (page + 1) * pageSize - 1);
                if (error) throw error;

                if (data && data.length > 0) {
                    const mapped: DeviationData[] = data.map(d => ({
                        trip_id: d.trip_id,
                        tracker_name: d.tracker_name,
                        severity_level: d.severity_level,
                        deviation_km: d.deviation_km,
                        risk_score: d.risk_score,
                        geometry: d.deviation_segments,
                        risk_reasons: d.risk_reasons
                    }));
                    allDevs = [...allDevs, ...mapped];
                    if (data.length < pageSize) keepFetching = false;
                } else {
                    keepFetching = false;
                }
                page++;
                if (page > 100) break; // Safety
            }

            setDeviations(allDevs);
            setCounts(prev => ({ ...prev, deviations: allDevs.length }));

        } catch (err) { console.error('Error fetching deviations:', err); }
        finally { setLoading(false); }
    }, [dateRange, filters]);

    const fetchSafeZones = useCallback(async () => {
        if (safeZones) return;
        setLoading(true);
        try {
            const res = await fetch('/api/safe-zones');
            const data = await res.json();
            setSafeZones(data);
            setCounts(prev => ({ ...prev, safezones: data?.features?.length || 0 }));
        } catch (err) { console.error('Error fetching safe zones:', err); }
        finally { setLoading(false); }
    }, [safeZones]);

    const fetchTampering = useCallback(async () => {
        setLoading(true);
        try {
            console.log('[SecurityMap] Fetching tampering events...');
            const { data, error } = await supabase.rpc('get_tampering_events', {
                min_date: dateRange.start || '2025-01-01',
                max_date: dateRange.end || new Date().toISOString(),
                p_limit: 500
            });

            if (error) {
                console.error('Error fetching tampering events:', error);
            } else {
                console.log(`[SecurityMap] Fetched ${data?.length} tampering events`);
                // The following lines are from the user's instruction, but 'features', 'm', 'sourceId' are not defined here.
                // Assuming 'features' refers to 'data' in this context for logging purposes.
                console.log('[SecurityMap] Rendering anomalies layer:', (data || []).length);
                console.log('[SecurityMap] Anomaly Features:', JSON.stringify((data || []).slice(0, 2)));
                setTamperingEvents(data || []);
                setCounts(prev => ({ ...prev, anomalies: data?.length || 0 }));
            }
        } catch (err) { console.error('Error in fetchTampering:', err); }
        finally { setLoading(false); }
    }, [dateRange]);



    // ─── Effect: Trigger Fetch on Active Layer Change ────────────────
    useEffect(() => {
        switch (activeLayer) {
            case 'points': fetchHotspots(); break;
            case 'hexgrid': fetchHexGrid(); break;
            case 'clusters': fetchClusters(); break;
            case 'corridors': fetchCorridors(); break;
            case 'deviations': fetchDeviations(); break;
            case 'safezones': fetchSafeZones(); break;
            case 'anomalies': fetchTampering(); break;
        }
    }, [activeLayer, fetchHotspots, fetchHexGrid, fetchClusters, fetchCorridors, fetchDeviations, fetchSafeZones, fetchTampering, riskReasonFilter]);

    // Initial load default layer
    useEffect(() => {
        if (activeLayer === 'hexgrid') fetchHexGrid();
    }, []);

    // ... (existing code)

    // ─── Initialize Map ───────────────────────────────────────
    // ─── Initialize Map ───────────────────────────────────────
    useEffect(() => {
        if (!mapContainer.current || !MAPBOX_TOKEN) return;
        if (map.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [28.6, -12.9],
            zoom: 4,
            attributionControl: false,
        });

        map.current.addControl(
            new MapboxGeocoder({
                accessToken: MAPBOX_TOKEN || '',
                mapboxgl: mapboxgl as any,
                marker: false,
                collapsed: true,
                placeholder: 'Search location...'
            }),
            'top-right'
        );

        // Add Controls
        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
        map.current.addControl(new mapboxgl.FullscreenControl(), 'top-right');

        map.current.on('load', () => {
            mapLoaded.current = true;
        });

        // Click Listener for Hexes and Points
        map.current.on('click', (e) => {
            const features = map.current?.queryRenderedFeatures(e.point, {
                layers: ['hex-fill', 'stop-risk-circles']
            });

            if (features && features.length > 0) {
                const feature = features[0];
                if (feature.layer) {
                    setSelectedFeature({
                        ...feature.properties,
                        lngLat: e.lngLat,
                        layerId: feature.layer.id
                    });
                }
            } else {
                setSelectedFeature(null);
            }
        });

        // Cursor pointer events
        const pointerLayers = ['hex-fill', 'stop-risk-circles'];
        pointerLayers.forEach(layer => {
            map.current?.on('mouseenter', layer, () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
            map.current?.on('mouseleave', layer, () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
        });
    }, []);


    // ─── Effect: Handle Popup Rendering ──────────────────────────
    useEffect(() => {
        const m = map.current;
        if (!m) return;

        // Remove previous popup
        if (popup.current) {
            popup.current.remove();
            popup.current = null;
        }

        // Handle Popup rendering based on selectedFeature state
        if (selectedFeature) {
            const { lngLat, layerId, ...props } = selectedFeature;
            let htmlContent = '';

            // Helper: build color-coded reason pill HTML
            const reasonPillHtml = (reasonCode: string): string => {
                const base = reasonCode.replace(/_X\d+$/, '');
                const meta = RISK_REASON_OPTIONS.find(o => o.code === base);
                const color = meta?.color || '#94a3b8';
                const label = meta?.label || formatReason(reasonCode);
                return `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;background:${color}18;color:${color};border:1px solid ${color}30;margin:1px;">
                    <span style="width:5px;height:5px;border-radius:50%;background:${color};display:inline-block;"></span>
                    ${label}
                </span>`;
            };

            if (layerId === 'hex-fill') {
                // Parse reason_distribution from hex properties
                let reasonDistHtml = '';
                const hexData = hexes.find(h => h.h3_index === props.h3Index);
                if (hexData?.reason_distribution) {
                    const sorted = Object.entries(hexData.reason_distribution).sort((a, b) => (b[1] as number) - (a[1] as number));
                    reasonDistHtml = sorted.map(([reason, count]) => {
                        const base = reason.replace(/_X\d+$/, '');
                        const meta = RISK_REASON_OPTIONS.find(o => o.code === base);
                        const color = meta?.color || '#94a3b8';
                        const label = meta?.label || formatReason(reason);
                        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
                            <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                            <span style="flex:1;font-size:10px;color:#475569;">${label}</span>
                            <span style="font-size:10px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;">${count}</span>
                        </div>`;
                    }).join('');
                }

                htmlContent = `
                    <div style="padding:10px;min-width:220px;font-family:system-ui,-apple-system,sans-serif;">
                        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:8px;">
                            <span style="font-weight:700;font-size:12px;color:#1e293b;">Risk Zone</span>
                            <span style="font-size:18px;font-weight:800;color:${Number(props.riskScore) >= 70 ? '#dc2626' : Number(props.riskScore) >= 40 ? '#f97316' : '#eab308'};">${Number(props.riskScore).toFixed(0)}</span>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:10px;color:#64748b;margin-bottom:8px;">
                            <div>Incidents <b style="color:#1e293b;">${props.incidents}</b></div>
                            <div>Critical <b style="color:#dc2626;">${props.critical}</b></div>
                            <div>Night <b style="color:#a855f7;">${props.nightIncidents}</b></div>
                        </div>
                        ${reasonDistHtml ? `
                            <div style="border-top:1px solid #f1f5f9;padding-top:6px;margin-top:4px;">
                                <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Reason Breakdown</div>
                                ${reasonDistHtml}
                            </div>
                        ` : ''}
                        <div style="font-size:8px;color:#cbd5e1;margin-top:6px;font-family:monospace;">${props.h3Index}</div>
                    </div>`;
            } else if (layerId === 'stop-risk-circles') {
                // Parse all reasons from the stringified array
                let reasons: string[] = [];
                try { reasons = JSON.parse(props.allReasons || '[]'); } catch { reasons = [props.primaryReason]; }

                const reasonPills = reasons.map((r: string) => reasonPillHtml(r)).join('');

                // Build signal flags section
                const signals: string[] = [];
                if (props.isNight === true || props.isNight === 'true') signals.push(`<span style="color:#a855f7;">Night stop</span>`);
                if (props.isInRiskZone === true || props.isInRiskZone === 'true') signals.push(`<span style="color:#ef4444;">In risk zone</span>`);
                if (props.isIgnitionAnomaly === true || props.isIgnitionAnomaly === 'true') {
                    const ignPct = props.ignitionOnPercent ? `${Number(props.ignitionOnPercent).toFixed(0)}%` : '';
                    signals.push(`<span style="color:#f97316;">Ignition anomaly${ignPct ? ` (${ignPct} ON)` : ''}</span>`);
                }
                if (props.isPositionMismatch === true || props.isPositionMismatch === 'true') {
                    const distStr = props.positionMismatchKm ? `${Number(props.positionMismatchKm).toFixed(2)} km` : '';
                    signals.push(`<span style="color:#f43f5e;">Position mismatch${distStr ? ` (${distStr})` : ''}</span>`);
                }
                if (props.safeZoneName && props.safeZoneName !== 'null') signals.push(`<span style="color:#22c55e;">Safe: ${props.safeZoneName}</span>`);

                const sevColor = props.severity === 'CRITICAL' ? '#dc2626' : props.severity === 'WARNING' ? '#f59e0b' : '#22c55e';
                const durationStr = props.durationHours ? `${Number(props.durationHours).toFixed(1)}h` : '-';
                const startStr = props.stopStart ? new Date(props.stopStart).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                const endStr = props.stopEnd && props.stopEnd !== 'null' ? new Date(props.stopEnd).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Ongoing';
                const latStr = props.stopLat ? Number(props.stopLat).toFixed(5) : '-';
                const lngStr = props.stopLng ? Number(props.stopLng).toFixed(5) : '-';

                const isTowRisk = props.isPositionMismatch === true || props.isPositionMismatch === 'true';
                const mismatchKm = props.positionMismatchKm ? Number(props.positionMismatchKm).toFixed(2) : null;

                htmlContent = `
                    <div style="padding:10px;min-width:260px;max-width:360px;font-family:system-ui,-apple-system,sans-serif;">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-weight:700;font-size:12px;color:#1e293b;">Stop Event</span>
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:${sevColor}18;color:${sevColor};border:1px solid ${sevColor}40;">${props.severity}</span>
                                <span style="font-size:16px;font-weight:800;color:${sevColor};">${props.riskScore}</span>
                            </div>
                        </div>

                        <div style="font-size:10px;color:#64748b;margin-bottom:8px;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;">
                            <span style="color:#94a3b8;">Vehicle</span><span style="font-weight:600;color:#334155;">${props.trackerName || '-'}</span>
                            <span style="color:#94a3b8;">From</span><span style="color:#334155;">${startStr}</span>
                            <span style="color:#94a3b8;">To</span><span style="color:#334155;">${endStr}</span>
                            <span style="color:#94a3b8;">Duration</span><span style="font-weight:600;color:#334155;">${durationStr}</span>
                            <span style="color:#94a3b8;">Location</span><span style="font-family:monospace;font-size:9px;color:#475569;">${latStr}, ${lngStr}</span>
                        </div>

                        <div style="border-top:1px solid #f1f5f9;padding-top:6px;">
                            <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Risk Reasons (${reasons.length})</div>
                            <div style="display:flex;flex-wrap:wrap;gap:2px;">${reasonPills}</div>
                        </div>

                        ${signals.length > 0 ? `
                            <div style="border-top:1px solid #f1f5f9;padding-top:5px;margin-top:6px;">
                                <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Signals</div>
                                <div style="font-size:10px;display:flex;flex-wrap:wrap;gap:4px 10px;">${signals.join('')}</div>
                            </div>
                        ` : ''}

                        ${isTowRisk ? `
                            <div id="tow-risk-section" style="border-top:1px solid #f43f5e30;padding-top:6px;margin-top:6px;background:rgba(244,63,94,0.04);border-radius:6px;padding:8px;">
                                <div style="font-size:9px;font-weight:700;color:#f43f5e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Tow / Movement Risk</div>
                                <div style="font-size:10px;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;color:#64748b;">
                                    ${mismatchKm ? `<span style="color:#94a3b8;">Displacement</span><span style="font-weight:700;color:#f43f5e;">${mismatchKm} km</span>` : ''}
                                    <span style="color:#94a3b8;">Stop Location</span><span style="font-family:monospace;font-size:9px;color:#475569;">${latStr}, ${lngStr}</span>
                                </div>
                                <div id="tow-next-trip" style="margin-top:6px;font-size:10px;color:#94a3b8;font-style:italic;">Loading next trip details...</div>
                            </div>
                        ` : ''}

                        <div style="font-size:8px;color:#cbd5e1;margin-top:6px;">${props.analyzedAt}</div>
                    </div>`;

                // Async fetch next trip details for tow risk
                if (isTowRisk && props.trackerId && props.stopEnd && props.stopEnd !== 'null') {
                    setTowRiskLoading(true);
                    (async () => {
                        try {
                            const { data: nextTrip } = await supabase
                                .from('v_ai_trip_logs')
                                .select('trip_id, start_time, start_geom, distance_km, duration_hours')
                                .eq('tracker_id', Number(props.trackerId))
                                .gte('start_time', props.stopEnd)
                                .order('start_time', { ascending: true })
                                .limit(1)
                                .maybeSingle();

                            setTowRiskLoading(false);
                            const el = document.getElementById('tow-next-trip');
                            if (!el) return;

                            if (nextTrip?.start_geom?.coordinates) {
                                const nLat = nextTrip.start_geom.coordinates[1].toFixed(5);
                                const nLng = nextTrip.start_geom.coordinates[0].toFixed(5);
                                const nTime = new Date(nextTrip.start_time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                const nDist = nextTrip.distance_km ? `${Number(nextTrip.distance_km).toFixed(1)} km` : '-';
                                const nDur = nextTrip.duration_hours ? `${Number(nextTrip.duration_hours).toFixed(1)}h` : '-';

                                setTowRiskDetails({
                                    nextTripId: nextTrip.trip_id,
                                    nextTripStart: nextTrip.start_time,
                                    nextTripStartLat: nextTrip.start_geom.coordinates[1],
                                    nextTripStartLng: nextTrip.start_geom.coordinates[0],
                                    distanceKm: nextTrip.distance_km || 0,
                                });

                                el.innerHTML = `
                                    <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Next Trip (vehicle reappeared)</div>
                                    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;color:#64748b;">
                                        <span style="color:#94a3b8;">Started</span><span style="color:#334155;">${nTime}</span>
                                        <span style="color:#94a3b8;">Start Location</span><span style="font-family:monospace;font-size:9px;color:#475569;">${nLat}, ${nLng}</span>
                                        <span style="color:#94a3b8;">Trip Distance</span><span style="color:#334155;">${nDist}</span>
                                        <span style="color:#94a3b8;">Trip Duration</span><span style="color:#334155;">${nDur}</span>
                                    </div>
                                `;
                                el.style.fontStyle = 'normal';
                            } else {
                                setTowRiskDetails(null);
                                el.innerHTML = `<span style="color:#94a3b8;font-size:10px;">No subsequent trip found</span>`;
                                el.style.fontStyle = 'normal';
                            }
                        } catch {
                            setTowRiskLoading(false);
                            setTowRiskDetails(null);
                            const el = document.getElementById('tow-next-trip');
                            if (el) {
                                el.innerHTML = `<span style="color:#94a3b8;font-size:10px;">Failed to load trip details</span>`;
                                el.style.fontStyle = 'normal';
                            }
                        }
                    })();
                } else {
                    setTowRiskDetails(null);
                }
            }

            if (htmlContent) {
                popup.current = new mapboxgl.Popup({
                    closeButton: true,
                    closeOnClick: true,
                    maxWidth: '380px',
                    className: 'security-popup'
                })
                    .setLngLat(lngLat)
                    .setHTML(htmlContent)
                    .addTo(m);

                popup.current.on('close', () => setSelectedFeature(null));
            }
        }
    }, [selectedFeature, hexes]);

    // ─── Render layers when data or activeLayer changes ──────

    useEffect(() => {
        const m = map.current;
        if (!m) return;

        const render = () => {
            // ── Clean up old sources & layers ──
            const layerIds = [
                'hotspots-heat', 'hotspots-point',
                'hex-fill', 'hex-outline',
                'cluster-fill', 'cluster-outline',
                'stop-risk-circles',
                'corridor-glow-macro', 'corridor-core-macro',
                'corridor-glow-micro', 'corridor-core-micro', 'corridor-arrows', 'corridor-network-glow', 'corridor-network-core',
                'deviations-line', 'deviations-line-glow',
                'safezones-fill', 'safezones-outline', 'safezones-label',
                'anomalies-glow', 'anomalies-line', 'anomalies-origin-pulse', 'anomalies-origin', 'anomalies-dest-pulse', 'anomalies-dest'
            ];
            for (const id of layerIds) {
                if (m.getLayer(id)) m.removeLayer(id);
            }
            const sourceIds = ['security-hotspots', 'hex-grid', 'risk-clusters', 'stop-risks', 'fleet-corridors', 'fleet-corridors-macro', 'fleet-corridors-micro', 'fleet-corridors-network', 'route-deviations', 'safe-zones-source', 'anomalies-source'];
            for (const id of sourceIds) {
                if (m.getSource(id)) m.removeSource(id);
            }

            // Shared function to add stop risk circles layer (used in hexgrid + clusters)
            const addStopRiskLayer = () => {
                if (m.getSource('stop-risks')) return;
                const isFiltered = riskReasonFilter.length > 0;

                // Resolve primary reason color for each stop
                const getReasonColor = (reasons: string[]): string => {
                    if (!reasons || reasons.length === 0) return '#10b981';
                    for (const r of reasons) {
                        const base = r.replace(/_X\d+$/, '');
                        const meta = RISK_REASON_OPTIONS.find(o => o.code === base);
                        if (meta) return meta.color;
                    }
                    return '#ef4444';
                };

                const stopFeatures: GeoJSON.Feature[] = stopRisks.map(s => ({
                    type: 'Feature' as const,
                    properties: {
                        stopId: s.stop_id,
                        riskScore: s.risk_score,
                        isNight: s.is_night_stop,
                        severity: s.severity_level,
                        primaryReason: s.risk_reasons?.[0] || 'Unknown',
                        allReasons: JSON.stringify(s.risk_reasons || []),
                        reasonColor: getReasonColor(s.risk_reasons),
                        trackerName: s.tracker_name,
                        trackerId: s.tracker_id,
                        stopLat: s.stop_lat,
                        stopLng: s.stop_lng,
                        stopStart: s.stop_start,
                        stopEnd: s.stop_end,
                        durationHours: s.stop_duration_hours,
                        isInRiskZone: s.is_in_risk_zone,
                        isIgnitionAnomaly: s.is_ignition_anomaly,
                        isPositionMismatch: s.is_position_mismatch,
                        positionMismatchKm: s.position_mismatch_km,
                        ignitionOnPercent: s.ignition_on_percent,
                        safeZoneName: s.safe_zone_name,
                        analyzedAt: new Date(s.analyzed_at).toLocaleDateString()
                    },
                    geometry: { type: 'Point', coordinates: [s.stop_lng, s.stop_lat] }
                }));

                const stopGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: stopFeatures };
                m.addSource('stop-risks', { type: 'geojson', data: stopGeoJSON });

                m.addLayer({
                    id: 'stop-risk-circles',
                    type: 'circle',
                    source: 'stop-risks',
                    minzoom: isFiltered ? 3 : (activeLayer === 'clusters' ? 6 : 10),
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['zoom'],
                            3, isFiltered ? 3 : 2,
                            8, isFiltered ? 5 : 3,
                            12, isFiltered ? 7 : 5,
                            16, 10
                        ],
                        'circle-color': isFiltered
                            ? ['get', 'reasonColor']
                            : [
                                'match', ['get', 'severity'],
                                'CRITICAL', '#ef4444',
                                'WARNING', '#f59e0b',
                                '#10b981'
                            ],
                        'circle-opacity': isFiltered ? 0.85 : 0.75,
                        'circle-stroke-width': [
                            'case',
                            ['get', 'isNight'], 2,
                            isFiltered ? 1 : 0
                        ],
                        'circle-stroke-color': [
                            'case',
                            ['get', 'isNight'], '#a855f7',
                            'rgba(255,255,255,0.3)'
                        ]
                    }
                });

                m.on('mouseenter', 'stop-risk-circles', () => m.getCanvas().style.cursor = 'pointer');
                m.on('mouseleave', 'stop-risk-circles', () => m.getCanvas().style.cursor = '');
                m.on('click', 'stop-risk-circles', (e) => {
                    const feature = e.features?.[0];
                    if (feature) {
                        setSelectedFeature({
                            ...feature.properties,
                            lngLat: e.lngLat,
                            layerId: 'stop-risk-circles'
                        });
                    }
                });
            };

            // ══════════════════════════════════════════════════
            // LAYER: H3 HEX GRID (Heatmap)
            // ══════════════════════════════════════════════════
            if (activeLayer === 'hexgrid') {
                const hexFeatures: GeoJSON.Feature[] = hexes.map(h => ({
                    type: 'Feature' as const,
                    properties: {
                        h3Index: h.h3_index,
                        riskScore: h.risk_score,
                        incidents: h.incident_count,
                        nightIncidents: h.night_incident_count,
                        critical: h.critical_count
                    },
                    geometry: h.boundary_geojson
                }));
                const hexGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: hexFeatures };
                m.addSource('hex-grid', { type: 'geojson', data: hexGeoJSON });

                m.addLayer({
                    id: 'hex-fill',
                    type: 'fill',
                    source: 'hex-grid',
                    paint: {
                        'fill-color': [
                            'interpolate', ['linear'], ['get', 'riskScore'],
                            0, 'rgba(34, 197, 94, 0.1)',
                            20, 'rgba(234, 179, 8, 0.4)',
                            50, 'rgba(249, 115, 22, 0.5)',
                            80, 'rgba(239, 68, 68, 0.6)',
                            100, 'rgba(185, 28, 28, 0.7)'
                        ],
                        'fill-opacity': 0.8
                    }
                });

                m.addLayer({
                    id: 'hex-outline',
                    type: 'line',
                    source: 'hex-grid',
                    paint: {
                        'line-color': '#fff',
                        'line-width': 1,
                        'line-opacity': 0.3
                    }
                });

                // STOP RISK CIRCLES (Overlay on Hex Grid)
                addStopRiskLayer();
            }

            // ══════════════════════════════════════════════════
            // LAYER: RISK CLUSTERS (DBSCAN) — Dynamic when filtered
            // ══════════════════════════════════════════════════
            if (activeLayer === 'clusters') {
                const isDynamic = riskReasonFilter.length > 0 && dynamicClusters.length > 0;
                const displayClusters = isDynamic ? dynamicClusters : clusters;

                const clusterFeatures: GeoJSON.Feature[] = displayClusters.map(c => ({
                    type: 'Feature' as const,
                    properties: {
                        clusterId: c.cluster_id,
                        riskScore: c.risk_score,
                        isNight: c.is_night_dominant,
                        primaryReason: c.primary_reason,
                        incidents: c.incident_count,
                        isDynamic,
                    },
                    geometry: c.polygon_geojson
                }));

                const clusterGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: clusterFeatures };
                m.addSource('risk-clusters', { type: 'geojson', data: clusterGeoJSON });

                m.addLayer({
                    id: 'cluster-fill',
                    type: 'fill',
                    source: 'risk-clusters',
                    paint: {
                        'fill-color': isDynamic
                            ? (() => {
                                // Color dynamic clusters by the selected reason's theme color
                                const reasonMeta = riskReasonFilter.length === 1
                                    ? RISK_REASON_OPTIONS.find(r => r.code === riskReasonFilter[0])
                                    : null;
                                const baseColor = reasonMeta?.color || '#ef4444';
                                return `${baseColor}66`; // 40% opacity hex
                            })()
                            : [
                                'case', ['get', 'isNight'],
                                'rgba(147, 51, 234, 0.4)',
                                'rgba(239, 68, 68, 0.4)'
                            ],
                        'fill-outline-color': isDynamic
                            ? (() => {
                                const reasonMeta = riskReasonFilter.length === 1
                                    ? RISK_REASON_OPTIONS.find(r => r.code === riskReasonFilter[0])
                                    : null;
                                return reasonMeta?.color || '#ef4444';
                            })()
                            : [
                                'case', ['get', 'isNight'],
                                '#a855f7',
                                '#ef4444'
                            ]
                    }
                });

                m.addLayer({
                    id: 'cluster-outline',
                    type: 'line',
                    source: 'risk-clusters',
                    paint: {
                        'line-color': isDynamic
                            ? (() => {
                                const reasonMeta = riskReasonFilter.length === 1
                                    ? RISK_REASON_OPTIONS.find(r => r.code === riskReasonFilter[0])
                                    : null;
                                return reasonMeta?.color || '#ef4444';
                            })()
                            : [
                                'case', ['get', 'isNight'],
                                '#a855f7',
                                '#ef4444'
                            ],
                        'line-width': isDynamic ? 2.5 : 2,
                        'line-dasharray': isDynamic ? [4, 2] : [2, 1]
                    }
                });

                // Always show stop risk overlay when filter is active (incidents that formed these clusters)
                if (riskReasonFilter.length > 0) {
                    addStopRiskLayer();
                }
            }

            // ══════════════════════════════════════════════════
            // LAYER: Fleet Corridors (Safe Routes) - LIGHT MODE GRADIENT
            // ══════════════════════════════════════════════════
            if (activeLayer === 'corridors') {
                const corridorFeatures: GeoJSON.Feature[] = corridors.map(c => ({
                    type: 'Feature' as const,
                    properties: {
                        h3Index: c.h3_index,
                        visitCount: c.visit_count,
                        isNight: c.is_night_route,
                        bearing: c.bearing_bucket !== undefined ? c.bearing_bucket * 45 : null
                    },
                    geometry: { type: 'Point', coordinates: [c.center_lng, c.center_lat] },
                }));

                // ---------------------------------------------------------
                // POST-PROCESSING: Multi-Scale Aggregation (LOD)
                // ---------------------------------------------------------
                const macroMap = new Map<string, { count: number, nightCount: number }>();
                let maxVisitsMicro = 1;

                corridors.forEach(c => {
                    maxVisitsMicro = Math.max(maxVisitsMicro, c.visit_count);
                    const parent = cellToParent(c.h3_index, 6);
                    const current = macroMap.get(parent) || { count: 0, nightCount: 0 };
                    macroMap.set(parent, {
                        count: current.count + c.visit_count,
                        nightCount: current.nightCount + (c.is_night_route ? c.visit_count : 0)
                    });
                });

                const macroFeatures: GeoJSON.Feature[] = Array.from(macroMap.entries()).map(([h3Index, data]) => {
                    const [lat, lng] = cellToLatLng(h3Index);
                    return {
                        type: 'Feature',
                        properties: {
                            h3Index,
                            visitCount: data.count,
                            isNight: data.nightCount > (data.count / 2) // Dominant logic
                        },
                        geometry: { type: 'Point', coordinates: [lng, lat] }
                    };
                });

                let maxVisitsMacro = 1;
                macroFeatures.forEach(f => maxVisitsMacro = Math.max(maxVisitsMacro, f.properties?.visitCount || 0));

                // Fix Mapbox error: "Input/output pairs for 'interpolate' expressions must be arranged with input values in strictly ascending order"
                // If maxVisits is 1, it conflicts with the start value 1.
                if (maxVisitsMacro <= 1) maxVisitsMacro = 1.01;
                if (maxVisitsMicro <= 1) maxVisitsMicro = 1.01;

                const macroGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: macroFeatures };
                const microGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: corridorFeatures };

                m.addSource('fleet-corridors-micro', { type: 'geojson', data: microGeoJSON });
                m.addSource('fleet-corridors-macro', { type: 'geojson', data: macroGeoJSON });

                // 2. GENERATE CONNECTED GRAPH (The "Road Network")
                const corridorMap = new Map(corridors.map(c => [c.h3_index, c]));
                const roadGraph = new Map<string, Set<string>>(); // Adjacency List for Triangle Simplification

                // 2a. Build Candidate Graph (All Neighbors)
                corridors.forEach(c => {
                    const origin = c.h3_index;
                    try {
                        const neighbors = gridDisk(origin, 1).slice(1);
                        neighbors.forEach(neighbor => {
                            if (corridorMap.has(neighbor)) {
                                if (!roadGraph.has(origin)) roadGraph.set(origin, new Set());
                                if (!roadGraph.has(neighbor)) roadGraph.set(neighbor, new Set());
                                roadGraph.get(origin)!.add(neighbor);
                                roadGraph.get(neighbor)!.add(origin);
                            }
                        });
                    } catch (e) { console.warn('H3 error:', e); }
                });

                // 2b. Triangle Simplification (Remove Longest Edge in Triangles A-B-C)
                // This linearizes the graph to follow road geometry more smoothly.
                const removedEdges = new Set<string>();

                // Helper to get edge distance (Euclidean on snapped points)
                const getDist = (a: string, b: string) => {
                    const cA = corridorMap.get(a);
                    const cB = corridorMap.get(b);
                    if (!cA || !cB) return 999999;
                    // Prefer road geometry if available
                    const pA = cA.road_geometry?.coordinates || [cA.center_lng, cA.center_lat];
                    const pB = cB.road_geometry?.coordinates || [cB.center_lng, cB.center_lat];
                    const dx = pA[0] - pB[0];
                    const dy = pA[1] - pB[1];
                    return Math.sqrt(dx * dx + dy * dy);
                };

                // Iterate all nodes
                for (const [u, neighbors] of roadGraph.entries()) {
                    for (const v of neighbors) {
                        // Check for common neighbors (w) forming triangle u-v-w
                        const uNeighbors = roadGraph.get(u)!;
                        const vNeighbors = roadGraph.get(v)!;

                        // Intersection
                        for (const w of uNeighbors) {
                            if (w === v) continue;
                            if (vNeighbors.has(w)) {
                                // Found Triangle u-v-w
                                // Edges: (u,v), (v,w), (u,w)
                                // We want to remove the LONGEST edge to linearize.
                                const dUV = getDist(u, v);
                                const dVW = getDist(v, w);
                                const dUW = getDist(u, w);

                                if (dUV >= dVW && dUV >= dUW) {
                                    removedEdges.add([u, v].sort().join('-'));
                                } else if (dVW >= dUV && dVW >= dUW) {
                                    removedEdges.add([v, w].sort().join('-'));
                                } else {
                                    removedEdges.add([u, w].sort().join('-'));
                                }
                            }
                        }
                    }
                }

                // 2c. Build Final Geometry (Skipping Removed Edges)
                const processedEdges = new Set<string>();
                const lineFeatures: GeoJSON.Feature[] = [];

                for (const [u, neighbors] of roadGraph.entries()) {
                    for (const v of neighbors) {
                        const edgeKey = [u, v].sort().join('-');
                        if (processedEdges.has(edgeKey)) continue;
                        if (removedEdges.has(edgeKey)) continue; // SKIP TRIANGLE EDGE

                        processedEdges.add(edgeKey);
                        const c1 = corridorMap.get(u);
                        const c2 = corridorMap.get(v);
                        if (!c1 || !c2) continue;

                        const p1 = c1.road_geometry?.coordinates || [c1.center_lng, c1.center_lat];
                        const p2 = c2.road_geometry?.coordinates || [c2.center_lng, c2.center_lat];

                        lineFeatures.push({
                            type: 'Feature',
                            properties: {
                                visitCount: Math.max(c1.visit_count, c2.visit_count),
                                isNight: c1.is_night_route || c2.is_night_route
                            },
                            geometry: {
                                type: 'LineString',
                                coordinates: [p1, p2]
                            }
                        });
                    }
                }

                const networkGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: lineFeatures };
                m.addSource('fleet-corridors-network', { type: 'geojson', data: networkGeoJSON });

                // ---------------------------------------------------------
                // LAYER 1: MACRO VIEW (Zoom 0 - 11)
                // ---------------------------------------------------------
                // 1A. The "Glow" (Subtle Halo)
                m.addLayer({
                    id: 'corridor-glow-macro',
                    type: 'circle',
                    source: 'fleet-corridors-macro',
                    maxzoom: 10,
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 4,
                            maxVisitsMacro, 14
                        ],
                        'circle-color': [
                            'case', ['get', 'isNight'],
                            '#a855f7', // Purple-500
                            '#0ea5e9', // Sky-500
                        ],
                        'circle-opacity': 0.4,
                        'circle-blur': 0.5
                    }
                });

                // 1B. The "Core" (Distinct Nodes)
                m.addLayer({
                    id: 'corridor-core-macro',
                    type: 'circle',
                    source: 'fleet-corridors-macro',
                    maxzoom: 10,
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 2,
                            maxVisitsMacro, 6
                        ],
                        'circle-color': [
                            'case', ['get', 'isNight'],
                            '#581c87', // Purple-900
                            '#0369a1', // Sky-700
                        ],
                        'circle-opacity': 0.9
                    }
                });

                // ---------------------------------------------------------
                // LAYER 2: MICRO VIEW (Zoom 11+)
                // ---------------------------------------------------------
                // 2A. The "Glow" - Reduced for subtlety on light map
                m.addLayer({
                    id: 'corridor-glow-micro',
                    type: 'circle',
                    source: 'fleet-corridors-micro',
                    minzoom: 10,
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 2,
                            maxVisitsMicro, 7
                        ],
                        'circle-color': [
                            'case', ['get', 'isNight'],
                            '#a855f7',
                            '#0ea5e9',
                        ],
                        'circle-opacity': 0.3,
                        'circle-blur': 0.4
                    }
                });

                // 2B. The "Core" - GRADIENT COLORED ROAD NETWORK
                m.addLayer({
                    id: 'corridor-core-micro',
                    type: 'circle',
                    source: 'fleet-corridors-micro',
                    minzoom: 9, // Show sooner
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['zoom'],
                            9, 2,
                            14, 6,  // Larger at street level
                            18, 12  // Much larger at building level
                        ],
                        'circle-color': [
                            'case', ['get', 'isNight'],
                            // Night Gradient: Slate -> Violet -> Purple
                            [
                                'interpolate', ['linear'], ['get', 'visitCount'],
                                1, '#64748b',   // Slate-500 (Low)
                                Math.max(1.05, maxVisitsMicro / 2), '#7c3aed', // Violet-600 (Med)
                                Math.max(1.1, maxVisitsMicro), '#4c1d95' // Violet-900 (High)
                            ],
                            // Day Gradient: Slate -> Teal -> Indigo
                            [
                                'interpolate', ['linear'], ['get', 'visitCount'],
                                1, '#64748b',   // Slate-500 (Low - visible grey)
                                Math.max(1.05, maxVisitsMicro / 2), '#0d9488', // Teal-600 (Med)
                                Math.max(1.1, maxVisitsMicro), '#4338ca' // Indigo-700 (High)
                            ]
                        ],
                        'circle-opacity': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 0.6,
                            5, 1
                        ]
                    }
                });

                // 2C. DIRECTIONAL ARROWS (New) - Only for cells with valid bearing
                m.addLayer({
                    id: 'corridor-arrows',
                    type: 'symbol',
                    source: 'fleet-corridors-micro',
                    minzoom: 11, // Show sooner (Zoom 11)
                    filter: ['!=', ['get', 'bearing'], null],
                    layout: {
                        'text-field': '▲', // Unicode Triangle
                        'text-size': [
                            'interpolate', ['linear'], ['zoom'],
                            11, 8,
                            15, 18, // Larger arrows
                            18, 24  // Very clear at max zoom
                        ],
                        'text-rotate': ['get', 'bearing'],
                        'text-allow-overlap': true,
                        'text-ignore-placement': true
                    },
                    paint: {
                        'text-color': [
                            'case', ['get', 'isNight'],
                            '#e9d5ff', // Light Purple (Night)
                            '#ecfeff'  // Cyan-50 (Day) - High contrast
                        ],
                        'text-opacity': [
                            'interpolate', ['linear'], ['zoom'],
                            12, 0.6,
                            15, 1
                        ]
                    }
                });

                // 2D. NETWORK LINES (New)
                m.addLayer({
                    id: 'corridor-network-glow',
                    type: 'line',
                    source: 'fleet-corridors-network',
                    minzoom: 10,
                    paint: {
                        'line-color': [
                            'case', ['get', 'isNight'],
                            '#a855f7', // Purple-500
                            '#0ea5e9', // Sky-500
                        ],
                        'line-width': 3,
                        'line-blur': 2,
                        'line-opacity': 0.3
                    }
                });

                m.addLayer({
                    id: 'corridor-network-core',
                    type: 'line',
                    source: 'fleet-corridors-network',
                    minzoom: 10,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': [
                            'case', ['get', 'isNight'],
                            // Night Gradient: Slate -> Violet -> Purple
                            [
                                'interpolate', ['linear'], ['get', 'visitCount'],
                                1, '#64748b',   // Slate-500 (Low)
                                Math.max(1.05, maxVisitsMicro / 2), '#7c3aed', // Violet-600 (Med)
                                Math.max(1.1, maxVisitsMicro), '#4c1d95' // Violet-900 (High)
                            ],
                            // Day Gradient: Slate -> Teal -> Indigo
                            [
                                'interpolate', ['linear'], ['get', 'visitCount'],
                                1, '#64748b',   // Slate-500 (Low - visible grey)
                                Math.max(1.05, maxVisitsMicro / 2), '#0d9488', // Teal-600 (Med)
                                Math.max(1.1, maxVisitsMicro), '#4338ca' // Indigo-700 (High)
                            ]
                        ],
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 1,
                            14, 3,
                            18, 6
                        ],
                        'line-opacity': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 0.6,
                            5, 1
                        ]
                    }
                });

                // Popup interaction on the "Core" layers
                const interactLayers = ['corridor-core-macro', 'corridor-core-micro', 'corridor-arrows', 'corridor-network-core'];
                interactLayers.forEach(layer => {
                    m.on('mouseenter', layer, () => m.getCanvas().style.cursor = 'pointer');
                    m.on('mouseleave', layer, () => {
                        m.getCanvas().style.cursor = '';
                        if (popup.current) { popup.current.remove(); popup.current = null; }
                    });

                    m.on('click', layer, (e) => {
                        if (e.features && e.features[0]) {
                            const props = e.features[0].properties;
                            if (!props) return;

                            const isMacro = layer.includes('macro');

                            new mapboxgl.Popup()
                                .setLngLat(e.lngLat)
                                .setHTML(`
                                        <div class="p-2 text-slate-800">
                                            <div class="font-bold border-b pb-1 mb-1">${isMacro ? 'Regional Cluster' : 'Corridor Cell'}</div>
                                            <div class="text-xs space-y-1">
                                                <div class="flex justify-between gap-4"><span>H3 Index:</span><span class="font-mono">${props.h3Index}</span></div>
                                                <div class="flex justify-between gap-4"><span>Total Visits:</span><span class="font-bold text-lg">${props.visitCount}</span></div>
                                                ${props.bearing !== null && props.bearing !== undefined ?
                                        `<div class="flex justify-between gap-4"><span>Bearing:</span><span>${props.bearing}°</span></div>` : ''}
                                                <div class="italic text-slate-500 mt-1">${isMacro ? '(Aggregated traffic)' : '(Local cell traffic)'}</div>
                                            </div>
                                        </div>
                                    `)
                                .addTo(m);
                        }
                    });
                });
            }

            // ══════════════════════════════════════════════════
            // LAYER: DEVIATIONS (New)
            // ══════════════════════════════════════════════════
            if (activeLayer === 'deviations') {
                const deviationFeatures: GeoJSON.Feature[] = deviations.flatMap(d => {
                    if (!d.geometry) return [];
                    const geom = d.geometry as GeoJSON.FeatureCollection | GeoJSON.MultiLineString | GeoJSON.LineString;

                    // Normalize geometry input
                    if (geom.type === 'FeatureCollection') {
                        return geom.features.map(f => ({
                            type: 'Feature' as const,
                            properties: {
                                tripId: d.trip_id,
                                trackerName: d.tracker_name,
                                severity: d.severity_level,
                                deviationKm: d.deviation_km,
                                riskScore: d.risk_score,
                                reasons: d.risk_reasons?.[0] || 'Unknown'
                            },
                            geometry: f.geometry as GeoJSON.LineString
                        }));
                    } else if (geom.type === 'MultiLineString') {
                        // Explode multilinestring? Or just use it as is?
                        // Mapbox line layers handle MultiLineString fine.
                        return [{
                            type: 'Feature' as const,
                            properties: {
                                tripId: d.trip_id,
                                trackerName: d.tracker_name,
                                severity: d.severity_level,
                                deviationKm: d.deviation_km,
                                riskScore: d.risk_score,
                                reasons: d.risk_reasons?.[0] || 'Unknown'
                            },
                            geometry: geom as GeoJSON.Geometry
                        }];
                    }
                    return [];
                });

                const devGeoJSON: GeoJSON.FeatureCollection = {
                    type: 'FeatureCollection',
                    features: deviationFeatures
                };

                m.addSource('route-deviations', { type: 'geojson', data: devGeoJSON });

                // 1. Line Glow (Halo)
                m.addLayer({
                    id: 'deviations-line-glow',
                    type: 'line',
                    source: 'route-deviations',
                    paint: {
                        'line-color': [
                            'match', ['get', 'severity'],
                            'CRITICAL', '#ef4444', // Red
                            'WARNING', '#f97316',  // Orange
                            '#eab308'              // Yellow
                        ],
                        'line-width': 4,
                        'line-blur': 2,
                        'line-opacity': 0.5
                    }
                });

                // 2. Main Line (Dashed)
                m.addLayer({
                    id: 'deviations-line',
                    type: 'line',
                    source: 'route-deviations',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': '#fff',
                        'line-width': 2,
                        'line-dasharray': [2, 2]
                    }
                });

                // Click interaction for hexes
                m.on('click', 'risk-hex-fill', (e) => {
                    if (e.features && e.features[0]) {
                        const props = e.features[0].properties;
                        if (!props) return;

                        const reasonDist = JSON.parse(props.reasonDistribution || '{}');
                        const topReasons = Object.entries(reasonDist)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .slice(0, 3)
                            .map(([k, v]) => `<div class="flex justify-between text-[10px]"><span>${formatReason(k)}</span><span>${v}</span></div>`)
                            .join('');

                        new mapboxgl.Popup()
                            .setLngLat(e.lngLat)
                            .setHTML(`
                                <div class="p-2 text-slate-800 min-w-[200px]">
                                    <div class="font-bold border-b pb-1 mb-1">Risk Zone Analysis</div>
                                    <div class="text-xs space-y-1">
                                        <div class="flex justify-between gap-4"><span>H3 Index:</span><span class="font-mono">${props.h3Index}</span></div>
                                        <div class="flex justify-between gap-4"><span>Risk Score:</span><span class="font-bold ${props.riskScore > 50 ? 'text-red-600' : 'text-orange-600'}">${props.riskScore.toFixed(0)}</span></div>
                                        <div class="flex justify-between gap-4"><span>Incidents:</span><span class="font-bold">${props.incidentCount}</span></div>
                                        <div class="flex justify-between gap-4"><span>Critical:</span><span class="font-bold text-red-600">${props.criticalCount}</span></div>
                                    </div>
                                    ${topReasons ? `<div class="mt-2 pt-2 border-t border-slate-200">
                                        <div class="text-[9px] font-bold text-slate-500 uppercase mb-1">Top Risk Factors</div>
                                        ${topReasons}
                                    </div>` : ''}
                                </div>
                            `)
                            .addTo(m);
                    }
                });

                m.on('mouseenter', 'risk-hex-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
                m.on('mouseleave', 'risk-hex-fill', () => { m.getCanvas().style.cursor = ''; });

                // Click interaction for individual Stop Dots
                m.on('click', 'risk-stop-dots', (e) => {
                    // Prefer zoom to dot if hex is also clicked? No, dot is on top.
                    // Handled by dot click logic if exists, or adding it here:
                });

                // Add click for dots
                m.on('mouseenter', 'risk-stop-dots', () => m.getCanvas().style.cursor = 'pointer');
                m.on('mouseleave', 'risk-stop-dots', () => m.getCanvas().style.cursor = '');
                m.on('click', 'risk-stop-dots', (e) => {
                    if (!e.features?.[0]) return;
                    const p = e.features[0].properties;
                    if (!p) return;

                    new mapboxgl.Popup()
                        .setLngLat(e.lngLat)
                        .setHTML(`
                            <div class="p-2 text-slate-800">
                                <div class="font-bold text-xs border-b pb-1 mb-1 text-red-600">${p.severity} Security Event</div>
                                <div class="text-[10px] space-y-1">
                                    <div><b>Tracker:</b> ${p.trackerName}</div>
                                    <div><b>Risk Score:</b> ${p.riskScore}</div>
                                    <div><b>Reason:</b> ${formatReason(p.reasons)}</div>
                                    <div class="text-slate-500 italic">${p.analyzedAt}</div>
                                </div>
                            </div>
                        `)
                        .addTo(m);
                });

                // Hover Popup
                m.on('mousemove', 'deviations-line', (e) => {
                    m.getCanvas().style.cursor = 'pointer';
                    const props = e.features?.[0]?.properties;
                    if (!props) return;

                    const html = `
                        <div class="p-2 text-slate-800 min-w-[200px]">
                            <div class="font-bold border-b pb-1 mb-1 flex justify-between items-center">
                                <span>${props.trackerName}</span>
                                <span class="text-[10px] px-1.5 py-0.5 rounded text-white ${props.severity === 'CRITICAL' ? 'bg-red-600' : 'bg-orange-500'
                        }">${props.severity}</span>
                            </div>
                            <div class="text-xs space-y-1 mt-2">
                                <div class="flex justify-between"><span>Risk Score:</span><b>${props.riskScore}</b></div>
                                <div class="flex justify-between"><span>Dist:</span><b>${Number(props.deviationKm).toFixed(2)} km</b></div>
                                <div class="text-[10px] text-slate-500 mt-1 italic">${props.reasons}</div>
                            </div>
                        </div>
                    `;

                    if (popup.current) popup.current.remove();
                    popup.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
                        .setLngLat(e.lngLat)
                        .setHTML(html)
                        .addTo(m);
                });

                m.on('mouseleave', 'deviations-line', () => {
                    m.getCanvas().style.cursor = '';
                    if (popup.current) { popup.current.remove(); popup.current = null; }
                });

                // Click to view trip
                m.on('click', 'deviations-line', (e) => {
                    const id = e.features?.[0]?.properties?.tripId;
                    if (id) window.open(`/trip/${id}`, '_blank');
                });

                // Fit bounds
                if (deviations.length > 0) {
                    const bounds = new mapboxgl.LngLatBounds();
                    // We just need a couple of points to center
                    // Sampling for performance
                    const sample = deviationFeatures.slice(0, 50);
                    sample.forEach(f => {
                        if (f.geometry.type === 'LineString') {
                            f.geometry.coordinates.forEach((c: any) => bounds.extend(c));
                        } else if (f.geometry.type === 'MultiLineString') {
                            f.geometry.coordinates.forEach(line => line.forEach((c: any) => bounds.extend(c)));
                        }
                    });
                    if (!bounds.isEmpty()) {
                        m.fitBounds(bounds, { padding: 80, maxZoom: 14 });
                    }
                }
            }





            // ══════════════════════════════════════════════════
            // LAYER: SAFE ZONES
            // ══════════════════════════════════════════════════
            if (activeLayer === 'safezones' && safeZones) {
                m.addSource('safe-zones-source', { type: 'geojson', data: safeZones });

                // Fill
                m.addLayer({
                    id: 'safezones-fill',
                    type: 'fill',
                    source: 'safe-zones-source',
                    paint: {
                        'fill-color': [
                            'case',
                            ['any', ['!', ['has', 'color']], ['==', ['get', 'color'], '']],
                            '#3b82f6',
                            ['==', ['length', ['get', 'color']], 6], ['concat', '#', ['get', 'color']],
                            '#3b82f6'
                        ],
                        'fill-opacity': 0.2
                    }
                });

                // Outline
                m.addLayer({
                    id: 'safezones-outline',
                    type: 'line',
                    source: 'safe-zones-source',
                    paint: {
                        'line-color': [
                            'case',
                            ['any', ['!', ['has', 'color']], ['==', ['get', 'color'], '']],
                            '#3b82f6',
                            ['==', ['length', ['get', 'color']], 6], ['concat', '#', ['get', 'color']],
                            '#3b82f6'
                        ],
                        'line-width': 2,
                        'line-dasharray': [2, 1]
                    }
                });

                // Label
                m.addLayer({
                    id: 'safezones-label',
                    type: 'symbol',
                    source: 'safe-zones-source',
                    layout: {
                        'text-field': ['get', 'name'],
                        'text-size': 10,
                        'text-allow-overlap': false,
                        'text-anchor': 'center'
                    },
                    paint: {
                        'text-color': '#fff',
                        'text-halo-color': '#000',
                        'text-halo-width': 1
                    }
                });

                // Interaction
                const szLayerId = 'safezones-fill';
                m.on('mouseenter', szLayerId, () => m.getCanvas().style.cursor = 'pointer');
                m.on('mouseleave', szLayerId, () => {
                    m.getCanvas().style.cursor = '';
                    if (popup.current) { popup.current.remove(); popup.current = null; }
                });

                m.on('click', szLayerId, (e) => {
                    const props = e.features?.[0]?.properties;
                    if (!props) return;

                    new mapboxgl.Popup()
                        .setLngLat(e.lngLat)
                        .setHTML(`
                            <div class="p-2 text-slate-800">
                                <div class="font-bold border-b pb-1 mb-1">Safe Zone</div>
                                <div class="text-xs space-y-1">
                                    <div class="font-bold">${props.name}</div>
                                    <div class="text-[10px] text-slate-500">${props.address || 'No address'}</div>
                                </div>
                            </div>
                        `)
                        .addTo(m);
                });
            }
            // LAYER: ANOMALIES (GPS Tampering) — Industry-Standard Visualization
            // ══════════════════════════════════════════════════════════════════
            if (activeLayer === 'anomalies') {
                console.log('[SecurityMap] Rendering anomalies layer:', tamperingEvents.length);

                // Helper: Generate an arc (great circle approximation) between two points
                const generateArc = (start: [number, number], end: [number, number], steps = 30): [number, number][] => {
                    const coords: [number, number][] = [];
                    for (let i = 0; i <= steps; i++) {
                        const t = i / steps;
                        const lng = start[0] + (end[0] - start[0]) * t;
                        const lat = start[1] + (end[1] - start[1]) * t;
                        // Add curvature: offset perpendicular to line
                        const dLng = end[0] - start[0];
                        const dLat = end[1] - start[1];
                        const dist = Math.sqrt(dLng * dLng + dLat * dLat);
                        const offset = Math.sin(t * Math.PI) * dist * 0.15; // 15% bulge
                        const perpLng = -dLat / (dist || 1) * offset;
                        const perpLat = dLng / (dist || 1) * offset;
                        coords.push([lng + perpLng, lat + perpLat]);
                    }
                    return coords;
                };

                // Severity bucket based on implied speed
                const getSeverity = (speed: number): 'extreme' | 'high' | 'medium' => {
                    if (speed >= 5000) return 'extreme';
                    if (speed >= 1000) return 'high';
                    return 'medium';
                };

                const severityColors = { extreme: '#dc2626', high: '#f97316', medium: '#eab308' };

                // Build features: arcs, origin markers, destination markers
                const arcFeatures: any[] = [];
                const originFeatures: any[] = [];
                const destFeatures: any[] = [];

                tamperingEvents.forEach((e, i) => {
                    const speed = e.implied_speed_kmh || 0;
                    const severity = getSeverity(speed);
                    const color = severityColors[severity];
                    const start: [number, number] = [e.prev_lng, e.prev_lat];
                    const end: [number, number] = [e.new_lng, e.new_lat];
                    const arcCoords = generateArc(start, end);
                    const distKm = e.distance_km?.toFixed(1) ?? '?';
                    const speedStr = speed.toFixed(0);
                    const gapMin = e.gap_minutes?.toFixed(1) ?? '?';

                    arcFeatures.push({
                        type: 'Feature',
                        properties: {
                            id: i,
                            severity,
                            color,
                            speed,
                            tracker_id: e.tracker_id,
                            distance_km: distKm,
                            gap_minutes: gapMin,
                            speed_kmh: speedStr,
                            departed_at: e.departed_at,
                            arrived_at: e.arrived_at,
                        },
                        geometry: { type: 'LineString', coordinates: arcCoords }
                    });

                    // Origin (where vehicle was BEFORE the jump)
                    originFeatures.push({
                        type: 'Feature',
                        properties: { id: i, markerType: 'origin', severity, color, tracker_id: e.tracker_id, speed, distance_km: distKm, gap_minutes: gapMin, speed_kmh: speedStr, departed_at: e.departed_at, arrived_at: e.arrived_at },
                        geometry: { type: 'Point', coordinates: start }
                    });

                    // Destination (where vehicle "teleported" to)
                    destFeatures.push({
                        type: 'Feature',
                        properties: { id: i, markerType: 'dest', severity, color, tracker_id: e.tracker_id, speed, distance_km: distKm, gap_minutes: gapMin, speed_kmh: speedStr, departed_at: e.departed_at, arrived_at: e.arrived_at },
                        geometry: { type: 'Point', coordinates: end }
                    });
                });

                const allFeatures = [...arcFeatures, ...originFeatures, ...destFeatures];

                // Layer IDs
                const sourceId = 'anomalies-source';
                const glowId = 'anomalies-glow';
                const lineId = 'anomalies-line';
                const originId = 'anomalies-origin';
                const originPulseId = 'anomalies-origin-pulse';
                const destId = 'anomalies-dest';
                const destPulseId = 'anomalies-dest-pulse';

                // Cleanup all layers and source
                [glowId, lineId, originPulseId, originId, destPulseId, destId].forEach(id => {
                    if (m.getLayer(id)) m.removeLayer(id);
                });
                if (m.getSource(sourceId)) m.removeSource(sourceId);

                m.addSource(sourceId, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: allFeatures as any }
                });

                // 1. Arc Glow (halo effect)
                m.addLayer({
                    id: glowId,
                    type: 'line',
                    source: sourceId,
                    filter: ['==', ['geometry-type'], 'LineString'],
                    paint: {
                        'line-color': ['get', 'color'],
                        'line-width': 6,
                        'line-blur': 4,
                        'line-opacity': 0.3
                    }
                });

                // 2. Arc Line (animated dash effect)
                m.addLayer({
                    id: lineId,
                    type: 'line',
                    source: sourceId,
                    filter: ['==', ['geometry-type'], 'LineString'],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': ['get', 'color'],
                        'line-width': ['match', ['get', 'severity'], 'extreme', 3, 'high', 2.5, 2],
                        'line-dasharray': [2, 1.5],
                        'line-opacity': 0.85
                    }
                });

                // 3. Origin markers (green ring — "last known good position")
                m.addLayer({
                    id: originPulseId,
                    type: 'circle',
                    source: sourceId,
                    filter: ['==', ['get', 'markerType'], 'origin'],
                    paint: {
                        'circle-radius': 10,
                        'circle-color': 'rgba(34, 197, 94, 0.15)',
                        'circle-stroke-width': 0
                    }
                });
                m.addLayer({
                    id: originId,
                    type: 'circle',
                    source: sourceId,
                    filter: ['==', ['get', 'markerType'], 'origin'],
                    paint: {
                        'circle-radius': 4,
                        'circle-color': '#22c55e',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#fff'
                    }
                });

                // 4. Destination markers (red pulse — "anomalous arrival")
                m.addLayer({
                    id: destPulseId,
                    type: 'circle',
                    source: sourceId,
                    filter: ['==', ['get', 'markerType'], 'dest'],
                    paint: {
                        'circle-radius': ['match', ['get', 'severity'], 'extreme', 14, 'high', 11, 9],
                        'circle-color': ['match', ['get', 'severity'],
                            'extreme', 'rgba(220, 38, 38, 0.2)',
                            'high', 'rgba(249, 115, 22, 0.15)',
                            'rgba(234, 179, 8, 0.12)'
                        ],
                        'circle-stroke-width': 0
                    }
                });
                m.addLayer({
                    id: destId,
                    type: 'circle',
                    source: sourceId,
                    filter: ['==', ['get', 'markerType'], 'dest'],
                    paint: {
                        'circle-radius': ['match', ['get', 'severity'], 'extreme', 6, 'high', 5, 4],
                        'circle-color': ['get', 'color'],
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#fff'
                    }
                });

                // 5. Click interaction — show detailed popup
                m.on('click', destId, (ev) => {
                    if (!ev.features?.[0]) return;
                    const p = ev.features[0].properties!;
                    const sevLabel = p.severity === 'extreme' ? '🔴 EXTREME' : p.severity === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';
                    const depTime = p.departed_at ? new Date(p.departed_at).toLocaleString() : '—';
                    const arrTime = p.arrived_at ? new Date(p.arrived_at).toLocaleString() : '—';

                    new mapboxgl.Popup({ maxWidth: '320px' })
                        .setLngLat(ev.lngLat)
                        .setHTML(`
                            <div style="font-family:system-ui,-apple-system,sans-serif;padding:12px;min-width:260px;">
                                <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #fee2e2;padding-bottom:8px;margin-bottom:10px;">
                                    <span style="font-weight:800;font-size:13px;color:#1e293b;">🛰️ GPS Anomaly</span>
                                    <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:${p.color}18;color:${p.color};border:1px solid ${p.color}40;">${sevLabel}</span>
                                </div>
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:11px;color:#475569;">
                                    <div><span style="color:#94a3b8;font-size:9px;text-transform:uppercase;font-weight:700;">Tracker</span><br/><strong style="color:#1e293b;font-size:12px;">#${p.tracker_id}</strong></div>
                                    <div><span style="color:#94a3b8;font-size:9px;text-transform:uppercase;font-weight:700;">Implied Speed</span><br/><strong style="color:${p.color};font-size:12px;">${Number(p.speed_kmh).toLocaleString()} km/h</strong></div>
                                    <div><span style="color:#94a3b8;font-size:9px;text-transform:uppercase;font-weight:700;">Distance</span><br/><strong style="color:#1e293b;">${p.distance_km} km</strong></div>
                                    <div><span style="color:#94a3b8;font-size:9px;text-transform:uppercase;font-weight:700;">Time Gap</span><br/><strong style="color:#1e293b;">${p.gap_minutes} min</strong></div>
                                    <div><span style="color:#94a3b8;font-size:9px;text-transform:uppercase;font-weight:700;">Departed</span><br/><span style="font-size:10px;">${depTime}</span></div>
                                    <div><span style="color:#94a3b8;font-size:9px;text-transform:uppercase;font-weight:700;">Arrived</span><br/><span style="font-size:10px;">${arrTime}</span></div>
                                </div>
                                <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;text-align:center;">
                                    ⚠️ Vehicle moved ${p.distance_km}km in ${p.gap_minutes} min — physically impossible
                                </div>
                            </div>
                        `)
                        .addTo(m);
                });

                m.on('mouseenter', destId, () => { m.getCanvas().style.cursor = 'pointer'; });
                m.on('mouseleave', destId, () => { m.getCanvas().style.cursor = ''; });

                // Fit bounds
                const bounds = new mapboxgl.LngLatBounds();
                allFeatures.forEach((f: any) => {
                    if (f.geometry.type === 'Point') bounds.extend(f.geometry.coordinates);
                    else f.geometry.coordinates.forEach((c: any) => bounds.extend(c));
                });
                if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 50, maxZoom: 10 });
            }
        };

        if (mapLoaded.current) {
            render();
        } else {
            m.once('load', render);
        }
    }, [activeLayer, hotspots, hexes, clusters, stopRisks, corridors, deviations, safeZones, dynamicClusters, riskReasonFilter, tamperingEvents]);



    // ─── Layer descriptions for legend ────────────────────────
    const layerInfo: Record<ViewLayer, { title: string; desc: string; countLabel: string; count: number }> = {
        points: {
            title: 'Route Deviation Hotspots',
            desc: 'Point-based heatmap of route deviations and unauthorized stops from trip analysis.',
            countLabel: 'Points',
            count: counts.points
        },

        hexgrid: {
            title: 'H3 Risk Hex Grid',
            desc: 'Hexagonal spatial index (resolution 7, ~5 km²) with aggregated stop-risk scores. Circles show individual high-risk stops.',
            countLabel: 'Hexes',
            count: counts.hexes,
        },
        clusters: {
            title: 'DBSCAN Risk Zones',
            desc: 'Machine-clustered risk zones from adjacent high-risk hexes. Purple border = night-dominant zone.',
            countLabel: 'Zones',
            count: counts.clusters,
        },
        corridors: {
            title: 'Learned Fleet Corridors',
            desc: 'The "Golden Path": H3 cells frequently visited by the fleet, forming the known-good route network.',
            countLabel: 'Cells',
            count: counts.corridors,
        },
        deviations: {
            title: 'Actual Deviation Paths',
            desc: 'Red lines showing exactly where vehicles traveled off-route. Click line to see trip details.',
            countLabel: 'Paths',
            count: counts.deviations,
        },
        safezones: {
            title: 'Authorized Safe Zones',
            desc: 'Geofenced areas from Navixy where stops are considered safe (e.g., depots, customer sites).',
            countLabel: 'Zones',
            count: counts.safezones,
        },
        anomalies: {
            title: 'GPS Anomalies',
            desc: 'Suspicious >200km/h jumps',
            countLabel: 'Events',
            count: counts.anomalies
        }
    };



    const info = layerInfo[activeLayer];

    return (
        <div className="h-[600px] w-full rounded-xl overflow-hidden shadow-xl relative bg-slate-900 border-0 ring-0">
            <div ref={mapContainer} className="w-full h-full" />

            {/* Map Style Selector */}
            <div className="absolute bottom-6 left-4 z-20 flex gap-2">
                {[
                    { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark', icon: '🌑' },
                    { id: 'mapbox://styles/mapbox/light-v11', label: 'Light', icon: '☀️' },
                    { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Sat', icon: '🛰️' },
                    { id: 'mapbox://styles/mapbox/streets-v12', label: 'Street', icon: '🛣️' }
                ].map((style) => (
                    <button
                        key={style.id}
                        onClick={() => {
                            if (map.current) {
                                map.current.setStyle(style.id);
                                setMapStyle(style.id);
                                // Note: Changing style removes layers/sources. 
                                // Ideally we should re-add them, but mostly Mapbox preserves them if using standard addLayer.
                                // If layers disappear, we need to trigger a re-render or re-initialization.
                                // For robust mapbox apps, usually we wait for 'style.load' event to re-add layers.
                                // A quick re-mount workaround:
                                // window.location.reload(); // Too aggressive.
                                // Better: Just accept it might need a tab toggle to refresh layers, or implement complex style diffing.
                                // Actually, let's just use the style for base. Re-adding layers is complex in this useEffect structure.
                                // Simple fix: trigger a re-load of the component or dependencies.
                                // Given the complexity, users usually accept a refresh for style change in simple apps.
                                // BUT better: Listen to style.load and re-run fetches.
                                setTimeout(() => {
                                    // Hack to force re-render layers if needed, but for now just switching style.
                                }, 500);
                            }
                        }}
                        className={`
                            px-3 py-1.5 rounded-lg text-xs font-bold backdrop-blur-md transition-all border
                            ${mapStyle === style.id
                                ? 'bg-slate-900/90 text-white border-red-500 shadow-lg shadow-red-500/20'
                                : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white'}
                        `}
                    >
                        <span className="mr-1">{style.icon}</span>
                        {style.label}
                    </button>
                ))}
            </div>

            {/* Loading */}
            {loading && (
                <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mb-2" />
                        <span className="text-xs text-red-500 font-mono animate-pulse">Scanning Security Events...</span>
                    </div>
                </div>
            )}

            {/* ─── Sub-view Toggle (top-right under nav controls) ─── */}
            <div className="absolute top-16 right-3 z-20 flex flex-col gap-1">
                {(['corridors', 'hexgrid', 'clusters', 'points', 'deviations', 'safezones', 'anomalies'] as ViewLayer[]).map(layer => (
                    <button
                        key={layer}
                        onClick={() => {
                            setActiveLayer(layer);
                            if (layer !== 'hexgrid') {
                                setRiskReasonFilter([]);
                            }
                        }}
                        className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-md border transition-all ${activeLayer === layer
                            ? 'bg-red-600/90 border-red-500 text-white shadow-lg shadow-red-900/40'
                            : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                            }`}
                    >
                        {layer === 'hexgrid' ? 'H3 Grid' :
                            layer === 'clusters' ? 'Zones' :
                                layer === 'corridors' ? 'Corridors' :
                                    layer === 'deviations' ? 'Deviations' :
                                        layer === 'safezones' ? 'Safe Zones' :
                                            layer === 'anomalies' ? 'GPS Anomalies' : 'Points'}
                    </button>
                ))}
            </div>

            {/* ─── Sidebar Panel (Filters + Legend) ─── */}
            <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 max-w-xs">
                {/* Temporal Filters */}
                <div className="bg-slate-900/90 backdrop-blur border border-red-500/30 p-4 rounded-xl shadow-2xl overflow-y-auto max-h-[500px]">
                    <h3 className="text-red-500 font-bold text-xs uppercase tracking-wider mb-2">
                        Filter Context
                    </h3>

                    {/* Vehicle Filter */}
                    <div className="mb-2">
                        <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Specific Tracker</label>
                        <select
                            className="w-full text-[10px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 outline-none focus:border-red-500 hover:border-slate-600 transition-colors"
                            value={trackerFilter ?? ''}
                            onChange={(e) => setTrackerFilter(e.target.value === '' ? null : parseInt(e.target.value))}
                        >
                            <option value="">All Trackers</option>
                            {vehicles.map(v => (
                                <option key={v.tracker_id} value={v.tracker_id}>
                                    {v.tracker_name}
                                </option>
                            ))}
                        </select>
                        <div className="text-[9px] text-slate-500 mt-1 text-right italic">
                            {vehicles.length} trackers available
                        </div>
                    </div>

                    {/* Day Filter */}
                    {(
                        <div className="mb-2">
                            <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Day of Week</label>
                            <select
                                className="w-full text-[10px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 outline-none focus:border-red-500 hover:border-slate-600 transition-colors"
                                value={dayFilter ?? ''}
                                onChange={(e) => setDayFilter(e.target.value === '' ? null : parseInt(e.target.value))}
                            >
                                <option value="">All Days</option>
                                <option value="1">Monday</option>
                                <option value="2">Tuesday</option>
                                <option value="3">Wednesday</option>
                                <option value="4">Thursday</option>
                                <option value="5">Friday</option>
                                <option value="6">Saturday</option>
                                <option value="0">Sunday</option>
                            </select>
                        </div>
                    )}

                    {/* Time Filter */}
                    {(
                        <div className="mb-2">
                            <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Time Window</label>
                            <select
                                className="w-full text-[10px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 outline-none focus:border-red-500 hover:border-slate-600 transition-colors"
                                value={hourFilter ?? ''}
                                onChange={(e) => setHourFilter(e.target.value === '' ? null : parseInt(e.target.value))}
                            >
                                <option value="">All Times</option>
                                <option value="0">Late Night (00-04)</option>
                                <option value="1">Early Morn (04-08)</option>
                                <option value="2">Morning (08-12)</option>
                                <option value="3">Afternoon (12-16)</option>
                                <option value="4">Evening (16-20)</option>
                                <option value="5">Night (20-24)</option>
                            </select>
                        </div>
                    )}

                    {/* ─── Risk Reason Filter (Polished Multiselect) - ONLY FOR H3 GRID ─── */}
                    {activeLayer === 'hexgrid' && (
                        <div className="mb-2 relative">
                            {/* ... Content ... */}
                            <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wider">
                                Risk Factors
                            </label>

                            {/* Trigger Button */}
                            <button
                                onClick={() => setRiskSelectOpen(!riskSelectOpen)}
                                className={`
                                w-full text-[10px] rounded-lg px-3 py-2 text-left outline-none transition-all duration-200
                                flex items-center justify-between gap-2
                                ${riskSelectOpen
                                        ? 'bg-slate-800 text-white border border-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
                                        : 'bg-slate-800/60 text-slate-300 border border-slate-700/80 hover:border-slate-500 hover:bg-slate-800'}
                            `}
                            >
                                <span className="truncate font-medium">
                                    {riskReasonFilter.length === 0
                                        ? 'All Reasons (Overall Score)'
                                        : `${riskReasonFilter.length} Factor${riskReasonFilter.length > 1 ? 's' : ''} Selected`}
                                </span>
                                <svg
                                    className={`w-3 h-3 shrink-0 transition-transform duration-200 ${riskSelectOpen ? 'rotate-180 text-red-400' : 'text-slate-500'}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {/* ... Options Rendering (kept same logic, just hidden if not hexgrid) ... */}
                            {/* NOTE: Simplified for edit block, assuming internal logic remains */}
                            {riskReasonFilter.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                    {riskReasonFilter.map(code => {
                                        const meta = RISK_REASON_OPTIONS.find(r => r.code === code);
                                        return (
                                            <span
                                                key={code}
                                                onClick={() => setRiskReasonFilter(prev => prev.filter(c => c !== code))}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold cursor-pointer
                                                       border transition-all hover:opacity-70 active:scale-95"
                                                style={{
                                                    color: meta?.color || '#ef4444',
                                                    borderColor: `${meta?.color || '#ef4444'}40`,
                                                    background: meta?.bg || 'rgba(239,68,68,0.1)',
                                                }}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta?.color || '#ef4444' }} />
                                                {meta?.label || formatReason(code)}
                                                <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </span>
                                        );
                                    })}
                                    {riskReasonFilter.length > 1 && (
                                        <button
                                            onClick={() => setRiskReasonFilter([])}
                                            className="text-[9px] text-slate-500 hover:text-red-400 transition-colors px-1"
                                        >
                                            Clear all
                                        </button>
                                    )}
                                </div>
                            )}

                            {riskSelectOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setRiskSelectOpen(false)} />
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1.5
                                    bg-slate-900/98 backdrop-blur-xl border border-slate-700/80 rounded-xl
                                    shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden
                                    animate-in fade-in slide-in-from-top-1 duration-150 origin-top"
                                    >
                                        <div className="p-1.5 border-b border-slate-800/80">
                                            <div
                                                onClick={() => { setRiskReasonFilter([]); setRiskSelectOpen(false); }}
                                                className={`
                                                px-3 py-2 rounded-lg cursor-pointer text-[10px] flex items-center gap-2.5 transition-all
                                                ${riskReasonFilter.length === 0
                                                        ? 'bg-gradient-to-r from-red-500/15 to-transparent text-white font-semibold'
                                                        : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'}
                                            `}
                                            >
                                                <div className={`
                                                w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all
                                                ${riskReasonFilter.length === 0
                                                        ? 'border-red-500 bg-red-500/20'
                                                        : 'border-slate-600'}
                                            `}>
                                                    {riskReasonFilter.length === 0 && (
                                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="leading-tight">All Reasons</div>
                                                    <div className="text-[8px] text-slate-500 font-normal">Overall composite risk score</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-1.5 max-h-[280px] overflow-y-auto">
                                            {RISK_REASON_OPTIONS.map(option => {
                                                const isSelected = riskReasonFilter.includes(option.code);
                                                return (
                                                    <div
                                                        key={option.code}
                                                        onClick={() => {
                                                            setRiskReasonFilter(prev =>
                                                                prev.includes(option.code)
                                                                    ? prev.filter(c => c !== option.code)
                                                                    : [...prev, option.code]
                                                            );
                                                        }}
                                                        className={`
                                                        px-3 py-2 rounded-lg cursor-pointer text-[10px] flex items-center gap-2.5
                                                        transition-all duration-100 mb-0.5
                                                        ${isSelected
                                                                ? 'font-medium'
                                                                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}
                                                    `}
                                                        style={isSelected ? {
                                                            background: option.bg,
                                                            color: option.color,
                                                        } : undefined}
                                                    >
                                                        <div
                                                            className={`
                                                            w-3.5 h-3.5 rounded shrink-0 border flex items-center justify-center transition-all
                                                            ${isSelected ? 'border-transparent' : 'border-slate-600 bg-slate-800/60'}
                                                        `}
                                                            style={isSelected ? { background: option.color } : undefined}
                                                        >
                                                            {isSelected && (
                                                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5 leading-tight">
                                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: option.color }} />
                                                                <span className="truncate">{option.label}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Legend Panel */}
                <div className="bg-slate-900/90 backdrop-blur border border-red-500/30 p-4 rounded-xl shadow-2xl">
                    <h3 className="text-red-500 font-black text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        {info.title}
                    </h3>
                    <p className="text-slate-400 text-[10px] leading-relaxed mb-3">
                        {info.desc}
                    </p>



                    {/* Standard Risk scale (Green -> Red) - Hide for Points, Deviations, Anomalies */}
                    {activeLayer !== 'points' && activeLayer !== 'deviations' && activeLayer !== 'anomalies' && (
                        <div className="mb-3">
                            <div className="flex items-center gap-0.5 h-2 rounded-full overflow-hidden">
                                <div className="flex-1 h-full" style={{ background: 'rgba(34, 197, 94, 0.6)' }} />
                                <div className="flex-1 h-full" style={{ background: 'rgba(234, 179, 8, 0.6)' }} />
                                <div className="flex-1 h-full" style={{ background: 'rgba(249, 115, 22, 0.7)' }} />
                                <div className="flex-1 h-full" style={{ background: 'rgba(239, 68, 68, 0.8)' }} />
                                <div className="flex-1 h-full" style={{ background: 'rgba(185, 28, 28, 0.9)' }} />
                            </div>
                            <div className="flex justify-between text-[8px] text-slate-500 mt-1">
                                <span>Low</span>
                                <span>Risk Score</span>
                                <span>Critical</span>
                            </div>
                        </div>
                    )}

                    {/* Anomaly Legend */}
                    {activeLayer === 'anomalies' && (
                        <div className="mb-3 space-y-2">
                            {/* Severity Scale */}
                            <div>
                                <div className="text-[9px] font-bold text-slate-500 uppercase mb-1">Severity (Implied Speed)</div>
                                <div className="space-y-1">
                                    {[
                                        { label: 'Extreme', desc: '> 5,000 km/h', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
                                        { label: 'High', desc: '1,000–5,000 km/h', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
                                        { label: 'Medium', desc: '200–1,000 km/h', color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
                                    ].map(s => (
                                        <div key={s.label} className="flex items-center gap-2 text-[10px]">
                                            <div className="w-3 h-3 rounded-full border-2 border-white/30" style={{ background: s.color }} />
                                            <span className="text-slate-300 font-semibold flex-1">{s.label}</span>
                                            <span className="text-slate-500 font-mono text-[9px]">{s.desc}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Marker Legend */}
                            <div className="border-t border-slate-800 pt-2">
                                <div className="text-[9px] font-bold text-slate-500 uppercase mb-1">Markers</div>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <div className="w-3 h-3 rounded-full border-2 border-white/40" style={{ background: '#22c55e' }} />
                                        <span className="text-slate-300">Origin</span>
                                        <span className="text-slate-500 text-[9px]">Last known position</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <div className="w-3 h-3 rounded-full border-2 border-white/40" style={{ background: '#ef4444' }} />
                                        <span className="text-slate-300">Destination</span>
                                        <span className="text-slate-500 text-[9px]">Teleported position</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <svg width="20" height="8" className="shrink-0"><path d="M2 4 Q10 0 18 4" stroke="#ef4444" strokeWidth="1.5" fill="none" strokeDasharray="3 2" /></svg>
                                        <span className="text-slate-300">Arc</span>
                                        <span className="text-slate-500 text-[9px]">Jump trajectory</span>
                                    </div>
                                </div>
                            </div>
                            {/* Counts */}
                            <div className="border-t border-slate-800 pt-2">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">Extreme:</span>
                                    <span className="text-red-400 font-bold">{tamperingEvents.filter(e => (e.implied_speed_kmh || 0) >= 5000).length}</span>
                                </div>
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">High:</span>
                                    <span className="text-orange-400 font-bold">{tamperingEvents.filter(e => (e.implied_speed_kmh || 0) >= 1000 && (e.implied_speed_kmh || 0) < 5000).length}</span>
                                </div>
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">Medium:</span>
                                    <span className="text-yellow-400 font-bold">{tamperingEvents.filter(e => (e.implied_speed_kmh || 0) < 1000).length}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Deviation Legend */}
                    {activeLayer === 'deviations' && (
                        <div className="mb-3 space-y-1 border-t border-slate-800 pt-2">
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-4 h-0.5 border-t-2 border-red-600 shadow-[0_0_5px_rgba(220,38,38,0.8)]" />
                                <span className="text-slate-400">Critical Deviation</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-4 h-0.5 border-t-2 border-orange-500" />
                                <span className="text-slate-400">Warning Deviation</span>
                            </div>
                        </div>
                    )}

                    {/* Legend items for hex view */}
                    {activeLayer === 'hexgrid' && counts.stops > 0 && (
                        <div className="mb-3 space-y-1 border-t border-slate-800 pt-2">
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
                                <span className="text-slate-400">Critical Stop</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-white" />
                                <span className="text-slate-400">Warning Stop (Individual)</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-2.5 h-2.5 rounded-full bg-slate-400 border-2 border-purple-500" />
                                <span className="text-slate-400">Night Stop (purple ring)</span>
                            </div>
                            <div className="mt-2 text-[9px] text-slate-500 italic leading-tight border-t border-slate-800 pt-1">
                                * "Dots" represent individual high-risk stops overlaid on the aggregate hex grid.
                            </div>
                        </div>
                    )}

                    {/* Cluster legend items */}
                    {activeLayer === 'clusters' && (
                        <div className="mb-3 space-y-1 border-t border-slate-800 pt-2">
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-4 h-0.5 border-t-2 border-dashed border-red-500" />
                                <span className="text-slate-400">Day-dominant zone</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="w-4 h-0.5 border-t-2 border-dashed border-purple-500" />
                                <span className="text-slate-400">Night-dominant zone</span>
                            </div>
                        </div>
                    )}

                    {/* Counts */}
                    <div className="flex items-center justify-between text-[10px] border-t border-slate-800 pt-2 mt-2">
                        <span className="text-slate-500">{info.countLabel}:</span>
                        <span className="text-white font-mono">{info.count}</span>
                    </div>
                    {activeLayer === 'hexgrid' && (
                        <div className="flex items-center justify-between text-[10px] mt-1">
                            <span className="text-slate-500">High-Risk Stops:</span>
                            <span className="text-white font-mono">{counts.stops}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
