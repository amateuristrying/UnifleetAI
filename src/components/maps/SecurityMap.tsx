'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import * as turf from '@turf/turf';
import { supabase } from '@/lib/supabase';
import { NavixyService } from '@/services/navixy';
import type { SecurityHotspot } from '@/types/security';
import type { Vehicle } from '@/types/telemetry';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;


type ViewLayer = 'points' | 'hexgrid' | 'clusters' | 'corridors' | 'deviations' | 'safezones' | 'stop-patterns';

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

interface StopPatternData {
    h3_index: string;
    center_lat: number;
    center_lng: number;
    stop_count: number;
    visit_count: number;
    unique_trackers: number;
    avg_risk_score: number;
    avg_duration_hours: number;
    p90_duration_hours: number;
    total_dwell_time_hours: number;
    efficiency_score: number;
    avg_ignition_on_percent: number;
    engine_on_hours: number;
    engine_off_hours: number;
    avg_dwell_per_tracker: number;
    avg_dwell_per_visit: number;
    avg_engine_on_per_tracker: number;
    avg_engine_off_per_tracker: number;
    timeline_trips: string[];
    geometry: GeoJSON.Point;
}

interface SecurityMapProps {
    dateRange: { start: string; end: string };
    filters: { brands: string[]; vehicles: string[] };
    vehicles: Vehicle[];
    sessionKey?: string;
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

export default function SecurityMap({ dateRange, filters, vehicles, sessionKey }: SecurityMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const popup = useRef<mapboxgl.Popup | null>(null);
    const mapLoaded = useRef(false);
    const [isMapReady, setIsMapReady] = useState(false);

    const [activeLayer, setActiveLayer] = useState<ViewLayer>('corridors');
    const [hotspots, setHotspots] = useState<SecurityHotspot[]>([]);
    const [allHexes, setAllHexes] = useState<HexData[]>([]); // Store full dataset
    const [hexes, setHexes] = useState<HexData[]>([]);       // Store filtered dataset
    const [allClusters, setAllClusters] = useState<ClusterData[]>([]); // Store full clusters
    const [clusters, setClusters] = useState<ClusterData[]>([]);       // Store filtered clusters
    const [corridors, setCorridors] = useState<CorridorData[]>([]);
    const [deviations, setDeviations] = useState<DeviationData[]>([]);
    const [stopRisks, setStopRisks] = useState<StopRiskData[]>([]);
    const [stopPatterns, setStopPatterns] = useState<StopPatternData[]>([]);
    const [safeZones, setSafeZones] = useState<GeoJSON.FeatureCollection | null>(null);


    // Loading State
    const [loading, setLoading] = useState(false);

    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');

    // NEW: Temporal Filters
    const [dayFilter, setDayFilter] = useState<number | null>(null); // null = All Days
    const [hourFilter, setHourFilter] = useState<number | null>(null); // null = All Times
    const [monthFilter] = useState<number | null>(null); // null = All Months
    const [yearFilter] = useState<number | null>(null); // null = All Years
    const [trackerFilter, setTrackerFilter] = useState<number | null>(null); // null = All Trackers

    const [bottleneckMode, setBottleneckMode] = useState<'congestion' | 'efficiency' | 'overall'>('overall');
    // NEW: Risk Reason Filter
    const [riskReasonFilter, setRiskReasonFilter] = useState<string[]>([]);
    const [riskSelectOpen, setRiskSelectOpen] = useState(false);

    const [dynamicClusters, setDynamicClusters] = useState<ClusterData[]>([]);

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
            }

            // 2. Dynamic Clustering: when filter active, fetch ALL matching incidents (MINOR+) and cluster them
            if (riskReasonFilter.length > 0) {
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
            } else {
                // No filter: use pre-computed clusters
                setDynamicClusters([]);
                setClusters(currentAllClusters);
            }

        } catch (err) { console.error('Error fetching clusters:', err); }
        finally { setLoading(false); }
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
                try {
                    const coords = cellToBoundary(c.h3_index);
                    if (!coords || coords.length === 0) return null;

                    coords.push(coords[0]); // Close loop
                    // H3 returns [lat, lng], GeoJSON wants [lng, lat]
                    const geoJsonCoords = [coords.map(pt => [pt[1], pt[0]])];
                    const [cLat, cLng] = cellToLatLng(c.h3_index);

                    return {
                        ...c,
                        visit_count: Number(c.visit_count) || 1,
                        is_night_route: Boolean(c.is_night_route),
                        center_lat: cLat,
                        center_lng: cLng,
                        boundary_geojson: { type: 'Polygon', coordinates: geoJsonCoords }
                    };
                } catch (e) {
                    return null;
                }
            }).filter(Boolean) as CorridorData[];

            setCorridors(cr);
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
        } catch (err) { console.error('Error fetching deviations:', err); }
        finally { setLoading(false); }
    }, [dateRange, filters]);

    const fetchSafeZones = useCallback(async () => {
        if (safeZones || !sessionKey) return;

        try {
            const zones = await NavixyService.listZones(sessionKey);
            if (zones && Array.isArray(zones)) {
                // Convert to GeoJSON FeatureCollection
                const features = zones.map((z: any) => {
                    let geometry: any = null;
                    if (z.type === 'circle') {
                        // Create a circle polygon
                        const center = [z.center.lng, z.center.lat];
                        const radiusKm = z.radius / 1000;
                        geometry = turf.circle(center, radiusKm).geometry;
                    } else if (z.type === 'polygon' && z.points) {
                        const coords = z.points.map((p: any) => [p.lng, p.lat]);
                        coords.push(coords[0]); // Close ring
                        geometry = { type: 'Polygon', coordinates: [coords] };
                    }

                    if (!geometry) return null;

                    return {
                        type: 'Feature',
                        properties: {
                            id: z.id,
                            name: z.label,
                            color: z.color,
                            description: z.address || 'Safe Zone'
                        },
                        geometry
                    };
                }).filter(Boolean);

                setSafeZones({
                    type: 'FeatureCollection',
                    features
                } as any);
            }
        } catch (err) { console.error('Error fetching safe zones:', err); }
    }, [safeZones, sessionKey]);

    const fetchStopPatterns = useCallback(async () => {
        // Always re-fetch when filters change
        setLoading(true);
        try {
            let allPatterns: any[] = [];
            let page = 0;
            const pageSize = 1000;
            let keepFetching = true;

            while (keepFetching) {
                const { data, error } = await supabase.rpc('get_stop_patterns', {
                    min_date: dateRange.start || '2023-01-01',
                    max_date: dateRange.end || new Date().toISOString(),
                    day_filter: dayFilter !== null ? [dayFilter] : null,
                    hour_filter: hourFilter !== null ? [hourFilter] : null,
                    tracker_id_filter: trackerFilter,
                    month_filter: monthFilter !== null ? [monthFilter] : null,
                    year_filter: yearFilter !== null ? [yearFilter] : null,
                    p_limit: pageSize,
                    p_offset: page * pageSize
                });

                if (error) {
                    console.error('[SecurityMap] Stop pattern fetch error:', error.message);
                    break;
                }

                if (data && data.length > 0) {
                    allPatterns = [...allPatterns, ...data];
                    if (data.length < pageSize) keepFetching = false;
                } else {
                    keepFetching = false;
                }
                page++;

                if (page > 1000) break; // Safety
            }

            console.log(`[SecurityMap] Fetched ${allPatterns.length} stop patterns`);

            const hydratedPatterns: StopPatternData[] = allPatterns.map((p: any) => {
                const [lat, lng] = cellToLatLng(p.h3_index);
                return {
                    h3_index: p.h3_index,
                    center_lat: lat,
                    center_lng: lng,
                    stop_count: p.stop_count,
                    visit_count: p.visit_count || p.stop_count || 0,
                    unique_trackers: p.unique_trackers,
                    avg_risk_score: p.avg_risk_score,
                    avg_duration_hours: p.avg_duration_hours,
                    p90_duration_hours: p.p90_duration_hours,
                    total_dwell_time_hours: p.total_dwell_time_hours,
                    efficiency_score: p.efficiency_score,
                    avg_ignition_on_percent: p.avg_ignition_on_percent || 0,
                    engine_on_hours: p.total_engine_on_hours || 0,
                    engine_off_hours: p.total_engine_off_hours || 0,
                    avg_dwell_per_tracker: p.avg_dwell_per_tracker || 0,
                    avg_dwell_per_visit: p.avg_dwell_per_visit || p.avg_duration_hours || 0,
                    avg_engine_on_per_tracker: p.avg_engine_on_per_tracker || 0,
                    avg_engine_off_per_tracker: p.avg_engine_off_per_tracker || 0,
                    timeline_trips: p.timeline_trips || [],
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                };
            });
            setStopPatterns(hydratedPatterns);
        } catch (err) { console.error('Error fetching stop patterns:', err); }
        finally { setLoading(false); }
    }, [dateRange, dayFilter, hourFilter, trackerFilter, monthFilter, yearFilter]);


    // ─── Effect: Trigger Fetch on Active Layer Change ────────────────
    useEffect(() => {
        switch (activeLayer) {
            case 'points': fetchHotspots(); break;
            case 'hexgrid': fetchHexGrid(); break;
            case 'clusters': fetchClusters(); break;
            case 'corridors': fetchCorridors(); break;
            case 'deviations': fetchDeviations(); break;
            case 'safezones': fetchSafeZones(); break;
            case 'stop-patterns': fetchStopPatterns(); break;
        }
    }, [activeLayer, fetchHotspots, fetchHexGrid, fetchClusters, fetchCorridors, fetchDeviations, fetchSafeZones, fetchStopPatterns, riskReasonFilter]);

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
        const m = map.current!;

        m.on('load', () => {
            mapLoaded.current = true;
            setIsMapReady(true);
            render();
        });

        popup.current = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false
        });
    }, []);

    // ─── Render Function (Updates Layers/Sources) ────────────────
    const render = useCallback(() => {
        if (!map.current || !mapLoaded.current) return;
        const m = map.current;

        // Cleanup function to hide/remove layers not in the active view
        const cleanupLayers = () => {
            const allLayers = [
                // Hexgrid
                'risk-hex-fill', 'risk-hex-outline', 'risk-stop-dots', 'risk-stop-glow',
                // Clusters
                'cluster-fill', 'cluster-line', 'cluster-label',
                // Points
                'hotspot-heat', 'hotspot-point',
                // Corridors
                'corridor-core-macro', 'corridor-core-micro', 'corridor-arrows', 'corridor-network-glow', 'corridor-network-core',
                // Deviations
                'deviations-line-glow', 'deviations-line',
                // Stop Patterns
                'stop-patterns-heat', 'stop-patterns-point'
            ];

            allLayers.forEach(id => {
                if (m.getLayer(id)) {
                    // We toggle visibility instead of removing to avoid expensive re-add
                    // But for strict mode switching, removing is cleaner or setting visibility 'none'
                    // check if this layer belongs to active mode
                    let shouldShow = false;
                    if (activeLayer === 'hexgrid' && id.startsWith('risk-')) shouldShow = true;
                    if (activeLayer === 'clusters' && id.startsWith('cluster-')) shouldShow = true;
                    if (activeLayer === 'points' && id.startsWith('hotspot-')) shouldShow = true;
                    if (activeLayer === 'corridors' && id.startsWith('corridor-')) shouldShow = true;
                    if (activeLayer === 'deviations' && id.startsWith('deviations-')) shouldShow = true;
                    if (activeLayer === 'stop-patterns' && id.startsWith('stop-patterns-')) shouldShow = true;

                    m.setLayoutProperty(id, 'visibility', shouldShow ? 'visible' : 'none');
                }
            });
        };

        cleanupLayers();

        // Helper to safely add/update source
        const setSource = (id: string, data: any) => {
            const src = m.getSource(id) as mapboxgl.GeoJSONSource;
            if (src) {
                src.setData(data);
            } else {
                m.addSource(id, { type: 'geojson', data });
            }
        };

        // ══════════════════════════════════════════════════
        // LAYER: H3 HEX GRID (Aggregated Risks)
        // ══════════════════════════════════════════════════
        if (hexes.length > 0 && activeLayer === 'hexgrid') {
            const hexGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: hexes.map(h => ({
                    type: 'Feature',
                    properties: {
                        h3Index: h.h3_index,
                        riskScore: h.risk_score,
                        incidentCount: h.incident_count,
                        criticalCount: h.critical_count,
                        reasonDistribution: JSON.stringify(h.reason_distribution)
                    },
                    geometry: h.boundary_geojson as GeoJSON.Geometry
                }))
            };

            setSource('risk-hexes', hexGeoJSON);

            if (!m.getLayer('risk-hex-fill')) {
                m.addLayer({
                    id: 'risk-hex-fill',
                    type: 'fill',
                    source: 'risk-hexes',
                    paint: {
                        'fill-color': [
                            'interpolate', ['linear'], ['get', 'riskScore'],
                            0, 'rgba(34, 197, 94, 0.1)',
                            20, 'rgba(234, 179, 8, 0.2)',
                            40, 'rgba(249, 115, 22, 0.3)',
                            60, 'rgba(239, 68, 68, 0.4)',
                            80, 'rgba(185, 28, 28, 0.6)'
                        ],
                        'fill-outline-color': 'rgba(255,255,255,0.05)'
                    }
                });

                m.addLayer({
                    id: 'risk-hex-outline',
                    type: 'line',
                    source: 'risk-hexes',
                    minzoom: 11,
                    paint: {
                        'line-color': [
                            'interpolate', ['linear'], ['get', 'riskScore'],
                            0, 'rgba(34, 197, 94, 0.3)',
                            50, 'rgba(239, 68, 68, 0.5)'
                        ],
                        'line-width': 1
                    }
                });
            }
        }

        // ══════════════════════════════════════════════════
        // LAYER: INDIVIDUAL STOP DOTS (For Hex View Overlay)
        // ══════════════════════════════════════════════════
        if (stopRisks.length > 0 && activeLayer === 'hexgrid') {
            const stopGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: stopRisks.map(s => ({
                    type: 'Feature',
                    properties: {
                        // Simplify props for minimal vector tile size if needed, but GeoJSON is fine for <5k pts
                        ...s,
                        riskReasons: s.risk_reasons.join(', ')
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [s.stop_lng, s.stop_lat]
                    }
                }))
            };

            setSource('risk-stop-points', stopGeoJSON);

            if (!m.getLayer('risk-stop-dots')) {
                m.addLayer({
                    id: 'risk-stop-dots',
                    type: 'circle',
                    source: 'risk-stop-points',
                    minzoom: 10,
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 2,
                            14, 5
                        ],
                        'circle-color': [
                            'match', ['get', 'severity_level'],
                            'CRITICAL', '#ef4444',
                            'WARNING', '#f97316',
                            '#22c55e'
                        ],
                        'circle-stroke-width': 1,
                        'circle-stroke-color': '#fff',
                        // Night stops get a purple ring
                        'circle-stroke-opacity': [
                            'case', ['get', 'is_night_stop'], 1, 0.2
                        ]
                    }
                });
                // Add a glow for night stops
                m.addLayer({
                    id: 'risk-stop-glow',
                    type: 'circle',
                    source: 'risk-stop-points',
                    minzoom: 10,
                    paint: {
                        'circle-radius': 8,
                        'circle-color': '#a855f7',
                        'circle-opacity': [
                            'case', ['get', 'is_night_stop'], 0.3, 0
                        ],
                        'circle-blur': 0.5
                    }
                }, 'risk-stop-dots');
            }
        }

        // ══════════════════════════════════════════════════
        // LAYER: CLUSTERS (Risk Zones)
        // ══════════════════════════════════════════════════
        if (activeLayer === 'clusters' && clusters.length > 0) {
            const clusterGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: clusters.map(c => ({
                    type: 'Feature',
                    properties: {
                        clusterId: c.cluster_id,
                        riskScore: c.risk_score,
                        incidentCount: c.incident_count,
                        primaryReason: c.primary_reason,
                        isNight: c.is_night_dominant
                    },
                    geometry: c.polygon_geojson as GeoJSON.Geometry
                }))
            };

            setSource('risk-clusters', clusterGeoJSON);

            // Polygon Fill
            if (!m.getLayer('cluster-fill')) {
                m.addLayer({
                    id: 'cluster-fill',
                    type: 'fill',
                    source: 'risk-clusters',
                    paint: {
                        'fill-color': [
                            'interpolate', ['linear'], ['get', 'riskScore'],
                            0, '#22c55e',
                            50, '#eab308',
                            80, '#ef4444'
                        ],
                        'fill-opacity': 0.3
                    }
                });

                // Polygon Outline (Purple for Night, Red for Day Critical)
                m.addLayer({
                    id: 'cluster-line',
                    type: 'line',
                    source: 'risk-clusters',
                    paint: {
                        'line-color': [
                            'case', ['get', 'isNight'],
                            '#a855f7',
                            ['>=', ['get', 'riskScore'], 80], '#b91c1c',
                            '#ef4444'
                        ],
                        'line-width': 2,
                        'line-dasharray': [
                            'case', ['get', 'isNight'],
                            ['literal', [2, 1]], // Dashed for night
                            ['literal', [1, 0]]  // Solid for day
                        ]
                    }
                });

                // Labels
                m.addLayer({
                    id: 'cluster-label',
                    type: 'symbol',
                    source: 'risk-clusters',
                    minzoom: 10,
                    layout: {
                        'text-field': ['concat', ['get', 'primaryReason'], '\n(Risk: ', ['get', 'riskScore'], ')'],
                        'text-size': 11,
                        'text-variable-anchor': ['center'],
                        'text-justify': 'center',
                        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold']
                    },
                    paint: {
                        'text-color': '#fff',
                        'text-halo-color': '#000',
                        'text-halo-width': 1
                    }
                });

                // Interaction
                m.on('click', 'cluster-fill', (e) => {
                    if (e.features && e.features[0]) {
                        const p = e.features[0].properties;
                        new mapboxgl.Popup()
                            .setLngLat(e.lngLat)
                            .setHTML(`
                                <div class="p-2 text-slate-800">
                                    <div class="font-bold border-b pb-1">Risk Zone #${p?.clusterId}</div>
                                    <div class="text-xs mt-1">
                                        <div>Risk Score: <b>${p?.riskScore}</b></div>
                                        <div>Incidents: <b>${p?.incidentCount}</b></div>
                                        <div>Primary: <b>${p?.primaryReason}</b></div>
                                        <div class="mt-1 italic text-slate-500">${p?.isNight ? 'Night-Time Dominated' : 'Day-Time Dominated'}</div>
                                    </div>
                                </div>
                            `)
                            .addTo(m);
                    }
                });

                // Cursor
                m.on('mouseenter', 'cluster-fill', () => m.getCanvas().style.cursor = 'pointer');
                m.on('mouseleave', 'cluster-fill', () => m.getCanvas().style.cursor = '');
            }
        }

        // ══════════════════════════════════════════════════
        // LAYER: POINT HOTSPOTS (Raw)
        // ══════════════════════════════════════════════════
        if (activeLayer === 'points') {
            const pointsGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: hotspots.map(h => ({
                    type: 'Feature',
                    properties: {
                        description: `${h.tracker_name}: ${h.severity_level} (${h.point_type})`,
                        severity: h.severity_level
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [h.lng, h.lat]
                    }
                }))
            };

            setSource('points-source', pointsGeoJSON);

            if (!m.getLayer('hotspot-heat')) {
                // Heatmap
                m.addLayer({
                    id: 'hotspot-heat',
                    type: 'heatmap',
                    source: 'points-source',
                    maxzoom: 15,
                    paint: {
                        'heatmap-weight': [
                            'interpolate', ['linear'], ['get', 'severity'],
                            0, 0,
                            1, 1
                        ],
                        'heatmap-intensity': [
                            'interpolate', ['linear'], ['zoom'],
                            0, 1,
                            15, 3
                        ],
                        'heatmap-color': [
                            'interpolate', ['linear'], ['heatmap-density'],
                            0, 'rgba(0, 0, 255, 0)',
                            0.2, 'rgb(0, 255, 255)',
                            0.4, 'rgb(0, 255, 0)',
                            0.6, 'rgb(255, 255, 0)',
                            0.8, 'rgb(255, 0, 0)'
                        ],
                        'heatmap-radius': [
                            'interpolate', ['linear'], ['zoom'],
                            0, 2,
                            15, 20
                        ],
                        'heatmap-opacity': 0.7
                    }
                });

                m.addLayer({
                    id: 'hotspot-point',
                    type: 'circle',
                    source: 'points-source',
                    minzoom: 14,
                    paint: {
                        'circle-radius': 5,
                        'circle-color': [
                            'match', ['get', 'severity'],
                            'CRITICAL', '#ef4444',
                            'WARNING', '#f97316',
                            '#3b82f6'
                        ],
                        'circle-stroke-color': 'white',
                        'circle-stroke-width': 1
                    }
                });
            }
        }

        // ══════════════════════════════════════════════════
        // LAYER: FLEET CORRIDORS
        // ══════════════════════════════════════════════════
        if (activeLayer === 'corridors' && corridors.length > 0) {
            // A. Core Data Source (All corridors)
            const corrGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: corridors.map(c => ({
                    type: 'Feature',
                    properties: {
                        h3Index: c.h3_index,
                        visitCount: c.visit_count,
                        isNight: c.is_night_route,
                        // Add bearing for arrow visualization
                        bearing: c.bearing_bucket !== undefined ? c.bearing_bucket * 45 : null
                    },
                    geometry: c.boundary_geojson as GeoJSON.Geometry
                }))
            };

            setSource('fleet-corridors', corrGeoJSON);

            // B. Network Lines Source (Optional visualization of flow)
            // We can derive center-points for a "network" view
            const networkGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: corridors.filter(c => c.road_geometry).map(c => ({
                    type: 'Feature',
                    properties: {
                        visitCount: c.visit_count,
                        isNight: c.is_night_route
                    },
                    geometry: c.road_geometry as GeoJSON.Geometry
                }))
            };
            setSource('fleet-corridors-network', networkGeoJSON);


            // 1. MACRO VIEW (Zoom < 11): Fill H3 cells
            if (!m.getLayer('corridor-core-macro')) {
                m.addLayer({
                    id: 'corridor-core-macro',
                    type: 'fill',
                    source: 'fleet-corridors',
                    maxzoom: 11,
                    paint: {
                        'fill-color': [
                            'case', ['get', 'isNight'],
                            '#8b5cf6', // Violet for night
                            '#3b82f6'  // Blue for day
                        ],
                        'fill-opacity': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 0.2, // Low traffic = transparent
                            100, 0.8 // High traffic = opaque
                        ]
                    }
                });
            }

            // 2. MICRO VIEW (Zoom > 11): Detailed Cells + Directional Arrows?
            // Let's use a "road-like" visual for high zoom.
            // We can scale the hex size or use the 'network' lines if available.
            // Let's assume we want to show the cells with high fidelity.

            const maxVisitsMicro = 50; // Scaling factor for opacity

            if (!m.getLayer('corridor-core-micro')) {
                m.addLayer({
                    id: 'corridor-core-micro',
                    type: 'fill',
                    source: 'fleet-corridors',
                    minzoom: 11,
                    paint: {
                        'fill-color': [
                            'case', ['get', 'isNight'],
                            '#a855f7', // Purple-500
                            '#0ea5e9', // Sky-500
                        ],
                        'fill-outline-color': 'rgba(255,255,255,0.1)',
                        'fill-opacity': [
                            'interpolate', ['linear'], ['get', 'visitCount'],
                            1, 0.1,
                            maxVisitsMicro, 0.6
                        ]
                    }
                });

                // Directional Arrows (Symbol Layer) - Requires 'bearing' prop
                m.addLayer({
                    id: 'corridor-arrows',
                    type: 'symbol',
                    source: 'fleet-corridors',
                    minzoom: 13,
                    layout: {
                        'text-field': '➤', // Simple unicode arrow
                        'text-size': [
                            'interpolate', ['linear'], ['zoom'],
                            13, 10,
                            16, 16
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

            setSource('route-deviations', devGeoJSON);

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
                    // @ts-ignore
                    if (f.geometry.type === 'LineString') {
                        // @ts-ignore
                        f.geometry.coordinates.forEach((c: any) => bounds.extend(c));
                        // @ts-ignore
                    } else if (f.geometry.type === 'MultiLineString') {
                        // @ts-ignore
                        f.geometry.coordinates.forEach(line => line.forEach((c: any) => bounds.extend(c)));
                    }
                });
                if (!bounds.isEmpty()) {
                    m.fitBounds(bounds, { padding: 80, maxZoom: 14 });
                }
            }
        }

        // ══════════════════════════════════════════════════
        // LAYER: OPERATIONAL BOTTLENECKS (Heatmap)
        // ══════════════════════════════════════════════════
        if (activeLayer === 'stop-patterns') {
            const patternGeoJSON: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: stopPatterns.map(p => ({
                    type: 'Feature',
                    properties: {
                        h3Index: p.h3_index,
                        count: p.stop_count,
                        visit_count: p.visit_count,
                        unique_trackers: p.unique_trackers,
                        risk: p.avg_risk_score,
                        duration: p.avg_duration_hours,
                        p90_duration: p.p90_duration_hours,
                        occupancy: p.total_dwell_time_hours,
                        efficiency: p.efficiency_score,
                        engine_on_weight: p.visit_count > 0 ? (p.engine_on_hours / p.visit_count) : 0,
                        engine_off_weight: p.visit_count > 0 ? (p.engine_off_hours / p.visit_count) : 0,
                        avg_dwell_per_tracker: p.avg_dwell_per_tracker,
                        avg_dwell_per_visit: p.avg_dwell_per_visit,
                        timeline_trips: JSON.stringify(p.timeline_trips),
                        total_weight: p.total_dwell_time_hours
                    },
                    geometry: p.geometry
                }))
            };

            setSource('stop-patterns-source', patternGeoJSON);

            // Professional Heatmap Layer
            if (!m.getLayer('stop-patterns-heatmap')) {
                m.addLayer({
                    id: 'stop-patterns-heatmap',
                    type: 'heatmap',
                    source: 'stop-patterns-source',
                    maxzoom: 15,
                    paint: {
                        // Exponential weight to make heavy chokepoints stand out dramatically
                        'heatmap-weight': [
                            'interpolate',
                            ['linear'],
                            ['get', bottleneckMode === 'overall' ? 'avg_dwell_per_visit' : (bottleneckMode === 'congestion' ? 'engine_on_weight' : 'engine_off_weight')],
                            0, 0,
                            0.5, 0.2,  // Slight weight for minor stops
                            2, 1,      // Baseline for significant stops
                            10, 5,     // Heavy dwell
                            50, 50     // Extreme bottlenecks
                        ],
                        // Intensity scales subtly to keep hotspots from saturating the route
                        'heatmap-intensity': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            0, 0.1,  // Very light at continental
                            5, 0.4,  // Regional (slightly increased)
                            9, 1,    // District
                            15, 3    // Street
                        ],
                        // Professional Spectral Gradient (Blue -> Cyan -> Green -> Yellow -> Red)
                        'heatmap-color': [
                            'interpolate',
                            ['linear'],
                            ['heatmap-density'],
                            0, 'rgba(0, 0, 0, 0)',
                            0.1, 'rgba(0, 0, 255, 0.4)',     // Deep Blue (Low)
                            0.3, 'rgba(0, 255, 255, 0.5)',   // Cyan (Medium-Low)
                            0.5, 'rgba(0, 255, 0, 0.6)',     // Green (Medium)
                            0.7, 'rgba(255, 255, 0, 0.7)',   // Yellow (High)
                            0.9, 'rgba(255, 0, 0, 0.8)',     // Red (Critical)
                            1, 'rgba(180, 0, 0, 0.95)'       // Dark Red (Extreme)
                        ],
                        // Tight radius for site identification
                        'heatmap-radius': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            0, 1.5,
                            5, 3,
                            9, 8,
                            15, 25
                        ],
                        // Smooth transition to points
                        'heatmap-opacity': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            13, 0.8,
                            15, 0.2 // Keep slightly visible to support points
                        ]
                    }
                });

                // Point icons / Click targets at all zoom levels
                m.addLayer({
                    id: 'stop-patterns-point',
                    type: 'circle',
                    source: 'stop-patterns-source',
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['zoom'],
                            0, 2,
                            14, 4,
                            16, 8
                        ],
                        'circle-color': [
                            'interpolate', ['linear'], ['get', 'p90_duration'],
                            1, '#22c55e',
                            8, '#eab308',
                            24, '#ef4444'
                        ],
                        'circle-stroke-width': 1,
                        'circle-stroke-color': '#fff',
                        'circle-opacity': [
                            'interpolate', ['linear'], ['zoom'],
                            0, 0,    // Fully transparent at low zoom (click target only)
                            12, 0,
                            14, 0.5, // Start showing
                            15, 1    // Fully opaque
                        ],
                        'circle-stroke-opacity': [
                            'interpolate', ['linear'], ['zoom'],
                            13, 0,
                            15, 1
                        ]
                    }
                });

                // 2. Labels
                m.addLayer({
                    id: 'stop-patterns-label',
                    type: 'symbol',
                    source: 'stop-patterns-source',
                    minzoom: 12,
                    layout: {
                        'text-field': ['get', 'count'],
                        'text-size': 10,
                        'text-allow-overlap': false
                    },
                    paint: {
                        'text-color': '#fff'
                    }
                });
            }
        }

        // Interaction
        const layerId = 'stop-patterns-point';
        m.on('mouseenter', layerId, () => m.getCanvas().style.cursor = 'pointer');
        m.on('mouseleave', layerId, () => {
            m.getCanvas().style.cursor = '';
            if (popup.current) { popup.current.remove(); popup.current = null; }
        });

        m.on('click', layerId, async (e) => {
            const props = e.features?.[0]?.properties;
            if (!props) return;

            const [lng, lat] = e.lngLat.toArray();

            // Center map on click to prevent tooltip clipping, with padding
            m.flyTo({
                center: e.lngLat,
                padding: { top: 300, bottom: 0, left: 0, right: 0 },
                speed: 0.8,
                curve: 1
            });

            // Show minimal white loading popup
            const popupInstance = new mapboxgl.Popup({
                closeButton: true,
                offset: 15,
                className: 'minimal-white-popup'
            })
                .setLngLat(e.lngLat)
                .setHTML(`
                        <div class="p-3 bg-white text-slate-800 min-w-[200px] flex items-center gap-2 border border-slate-200 shadow-sm">
                            <div class="animate-spin rounded-full h-3 w-3 border-b-2 border-slate-600"></div>
                            <span class="text-xs font-medium">Resolving Location...</span>
                        </div>
                    `)
                .addTo(m);

            let address = 'Resolving Location...';
            let subtext = 'Coordinated Site';
            let country = '';

            try {
                // Fetch more types to get better fallbacks for remote areas
                const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,place,locality,district,region,country`);
                const data = await response.json();

                if (data.features && data.features.length > 0) {
                    // Extract country
                    const countryFeature = data.features.find((f: any) => f.place_type.includes('country'));
                    country = countryFeature ? countryFeature.text : '';

                    // Prioritize specific address/POI
                    const specific = data.features.find((f: any) => f.place_type.includes('address') || f.place_type.includes('poi'));
                    const general = data.features.find((f: any) => f.place_type.includes('place') || f.place_type.includes('locality') || f.place_type.includes('district'));
                    const region = data.features.find((f: any) => f.place_type.includes('region'));

                    if (specific) {
                        address = specific.text;
                        subtext = specific.place_name.replace(specific.text, '').replace(country, '').replace(/,\s*$/, '').replace(/^,\s*/, '').trim();
                    } else if (general) {
                        address = general.text;
                        subtext = region ? region.text : (country || 'Remote Area');
                    } else if (region) {
                        address = region.text;
                        subtext = country || 'Remote Operations Area';
                    } else {
                        address = country || 'Remote Location';
                        subtext = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                    }
                } else {
                    address = country || 'Remote Location';
                    subtext = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                }
            } catch (err) {
                console.error('Geocoding error:', err);
                address = 'Network Area';
                subtext = 'Location Data Unavailable';
            }

            // Ensure subtext doesn't duplicate country if it's already there or if country is empty
            const fullLocation = [subtext, country].filter(Boolean).join(', ').replace(new RegExp(`, ${country}$`), `, ${country}`);

            const visitsPerTracker = props.unique_trackers > 0 ? (props.visit_count / props.unique_trackers).toFixed(1) : '0';

            const timelineTrips = JSON.parse(props.timeline_trips || '[]');
            const timelineHtml = timelineTrips.length > 0
                ? `
                        <div class="mt-3 pt-3 border-t border-slate-100">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Recent Timeline</div>
                            <div class="space-y-1">
                                ${timelineTrips.map((tid: string) => `
                                    <a href="/trip/${tid}" target="_blank" class="flex items-center gap-2 text-[10px] text-blue-600 hover:text-blue-800 transition-colors group">
                                        <span class="w-1.5 h-1.5 bg-blue-500 group-hover:bg-blue-700 transition-colors"></span>
                                        <span class="font-mono">TRIP-${tid.slice(0, 8).toUpperCase()}</span>
                                        <span class="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                                    </a>
                                `).join('')}
                            </div>
                        </div>
                    `
                : '';

            const html = `
                    <style>
                        .mapboxgl-popup {
                            filter: none !important; /* Remove drop-shadow from parent */
                        }
                        .mapboxgl-popup-content {
                            background: white !important;
                            border: 1px solid #cbd5e1 !important;
                            border-radius: 0 !important;
                            padding: 0 !important;
                            box-shadow: none !important; 
                            max-width: 340px !important;
                            overflow: hidden;
                        }
                        .mapboxgl-popup-close-button {
                            color: #94a3b8 !important;
                            padding: 6px 10px !important;
                            font-size: 20px !important;
                            line-height: 1 !important;
                            z-index: 10;
                            border-radius: 0 !important;
                        }
                        .mapboxgl-popup-close-button:hover {
                            background-color: #f1f5f9 !important;
                            color: #ef4444 !important;
                        }
                        .mapboxgl-popup-tip {
                            border-top-color: #cbd5e1 !important;
                            border-top-width: 8px !important;
                        }
                    </style>
                    <div class="p-5 text-slate-800 font-sans relative">
                        <div class="flex flex-col gap-1 mb-5 pr-6">
                            <div class="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-1">Operational Insight</div>
                            <div class="text-sm font-bold truncate text-slate-900 leading-snug">${address}</div>
                            <div class="text-[11px] text-slate-500 truncate leading-relaxed">${fullLocation}</div>
                        </div>

                        <div class="grid grid-cols-2 gap-3 mb-5">
                            <div class="bg-white border border-slate-200 p-3 shadow-none">
                                <div class="text-[9px] text-slate-500 uppercase font-bold tracking-wide mb-1.5 opacity-80">Visits</div>
                                <div class="text-2xl font-bold text-slate-900 leading-none tracking-tight">${props.visit_count}</div>
                                <div class="text-[10px] text-slate-400 mt-2 font-medium">Avg ${visitsPerTracker} / Tracker</div>
                            </div>
                            <div class="bg-white border border-slate-200 p-3 shadow-none">
                                <div class="text-[9px] text-slate-500 uppercase font-bold tracking-wide mb-1.5 opacity-80">Avg Dwell</div>
                                <div class="text-slate-900 text-2xl font-bold leading-none tracking-tight">
                                    <span class="text-red-600">${Number(props.avg_dwell_per_visit).toFixed(1)}</span><span class="text-sm text-slate-400 font-normal ml-0.5">h</span>
                                </div>
                                <div class="text-[10px] text-slate-400 mt-2 font-medium">Total: ${Number(props.total_weight).toFixed(0)}h</div>
                            </div>
                        </div>

                        <div class="space-y-3 text-[12px]">
                            <div class="flex justify-between items-center text-slate-500">
                                <span class="font-medium">Unique Trackers Involved</span>
                                <span class="text-slate-900 font-bold font-mono">${props.unique_trackers}</span>
                            </div>
                            
                            <div class="w-full h-px bg-slate-100 my-2"></div>

                            <div class="flex justify-between items-center text-slate-500">
                                <span class="font-medium">Congestion (Engine ON)</span>
                                <span class="text-amber-600 font-bold font-mono">${Number(props.engine_on_weight).toFixed(1)}h</span>
                            </div>
                            <div class="flex justify-between items-center text-slate-500">
                                <span class="font-medium">Inefficiency (Engine OFF)</span>
                                <span class="text-blue-600 font-bold font-mono">${Number(props.engine_off_weight).toFixed(1)}h</span>
                            </div>
                        </div>

                        ${timelineHtml}
                        
                        <div class="mt-4 pt-3 flex justify-between items-center text-[9px] text-slate-300 font-mono border-t border-slate-50">
                            <span>HEX: ${props.h3Index}</span>
                            <span>RISK: ${Number(props.risk).toFixed(0)}</span>
                        </div>
                    </div>
                `;

            popupInstance.setHTML(html);
        });

        // ══════════════════════════════════════════════════
        // LAYER: SAFE ZONES
        // ══════════════════════════════════════════════════
        if (activeLayer === 'safezones' && safeZones) {
            setSource('safe-zones-source', safeZones);

            // Fill
            if (!m.getLayer('safezones-fill')) {
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
        }
    }, [activeLayer, hotspots, hexes, clusters, stopRisks, corridors, deviations, safeZones, stopPatterns, bottleneckMode, dynamicClusters, riskReasonFilter]);

    useEffect(() => {
        const m = map.current;
        if (!m) return;

        if (mapLoaded.current) {
            render();
        } else {
            m.once('load', render);
        }
    }, [activeLayer, hotspots, hexes, clusters, stopRisks, corridors, deviations, safeZones, stopPatterns, bottleneckMode, dynamicClusters, riskReasonFilter, render]);

    // ─── Layer descriptions for legend ────────────────────────
    const counts = {
        points: hotspots.length,
        hexes: hexes.length,
        clusters: clusters.length,
        corridors: corridors.length,
        deviations: deviations.length,
        safezones: safeZones?.features?.length || 0,
        stops: stopRisks.length,
        patterns: stopPatterns.length
    };

    const layerInfo: Record<ViewLayer, { title: string; desc: string; countLabel: string; count: number }> = {
        points: {
            title: 'Route Deviation Hotspots',
            desc: 'Point-based heatmap of route deviations and unauthorized stops from trip analysis.',
            countLabel: 'Points',
            count: counts.points
        },
        'stop-patterns': {
            title: 'Operational Bottlenecks',
            desc: bottleneckMode === 'congestion'
                ? 'Wait-time hotspots with Engine ON. High density indicates traffic congestion or queuing at site entry.'
                : 'Wait-time hotspots with Engine OFF. High density indicates loading/unloading delays or site inefficiency.',
            countLabel: 'Bottlenecks',
            count: counts.patterns
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
        }
    };

    const info = layerInfo[activeLayer];

    return (
        <div className="relative w-full h-full bg-slate-950 text-slate-100 overflow-hidden flex flex-col rounded-xl shadow-xl border border-slate-800">

            {/* Map Container */}
            <div ref={mapContainer} className="flex-grow w-full h-full relative" />

            {/* Loader Overlay */}
            {!isMapReady && (
                <div className="absolute inset-0 bg-slate-950 flex items-center justify-center z-50">
                    <div className="flex flex-col items-center gap-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                        <div className="text-sm tracking-widest uppercase text-slate-500">Initializing Security Map...</div>
                    </div>
                </div>
            )}

            {/* Data Loading Overlay */}
            {loading && mapLoaded.current && (
                <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] flex items-center justify-center z-50 transition-opacity duration-300 pointer-events-none">
                    <div className="flex flex-col items-center gap-3 bg-slate-900/90 border border-slate-700/50 p-4 rounded-xl shadow-2xl backdrop-blur-md">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Updating Analytics...</div>
                    </div>
                </div>
            )}

            {/* ─── Sub-view Toggle (top-right under nav controls) ─── */}
            <div className="absolute top-4 right-4 z-20 flex flex-col gap-1">
                {(['corridors', 'hexgrid', 'clusters', 'points', 'deviations', 'safezones', 'stop-patterns'] as ViewLayer[]).map(layer => (
                    <button
                        key={layer}
                        onClick={() => {
                            setActiveLayer(layer);
                            if (layer !== 'hexgrid') {
                                setRiskReasonFilter([]); // Clear filter when leaving hexgrid (except if shared?)
                            }
                        }}
                        className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-md border transition-all flex items-center justify-between gap-2 min-w-[100px]
                            ${activeLayer === layer
                                ? 'bg-red-600/90 border-red-500 text-white shadow-lg shadow-red-900/40'
                                : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                            }`}
                    >
                        <span>{layer === 'hexgrid' ? 'H3 Grid' :
                            layer === 'clusters' ? 'Zones' :
                                layer === 'corridors' ? 'Corridors' :
                                    layer === 'deviations' ? 'Deviations' :
                                        layer === 'stop-patterns' ? 'Bottlenecks' :
                                            layer === 'safezones' ? 'Safe Zones' : 'Points'}</span>
                        {/* Optional: Add count badge? */}
                    </button>
                ))}
            </div>

            {/* ─── Sidebar Panel (Filters + Legend) ─── */}
            <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 max-w-xs">
                {/* Temporal Filters */}
                <div className="bg-slate-900/90 backdrop-blur border border-red-500/30 p-4 rounded-xl shadow-2xl transition-all duration-300 overflow-y-auto max-h-[500px]">
                    <h3 className="text-red-500 font-bold text-xs uppercase tracking-wider mb-2 border-b border-red-500/20 pb-2">
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

                    {/* Time Filter */}
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

                    {/* ─── Risk Reason Filter (Polished Multiselect) - ONLY FOR H3 GRID ─── */}
                    {activeLayer === 'hexgrid' && (
                        <div className="mb-2 relative">
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

                            {/* Active Selection Chips */}
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

                            {/* Dropdown Panel */}
                            {riskSelectOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setRiskSelectOpen(false)} />
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1.5
                                    bg-slate-900/98 backdrop-blur-xl border border-slate-700/80 rounded-xl
                                    shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden
                                    animate-in fade-in slide-in-from-top-1 duration-150 origin-top"
                                    >
                                        {/* "All Reasons" Option */}
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

                                        {/* Individual Reason Options */}
                                        <div className="p-1.5 max-h-[200px] overflow-y-auto
                                        [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent
                                        [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full"
                                        >
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
                                                        {/* Checkbox */}
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

                                                        {/* Color indicator + label */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5 leading-tight">
                                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: option.color }} />
                                                                <span className="truncate">{option.label}</span>
                                                            </div>
                                                            <div className="text-[8px] mt-0.5 font-normal" style={{ color: isSelected ? `${option.color}99` : undefined }}>
                                                                <span className={isSelected ? '' : 'text-slate-600'}>{option.description}</span>
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

                    {/* Bottleneck Profiling Toggle */}
                    {activeLayer === 'stop-patterns' && (
                        <div className="mt-3 p-2 bg-slate-800/50 rounded border border-slate-700/50">
                            <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">Operational Profile</label>
                            <div className="flex flex-col gap-1">
                                <button
                                    onClick={() => setBottleneckMode('overall')}
                                    className={`w-full py-1 px-1 text-[9px] font-bold rounded transition-all ${bottleneckMode === 'overall'
                                        ? 'bg-red-500/20 text-red-500 border border-red-500/50 shadow-inner'
                                        : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-400'
                                        }`}
                                >
                                    Overall Avg Dwell
                                </button>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => setBottleneckMode('congestion')}
                                        className={`flex-1 py-1 px-1 text-[9px] font-bold rounded transition-all ${bottleneckMode === 'congestion'
                                            ? 'bg-orange-500/20 text-orange-500 border border-orange-500/50 shadow-inner'
                                            : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-400'
                                            }`}
                                    >
                                        Congestion
                                    </button>
                                    <button
                                        onClick={() => setBottleneckMode('efficiency')}
                                        className={`flex-1 py-1 px-1 text-[9px] font-bold rounded transition-all ${bottleneckMode === 'efficiency'
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-inner'
                                            : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-400'
                                            }`}
                                    >
                                        Inefficiency
                                    </button>
                                </div>
                            </div>
                            <div className="mt-2 text-[8px] text-slate-500 text-center italic leading-tight">
                                {bottleneckMode === 'overall' ? 'Weight: Avg Dwell Hours per Visit' : (bottleneckMode === 'congestion' ? 'Weight: Engine ON per Visit' : 'Weight: Engine OFF per Visit')}
                            </div>
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

                    {/* Risk scale */}
                    {activeLayer !== 'points' && activeLayer !== 'deviations' && (
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

                    <div className="flex justify-between items-end pt-2 border-t border-slate-700/50">
                        <span className="text-[10px] text-slate-500 uppercase font-medium">{info.countLabel}:</span>
                        <span className="text-xl font-bold text-slate-100 font-mono leading-none">{info.count}</span>
                    </div>
                </div>
            </div>


            {/* Bottom-Left Controls (Time/Map Style) */}
            <div className="absolute bottom-6 left-4 z-20 flex flex-col gap-2">

                {/* Map Style Toggle */}
                <div className="bg-slate-900/90 backdrop-blur rounded-lg border border-slate-700 p-1 flex shadow-xl">
                    {[
                        { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark', icon: '🌑' },
                        { id: 'mapbox://styles/mapbox/light-v11', label: 'Light', icon: '☀️' },
                        { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Sat', icon: '🛰️' },
                        { id: 'mapbox://styles/spide/clt9w6w4u004o01pje43f7q6u', label: 'Security', icon: '🛡️' }
                    ].map(style => (
                        <button
                            key={style.id}
                            onClick={() => {
                                setMapStyle(style.id);
                                if (map.current) map.current.setStyle(style.id);
                            }}
                            className={`px-3 py-2 text-xs font-medium rounded transition-all flex items-center gap-2
                                ${mapStyle === style.id
                                    ? 'bg-slate-700 text-white'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                }`}
                            title={style.label}
                        >
                            <span>{style.icon}</span>
                        </button>
                    ))}
                </div>
            </div>
            {/* Disclaimer Overlay */}
            <div className="absolute bottom-4 right-4 pointer-events-none opacity-50 text-[10px] text-slate-600 max-w-[200px] text-right">
                <p>Security Event Data (Last 24h)</p>
                <p>Confidential • Internal Use Only</p>
            </div>
        </div>
    );
}

