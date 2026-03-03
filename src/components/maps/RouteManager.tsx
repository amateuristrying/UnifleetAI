'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';
import {
    Route, MapPin, ArrowRight, Clock, Ruler,
    TrendingUp, X, BarChart3, Target, Layers,
    Search, Globe, Eye, EyeOff, Pencil, Save, RotateCcw
} from 'lucide-react';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── Types ───────────────────────────────────────────────────────
interface NetworkEdge {
    edge_id: string;
    from_node: string;
    to_node: string;
    geometry: GeoJSON.LineString;
    distance_km: number;
    duration_hrs: number;
    route_count: number;
    route_ids: string[];
    route_names: string[];
    corridor_types: string[];
}

interface RouteData {
    id: string;
    route_name: string;
    sap_code: string;
    point_a: string;
    point_b: string;
    point_c: string | null;
    point_a_lat: number;
    point_a_lng: number;
    point_b_lat: number;
    point_b_lng: number;
    country_a: string | null;
    country_b: string | null;
    corridor_type: string;
    estimated_distance_km: number | null;
    estimated_duration_hrs: number | null;
}

interface RouteEdge {
    edge_id: string;
    from_node: string;
    to_node: string;
    geometry: GeoJSON.LineString;
    distance_km: number;
    sequence_order: number;
    direction: string;
}

// ─── Constants ───────────────────────────────────────────────────
const CORRIDOR_COLORS: Record<string, string> = {
    long_haul: '#3b82f6',
    regional: '#8b5cf6',
    local: '#10b981',
    multi_leg: '#f59e0b',
};

const CORRIDOR_LABELS: Record<string, string> = {
    long_haul: 'Long Haul',
    regional: 'Regional',
    local: 'Local',
    multi_leg: 'Multi-Leg',
};

// Color by traffic density
function densityColor(routeCount: number): string {
    if (routeCount >= 20) return '#ef4444'; // Red — major artery
    if (routeCount >= 10) return '#f59e0b'; // Amber — busy
    if (routeCount >= 5) return '#3b82f6';  // Blue — moderate
    if (routeCount >= 2) return '#8b5cf6';  // Violet — light
    return '#64748b';                        // Slate — single
}

// ─── Component ───────────────────────────────────────────────────
export default function RouteManager() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const popupRef = useRef<mapboxgl.Popup | null>(null);

    const [edges, setEdges] = useState<NetworkEdge[]>([]);
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoute, setSelectedRoute] = useState<RouteData | null>(null);
    const [selectedEdges, setSelectedEdges] = useState<RouteEdge[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<string>('all');
    const [viewMode, setViewMode] = useState<'map' | 'table'>('map');
    const [showAllEdges, setShowAllEdges] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [editPath, setEditPath] = useState('');

    // ─── Fetch Network & Routes ──────────────────────────────────
    const fetchData = useCallback(async () => {
        setLoading(true);

        const [networkRes, routesRes] = await Promise.all([
            supabase.rpc('get_route_network_graph'),
            supabase
                .from('sap_route_master')
                .select('id, route_name, sap_code, point_a, point_b, point_c, point_a_lat, point_a_lng, point_b_lat, point_b_lng, country_a, country_b, corridor_type, estimated_distance_km, estimated_duration_hrs')
                .eq('is_active', true)
                .order('route_name'),
        ]);

        if (!networkRes.error && networkRes.data) setEdges(networkRes.data);
        if (!routesRes.error && routesRes.data) setRoutes(routesRes.data);

        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ─── Select Route → Fetch its edges ─────────────────────────
    const handleSelectRoute = useCallback(async (route: RouteData) => {
        setSelectedRoute(route);
        setEditMode(false);
        // Auto-switch to map view when selecting from table
        setViewMode('map');

        const { data } = await supabase.rpc('get_route_edges', { p_route_id: route.id });
        if (data) {
            setSelectedEdges(data);
            // Build edit path from edges
            if (data.length > 0) {
                const cities: string[] = [];
                data.forEach((edge: RouteEdge) => {
                    const from = edge.direction === 'reverse' ? edge.to_node : edge.from_node;
                    const to = edge.direction === 'reverse' ? edge.from_node : edge.to_node;
                    if (cities.length === 0) cities.push(from);
                    cities.push(to);
                });
                setEditPath(cities.join(' → '));
            }

            // Fly to route bounds
            const map = mapRef.current;
            if (map && data.length > 0) {
                const bounds = new mapboxgl.LngLatBounds();
                data.forEach((edge: RouteEdge) => {
                    if (edge.geometry?.coordinates) {
                        (edge.geometry.coordinates as [number, number][]).forEach(c => bounds.extend(c));
                    }
                });
                map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 60, right: 420 }, duration: 1200 });
            }
        }
    }, []);

    // ─── Map Initialization ──────────────────────────────────────
    useEffect(() => {
        if (!mapContainer.current || !MAPBOX_TOKEN || edges.length === 0) return;
        if (mapRef.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;
        const map = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [32.0, -8.0],
            zoom: 4.2,
            pitch: 20,
        });

        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        mapRef.current = map;

        map.on('load', () => {
            renderNetwork(map);
        });

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, [edges]);

    // Resize map when switching back to map view
    useEffect(() => {
        if (viewMode === 'map' && mapRef.current) {
            setTimeout(() => mapRef.current?.resize(), 100);
        }
    }, [viewMode]);

    // ─── Render Unified Network ──────────────────────────────────
    const renderNetwork = (map: mapboxgl.Map) => {
        // Build city nodes from edges
        const nodes = new Map<string, { lat: number; lng: number; count: number; routeCount: number }>();

        const edgeFeatures: GeoJSON.Feature[] = edges.map(edge => {
            // Track nodes
            const addNode = (name: string, coords: [number, number]) => {
                if (!nodes.has(name)) nodes.set(name, { lat: coords[1], lng: coords[0], count: 0, routeCount: 0 });
                const n = nodes.get(name)!;
                n.count++;
                n.routeCount = Math.max(n.routeCount, edge.route_count);
            };

            const coords = edge.geometry.coordinates as [number, number][];
            if (coords.length > 0) {
                addNode(edge.from_node, coords[0]);
                addNode(edge.to_node, coords[coords.length - 1]);
            }

            return {
                type: 'Feature' as const,
                properties: {
                    edge_id: edge.edge_id,
                    from_node: edge.from_node,
                    to_node: edge.to_node,
                    distance: edge.distance_km,
                    duration: edge.duration_hrs,
                    route_count: edge.route_count,
                    route_names: edge.route_names?.join(', ') || '',
                    color: densityColor(edge.route_count),
                    width: Math.max(2, Math.min(6, 1.5 + edge.route_count * 0.3)),
                },
                geometry: edge.geometry,
            };
        });

        // ─── Network Edges Layer ────────────────────────────────
        map.addSource('network-edges', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: edgeFeatures },
        });

        // Outer glow
        map.addLayer({
            id: 'network-glow',
            type: 'line',
            source: 'network-edges',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['*', ['get', 'width'], 2.5],
                'line-opacity': 0.1,
                'line-blur': 6,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        // Main network line
        map.addLayer({
            id: 'network-line',
            type: 'line',
            source: 'network-edges',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    3, ['*', ['get', 'width'], 0.6],
                    6, ['get', 'width'],
                    10, ['*', ['get', 'width'], 1.5],
                ],
                'line-opacity': 0.85,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        // ─── Selected Route Highlight Layer (empty initially) ───
        map.addSource('selected-route', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
            id: 'selected-route-glow',
            type: 'line',
            source: 'selected-route',
            paint: {
                'line-color': '#22d3ee',
                'line-width': 12,
                'line-opacity': 0.25,
                'line-blur': 4,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        map.addLayer({
            id: 'selected-route-line',
            type: 'line',
            source: 'selected-route',
            paint: {
                'line-color': '#22d3ee',
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    3, 3, 6, 5, 10, 7,
                ],
                'line-opacity': 1,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        // ─── City Nodes ─────────────────────────────────────────
        // Hub = interconnection node where 3+ highway segments meet
        const nodeFeatures: GeoJSON.Feature[] = Array.from(nodes.entries()).map(([name, data]) => ({
            type: 'Feature' as const,
            properties: {
                name,
                count: data.count,
                routeCount: data.routeCount,
                isHub: data.count >= 3, // 3+ connections = hub/interchange
            },
            geometry: { type: 'Point' as const, coordinates: [data.lng, data.lat] },
        }));

        map.addSource('city-nodes', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: nodeFeatures },
        });

        // Hub outer pulse ring — larger, more visible for interconnection nodes
        map.addLayer({
            id: 'city-nodes-ring',
            type: 'circle',
            source: 'city-nodes',
            filter: ['get', 'isHub'],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 3, 16, 8, 22, 15, 30, 30, 40],
                'circle-color': '#3b82f6',
                'circle-opacity': 0.12,
                'circle-blur': 0.6,
            },
        });

        // Hub diamond marker — distinct shape for hubs vs regular nodes
        map.addLayer({
            id: 'city-nodes-hub-marker',
            type: 'circle',
            source: 'city-nodes',
            filter: ['get', 'isHub'],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 3, 7, 8, 10, 15, 13, 30, 16],
                'circle-color': '#2563eb',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2.5,
                'circle-opacity': 0.95,
            },
        });

        // Regular node dots (non-hub)
        map.addLayer({
            id: 'city-nodes-dot',
            type: 'circle',
            source: 'city-nodes',
            filter: ['!', ['get', 'isHub']],
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['get', 'count'],
                    1, 3.5, 2, 5,
                ],
                'circle-color': '#64748b',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
            },
        });

        // Hub labels — always visible, larger
        map.addLayer({
            id: 'city-hub-label',
            type: 'symbol',
            source: 'city-nodes',
            filter: ['get', 'isHub'],
            layout: {
                'text-field': ['concat', '⬥ ', ['get', 'name']],
                'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 6, 13, 10, 15],
                'text-offset': [0, 1.6],
                'text-anchor': 'top',
                'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#1e3a5f',
                'text-halo-color': '#ffffff',
                'text-halo-width': 2,
            },
        });

        // Regular city labels — smaller, only at higher zoom
        map.addLayer({
            id: 'city-nodes-label',
            type: 'symbol',
            source: 'city-nodes',
            filter: ['!', ['get', 'isHub']],
            layout: {
                'text-field': ['get', 'name'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 6, 10, 10, 12],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#475569',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.5,
            },
        });

        // ─── Network Edge Interactivity ─────────────────────────
        map.on('click', 'network-line', (e) => {
            if (!e.features?.[0]) return;
            const props = e.features[0].properties!;
            // Show routes that use this edge
            if (popupRef.current) popupRef.current.remove();
            const routeNames = (props.route_names || '').split(', ').slice(0, 8);
            popupRef.current = new mapboxgl.Popup({ closeButton: true, maxWidth: '320px' })
                .setLngLat(e.lngLat)
                .setHTML(`
          <div style="padding:12px 16px; background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; color:#1e293b; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <div style="font-weight:700; font-size:14px; margin-bottom:4px; color:#0f172a;">${props.from_node} ↔ ${props.to_node}</div>
            <div style="display:flex; gap:12px; font-size:12px; color:#64748b; margin-bottom:8px;">
              <span>📏 ${props.distance ? props.distance + ' km' : '–'}</span>
              <span>⏱️ ${props.duration ? props.duration + 'h' : '–'}</span>
              <span>🚛 ${props.route_count} route${props.route_count > 1 ? 's' : ''}</span>
            </div>
            <div style="font-size:11px; color:#475569;">
              <div style="font-weight:600; margin-bottom:4px;">Routes using this segment:</div>
              ${routeNames.map((n: string) => `<div style="padding:1px 0;">• ${n}</div>`).join('')}
              ${(props.route_names || '').split(', ').length > 8 ? `<div style="color:#94a3b8; margin-top:2px;">+${(props.route_names || '').split(', ').length - 8} more</div>` : ''}
            </div>
          </div>
        `)
                .addTo(map);
        });

        map.on('mouseenter', 'network-line', (e) => {
            map.getCanvas().style.cursor = 'pointer';
            if (!e.features?.[0]) return;
            const edgeId = e.features[0].properties?.edge_id;
            map.setPaintProperty('network-line', 'line-opacity', [
                'case', ['==', ['get', 'edge_id'], edgeId], 1, 0.5,
            ]);
        });
        map.on('mouseleave', 'network-line', () => {
            map.getCanvas().style.cursor = '';
            map.setPaintProperty('network-line', 'line-opacity', 0.85);
        });

        // Node hover
        map.on('mouseenter', 'city-nodes-dot', (e) => {
            if (!e.features?.[0]) return;
            const props = e.features[0].properties!;
            const coords = (e.features[0].geometry as any).coordinates;
            map.getCanvas().style.cursor = 'pointer';
            if (popupRef.current) popupRef.current.remove();
            popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 10 })
                .setLngLat(coords)
                .setHTML(`
          <div style="padding:8px 12px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; color:#1e293b; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <div style="font-weight:600; font-size:14px;">${props.name}</div>
            <div style="color:#64748b; font-size:12px; margin-top:2px;">
              ${props.count} highway connection${props.count > 1 ? 's' : ''}
              ${props.isHub ? ' · <span style="color:#2563eb; font-weight:600;">⬥ Hub</span>' : ''}
            </div>
          </div>
        `)
                .addTo(map);
        });
        map.on('mouseleave', 'city-nodes-dot', () => {
            map.getCanvas().style.cursor = '';
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        });

        // Hub marker hover
        map.on('mouseenter', 'city-nodes-hub-marker', (e) => {
            if (!e.features?.[0]) return;
            const props = e.features[0].properties!;
            const coords = (e.features[0].geometry as any).coordinates;
            map.getCanvas().style.cursor = 'pointer';
            if (popupRef.current) popupRef.current.remove();
            popupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 14 })
                .setLngLat(coords)
                .setHTML(`
          <div style="padding:10px 14px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; color:#1e293b; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <div style="font-weight:700; font-size:14px; color:#1e40af;">⬥ ${props.name}</div>
            <div style="color:#64748b; font-size:12px; margin-top:2px;">
              ${props.count} highway connections · <span style="color:#2563eb; font-weight:600;">Hub / Interchange</span>
            </div>
          </div>
        `)
                .addTo(map);
        });
        map.on('mouseleave', 'city-nodes-hub-marker', () => {
            map.getCanvas().style.cursor = '';
            if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        });
    };

    // ─── Highlight Selected Route Edges ──────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded() || !map.getSource('selected-route')) return;

        if (selectedRoute && selectedEdges.length > 0) {
            // Build highlight features from the selected route's edges
            const features: GeoJSON.Feature[] = selectedEdges.map(edge => ({
                type: 'Feature',
                properties: { from_node: edge.from_node, to_node: edge.to_node },
                geometry: edge.direction === 'reverse'
                    ? { ...edge.geometry, coordinates: [...edge.geometry.coordinates].reverse() }
                    : edge.geometry,
            }));

            (map.getSource('selected-route') as mapboxgl.GeoJSONSource).setData({
                type: 'FeatureCollection', features,
            });

            // Dim non-selected edges
            if (!showAllEdges) {
                const selectedEdgeIds = new Set(selectedEdges.map(e => e.edge_id));
                map.setPaintProperty('network-line', 'line-opacity', [
                    'case',
                    ['in', ['get', 'edge_id'], ['literal', Array.from(selectedEdgeIds)]],
                    0.85,
                    0.08,
                ]);
                map.setPaintProperty('network-glow', 'line-opacity', [
                    'case',
                    ['in', ['get', 'edge_id'], ['literal', Array.from(selectedEdgeIds)]],
                    0.1,
                    0.02,
                ]);
            } else {
                map.setPaintProperty('network-line', 'line-opacity', 0.4);
                map.setPaintProperty('network-glow', 'line-opacity', 0.05);
            }
        } else {
            // Clear highlight
            (map.getSource('selected-route') as mapboxgl.GeoJSONSource)?.setData({
                type: 'FeatureCollection', features: [],
            });
            map.setPaintProperty('network-line', 'line-opacity', 0.85);
            map.setPaintProperty('network-glow', 'line-opacity', 0.1);
        }
    }, [selectedRoute, selectedEdges, showAllEdges]);

    // ─── Filter Routes ───────────────────────────────────────────
    const filteredRoutes = routes.filter(r => {
        const matchesSearch = searchTerm === '' ||
            r.route_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.sap_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.point_a.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.point_b.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = filterType === 'all' || r.corridor_type === filterType;
        return matchesSearch && matchesType;
    });

    // ─── Network Stats ──────────────────────────────────────────
    const stats = useMemo(() => {
        const totalEdgeKm = edges.reduce((s, e) => s + (e.distance_km || 0), 0);
        const uniqueCities = new Set(edges.flatMap(e => [e.from_node, e.to_node]));
        return {
            totalRoutes: routes.length,
            totalEdges: edges.length,
            totalCities: uniqueCities.size,
            networkKm: Math.round(totalEdgeKm).toLocaleString(),
            longHaul: routes.filter(r => r.corridor_type === 'long_haul').length,
            regional: routes.filter(r => r.corridor_type === 'regional').length,
            local: routes.filter(r => r.corridor_type === 'local').length,
            busiestEdge: edges.length > 0 ? edges.reduce((a, b) => a.route_count > b.route_count ? a : b) : null,
        };
    }, [edges, routes]);

    // ─── Render ──────────────────────────────────────────────────
    return (
        <div className="relative">
            {/* Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                {[
                    { label: 'SAP Routes', value: stats.totalRoutes, icon: Route, color: 'text-blue-500' },
                    { label: 'Highway Segments', value: stats.totalEdges, icon: Layers, color: 'text-emerald-500' },
                    { label: 'Cities', value: stats.totalCities, icon: MapPin, color: 'text-violet-400' },
                    { label: 'Network', value: `${stats.networkKm} km`, icon: Ruler, color: 'text-cyan-400' },
                    { label: 'Long Haul', value: stats.longHaul, icon: Globe, color: 'text-blue-400' },
                    { label: 'Regional', value: stats.regional, icon: Layers, color: 'text-violet-400' },
                    { label: 'Busiest Segment', value: stats.busiestEdge ? `${stats.busiestEdge.from_node}↔${stats.busiestEdge.to_node}` : '–', icon: Target, color: 'text-red-400' },
                ].map(s => (
                    <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                        <div className="flex items-center gap-2">
                            <s.icon size={14} className={s.color} />
                            <span className="text-xs text-gray-500 font-medium">{s.label}</span>
                        </div>
                        <div className="text-base font-bold text-gray-900 mt-1 truncate">{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Search & Filters */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search routes, SAP codes, cities..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
                <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                    {['all', 'long_haul', 'regional', 'local', 'multi_leg'].map(type => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`px-3 py-2 text-xs font-medium transition-colors ${filterType === type ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'
                                }`}
                        >
                            {type === 'all' ? 'All' : CORRIDOR_LABELS[type]}
                        </button>
                    ))}
                </div>
                <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                    <button
                        onClick={() => setViewMode('map')}
                        className={`px-3 py-2 text-xs font-medium transition-colors ${viewMode === 'map' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        Map
                    </button>
                    <button
                        onClick={() => setViewMode('table')}
                        className={`px-3 py-2 text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        Table
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                    {/* Map View — always mounted, toggled via CSS to prevent destroy/recreate */}
                    <div
                        className="relative rounded-xl overflow-hidden border border-gray-200 shadow-sm"
                        style={{ height: 600, display: viewMode === 'map' ? 'block' : 'none' }}
                    >
                        {loading ? (
                            <div className="h-full flex items-center justify-center bg-gray-100 text-gray-500">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mr-3" />
                                Loading Highway Network...
                            </div>
                        ) : (
                            <div ref={mapContainer} className="w-full h-full" />
                        )}

                        {/* Legend */}
                        <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm rounded-lg p-3 border border-gray-200 shadow-lg">
                            <div className="text-xs font-semibold text-gray-700 mb-2">Traffic Density</div>
                            {[
                                { count: 20, label: 'Major Artery (20+ routes)' },
                                { count: 10, label: 'Busy (10-19 routes)' },
                                { count: 5, label: 'Moderate (5-9 routes)' },
                                { count: 2, label: 'Light (2-4 routes)' },
                                { count: 1, label: 'Single Route' },
                            ].map(item => (
                                <div key={item.count} className="flex items-center gap-2 mb-1">
                                    <div
                                        className="rounded-full"
                                        style={{
                                            backgroundColor: densityColor(item.count),
                                            width: `${Math.max(12, 8 + item.count)}px`,
                                            height: '3px',
                                        }}
                                    />
                                    <span className="text-xs text-gray-600">{item.label}</span>
                                </div>
                            ))}
                            <div className="border-t border-gray-200 mt-2 pt-2">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow" />
                                    <span className="text-xs text-gray-600">⬥ Hub / Interchange</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-gray-500 border border-white" />
                                    <span className="text-xs text-gray-600">City / Stop</span>
                                </div>
                            </div>
                            {selectedRoute && (
                                <div className="border-t border-gray-200 mt-2 pt-2 flex items-center gap-2">
                                    <div className="w-4 h-[3px] rounded-full bg-cyan-500" />
                                    <span className="text-xs text-cyan-700 font-medium">Selected Route</span>
                                </div>
                            )}
                        </div>

                        {/* Show/Hide toggle */}
                        {selectedRoute && (
                            <div className="absolute top-4 left-4">
                                <button
                                    onClick={() => setShowAllEdges(p => !p)}
                                    className="flex items-center gap-2 px-3 py-2 bg-white/95 backdrop-blur-sm text-gray-700 text-xs font-medium rounded-lg border border-gray-200 shadow-lg hover:bg-gray-50 transition-colors"
                                >
                                    {showAllEdges ? <Eye size={14} /> : <EyeOff size={14} />}
                                    {showAllEdges ? 'Isolate route' : 'Show full network'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Table View */}
                    {viewMode === 'table' && (
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" style={{ maxHeight: 600, overflowY: 'auto' }}>
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">SAP Code</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Route</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Type</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Distance</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Est. Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredRoutes.map(route => (
                                        <tr
                                            key={route.id}
                                            onClick={() => handleSelectRoute(route)}
                                            className={`cursor-pointer transition-colors ${selectedRoute?.id === route.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                                                }`}
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-gray-600">{route.sap_code}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-medium text-gray-900">{route.point_a}</span>
                                                    <ArrowRight size={12} className="text-gray-400" />
                                                    <span className="font-medium text-gray-900">{route.point_b}</span>
                                                    {route.point_c && (
                                                        <>
                                                            <ArrowRight size={12} className="text-gray-400" />
                                                            <span className="font-medium text-amber-600">{route.point_c}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                                                    style={{ color: CORRIDOR_COLORS[route.corridor_type], backgroundColor: `${CORRIDOR_COLORS[route.corridor_type]}15` }}>
                                                    {CORRIDOR_LABELS[route.corridor_type]}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-700 font-medium">
                                                {route.estimated_distance_km ? `${route.estimated_distance_km.toLocaleString()} km` : '–'}
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-500">
                                                {route.estimated_duration_hrs ? `${route.estimated_duration_hrs}h` : '–'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Detail Panel */}
                {selectedRoute && (
                    <div className="w-96 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" style={{ maxHeight: 600, overflowY: 'auto' }}>
                        <div className="px-5 py-4 bg-gradient-to-br from-blue-600 to-blue-700 text-white relative">
                            <button
                                onClick={() => { setSelectedRoute(null); setSelectedEdges([]); }}
                                className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/20 transition-colors"
                            >
                                <X size={16} />
                            </button>
                            <div className="text-xs font-mono text-blue-200 mb-1">{selectedRoute.sap_code}</div>
                            <h3 className="text-lg font-bold leading-tight">{selectedRoute.route_name}</h3>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/20">
                                    {CORRIDOR_LABELS[selectedRoute.corridor_type]}
                                </span>
                                {selectedRoute.country_a && selectedRoute.country_b && (
                                    <span className="text-xs text-blue-200">
                                        {selectedRoute.country_a} → {selectedRoute.country_b}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Route info grid */}
                        <div className="grid grid-cols-2 gap-px bg-gray-100 border-b border-gray-200">
                            {[
                                { label: 'Distance', value: selectedRoute.estimated_distance_km ? `${selectedRoute.estimated_distance_km.toLocaleString()} km` : '–', icon: Ruler },
                                { label: 'Est. Duration', value: selectedRoute.estimated_duration_hrs ? `${selectedRoute.estimated_duration_hrs}h` : '–', icon: Clock },
                                { label: 'Highway Segments', value: selectedEdges.length || '–', icon: Layers },
                                { label: 'Corridor Type', value: CORRIDOR_LABELS[selectedRoute.corridor_type], icon: Target },
                            ].map(item => (
                                <div key={item.label} className="bg-white px-4 py-3">
                                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                        <item.icon size={12} />
                                        {item.label}
                                    </div>
                                    <div className="text-sm font-bold text-gray-900 mt-0.5">{item.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* Highway segments breakdown */}
                        <div className="p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                    <BarChart3 size={14} className="text-cyan-500" />
                                    Highway Path
                                </h4>
                                <button
                                    onClick={() => setEditMode(!editMode)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${editMode ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                                        }`}
                                >
                                    <Pencil size={12} />
                                    {editMode ? 'Cancel' : 'Edit Path'}
                                </button>
                            </div>

                            {/* Edit Mode */}
                            {editMode && (
                                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <label className="text-xs font-medium text-blue-800 block mb-1">City Path (separate with →)</label>
                                    <textarea
                                        value={editPath}
                                        onChange={e => setEditPath(e.target.value)}
                                        rows={3}
                                        className="w-full text-xs p-2 border border-blue-300 rounded bg-white font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                                        placeholder="Dar Es Salaam → Morogoro → Iringa → Mbeya"
                                    />
                                    <p className="text-xs text-blue-600 mt-1">Edit the city sequence, then re-run the build script to update edges.</p>
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(editPath);
                                                setEditMode(false);
                                            }}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                                        >
                                            <Save size={12} />
                                            Copy Path
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (selectedEdges.length > 0) {
                                                    const cities: string[] = [];
                                                    selectedEdges.forEach(edge => {
                                                        const from = edge.direction === 'reverse' ? edge.to_node : edge.from_node;
                                                        const to = edge.direction === 'reverse' ? edge.from_node : edge.to_node;
                                                        if (cities.length === 0) cities.push(from);
                                                        cities.push(to);
                                                    });
                                                    setEditPath(cities.join(' → '));
                                                }
                                            }}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded hover:bg-gray-300 transition-colors"
                                        >
                                            <RotateCcw size={12} />
                                            Reset
                                        </button>
                                    </div>
                                </div>
                            )}

                            {selectedEdges.length > 0 ? (
                                <div className="space-y-1">
                                    {selectedEdges.map((edge, i) => {
                                        const from = edge.direction === 'reverse' ? edge.to_node : edge.from_node;
                                        const to = edge.direction === 'reverse' ? edge.from_node : edge.to_node;
                                        return (
                                            <div key={edge.edge_id} className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg">
                                                <div className="w-5 h-5 rounded-full bg-cyan-100 text-cyan-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                                                    {i + 1}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-gray-800 truncate">
                                                        {from} → {to}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {edge.distance_km ? `${edge.distance_km} km` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Total distance */}
                                    <div className="mt-3 p-3 bg-cyan-50 border border-cyan-200 rounded-lg">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-medium text-cyan-700">Total Highway Distance</span>
                                            <span className="text-sm font-bold text-cyan-800">
                                                {selectedEdges.reduce((s, e) => s + (e.distance_km || 0), 0).toLocaleString()} km
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-6">
                                    <TrendingUp size={24} className="text-gray-300 mx-auto mb-2" />
                                    <p className="text-xs text-gray-400">No highway segments mapped yet.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
