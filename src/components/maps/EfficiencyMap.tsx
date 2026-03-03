'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
// @ts-ignore
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import { cellToLatLng } from 'h3-js';
import { supabase } from '@/lib/supabase';
import type { Vehicle } from '@/types/telemetry';
import HexReportModal from './HexReportModal';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── Types ───────────────────────────────────────────────────────
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
    // Distribution metrics
    p10_duration_hours: number;
    p25_duration_hours: number;
    median_duration_hours: number;
    p75_duration_hours: number;
    min_duration_hours: number;
    max_duration_hours: number;
    stddev_duration_hours: number;
    morning_visits: number;
    afternoon_visits: number;
    evening_visits: number;
    night_visits: number;
}

interface EfficiencyMapProps {
    dateRange: { start: string; end: string };
    filters: { brands: string[]; vehicles: string[] };
    vehicles: Vehicle[];
    sessionKey?: string;
}

// ─── Component ───────────────────────────────────────────────────
export default function EfficiencyMap({ dateRange, vehicles }: EfficiencyMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const popup = useRef<mapboxgl.Popup | null>(null);
    const mapLoaded = useRef(false);

    // Data
    const [stopPatterns, setStopPatterns] = useState<StopPatternData[]>([]);
    const [loading, setLoading] = useState(false);
    const [patternCount, setPatternCount] = useState(0);

    // Filters
    const [trackerFilter, setTrackerFilter] = useState<number | null>(null);
    const [bottleneckMode, setBottleneckMode] = useState<'congestion' | 'efficiency' | 'overall'>('overall');
    const [bottleneckThreshold, setBottleneckThreshold] = useState(24);
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/streets-v12');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [selectedHexReport, setSelectedHexReport] = useState<{ id: string, name: string } | null>(null);

    // New Filters
    const [timeOfDay, setTimeOfDay] = useState<'all' | 'morning' | 'day' | 'night'>('all');
    const [durationFilter, setDurationFilter] = useState<{ min: string, max: string }>({ min: '', max: '' });

    const getTimeFilter = useCallback(() => {
        if (timeOfDay === 'morning') return [5, 6, 7, 8, 9, 10, 11, 12]; // 5AM - 1PM
        if (timeOfDay === 'day') return [13, 14, 15, 16, 17, 18, 19, 20, 21]; // 1PM - 10PM
        if (timeOfDay === 'night') return [22, 23, 0, 1, 2, 3, 4]; // 10PM - 5AM
        return null;
    }, [timeOfDay]);

    // ─── Init Map ────────────────────────────────────────────────
    useEffect(() => {
        if (!mapContainer.current || map.current) return;
        if (!MAPBOX_TOKEN) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;
        const m = new mapboxgl.Map({
            container: mapContainer.current,
            style: mapStyle,
            center: [39.2, -6.8], // Dar es Salaam
            zoom: 6,
            attributionControl: true,
        });

        // Add Navigation Control
        m.addControl(new mapboxgl.NavigationControl(), 'top-right');

        // Add Geocoder (Top Right now)
        m.addControl(
            new MapboxGeocoder({
                accessToken: mapboxgl.accessToken,
                // @ts-ignore
                mapboxgl: mapboxgl,
                marker: false,
                placeholder: 'Search location...',
                collapsed: true
            }),
            'top-right'
        );

        m.on('load', () => {
            mapLoaded.current = true;
        });

        map.current = m;

        return () => {
            m.remove();
            map.current = null;
            mapLoaded.current = false;
        };
    }, []);

    // ─── Fetch Stop Patterns ─────────────────────────────────────
    const fetchStopPatterns = useCallback(async () => {
        setLoading(true);
        try {
            const rpcParams = {
                min_date: dateRange.start || '2024-01-01T00:00:00Z',
                max_date: dateRange.end || new Date().toISOString(),
                tracker_id_filter: trackerFilter,
                hour_filter: getTimeFilter(),
                p_min_duration: durationFilter.min ? parseFloat(durationFilter.min) : null,
                p_max_duration: durationFilter.max ? parseFloat(durationFilter.max) : null,
                p_limit: 1000,
                p_offset: 0
            };
            console.log('[EfficiencyMap] Calling get_stop_patterns with:', JSON.stringify(rpcParams));

            // Paginate through all results (Supabase caps at 1000 rows per call)
            let allData: any[] = [];
            let page = 0;
            const pageSize = 1000;
            let keepFetching = true;

            while (keepFetching) {
                const { data, error } = await supabase.rpc('get_stop_patterns', {
                    ...rpcParams,
                    p_offset: page * pageSize
                });

                if (error) {
                    console.error('[EfficiencyMap] Fetch error details:', error);
                    throw error;
                }

                if (data && data.length > 0) {
                    allData = [...allData, ...data];
                    console.log(`[EfficiencyMap] Page ${page}: ${data.length} rows (total: ${allData.length})`);
                    if (data.length < pageSize) keepFetching = false;
                } else {
                    keepFetching = false;
                }
                page++;
            }

            console.log(`[EfficiencyMap] Received ${allData.length} total patterns from RPC`);

            const hydratedPatterns: StopPatternData[] = allData.map((p: any) => {
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
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    // Distribution metrics (safe defaults)
                    p10_duration_hours: Number(p.p10_duration_hours) || 0,
                    p25_duration_hours: Number(p.p25_duration_hours) || 0,
                    median_duration_hours: Number(p.median_duration_hours) || p.avg_duration_hours || 0,
                    p75_duration_hours: Number(p.p75_duration_hours) || 0,
                    min_duration_hours: Number(p.min_duration_hours) || 0,
                    max_duration_hours: Number(p.max_duration_hours) || 0,
                    stddev_duration_hours: Number(p.stddev_duration_hours) || 0,
                    morning_visits: p.morning_visits || 0,
                    afternoon_visits: p.afternoon_visits || 0,
                    evening_visits: p.evening_visits || 0,
                    night_visits: p.night_visits || 0,
                };
            });

            setStopPatterns(hydratedPatterns);
            setPatternCount(hydratedPatterns.length);
        } catch (err) {
            console.error('Error fetching stop patterns:', err);
        } finally {
            setLoading(false);
        }
    }, [dateRange, trackerFilter, timeOfDay, durationFilter, getTimeFilter]);

    // Fetch on mount & when filters change
    useEffect(() => {
        fetchStopPatterns();
    }, [fetchStopPatterns]);



    // ─── Render Layers ───────────────────────────────────────────
    useEffect(() => {
        const m = map.current;
        if (!m || !mapLoaded.current || !stopPatterns || stopPatterns.length === 0) return;

        const sourceId = 'efficiency-source';
        const heatmapId = 'efficiency-heatmap';
        const pointId = 'efficiency-point';
        const labelId = 'efficiency-label';

        // Build GeoJSON
        const geojson: any = {
            type: 'FeatureCollection',
            features: stopPatterns.map(p => ({
                type: 'Feature',
                properties: {
                    id: p.h3_index,
                    stop_count: p.stop_count,
                    risk: p.avg_risk_score,
                    count: p.visit_count,
                    duration: p.avg_duration_hours,
                    p90_duration: p.p90_duration_hours,
                    occupancy: p.total_dwell_time_hours,
                    total_dwell_time_hours: p.total_dwell_time_hours,
                    engine_on_hours: p.engine_on_hours,
                    engine_off_hours: p.engine_off_hours,
                    efficiency: p.efficiency_score,
                    engine_on_weight: p.visit_count > 0 ? (p.engine_on_hours / p.visit_count) : 0,
                    engine_off_weight: p.visit_count > 0 ? (p.engine_off_hours / p.visit_count) : 0,
                    avg_dwell_per_tracker: p.avg_dwell_per_tracker,
                    avg_dwell_per_visit: p.avg_dwell_per_visit,
                    timeline_trips: JSON.stringify(p.timeline_trips),
                    total_weight: p.total_dwell_time_hours,
                    unique_trackers: p.unique_trackers,
                    h3Index: p.h3_index,
                    // Distribution
                    p10_duration: p.p10_duration_hours,
                    p25_duration: p.p25_duration_hours,
                    median_duration: p.median_duration_hours,
                    p75_duration: p.p75_duration_hours,
                    min_duration: p.min_duration_hours,
                    max_duration: p.max_duration_hours,
                    stddev_duration: p.stddev_duration_hours,
                    morning_visits: p.morning_visits,
                    afternoon_visits: p.afternoon_visits,
                    evening_visits: p.evening_visits,
                    night_visits: p.night_visits,
                },
                geometry: p.geometry
            }))
        };

        const weightKey = bottleneckMode === 'overall' ? 'avg_dwell_per_visit'
            : bottleneckMode === 'congestion' ? 'engine_on_weight' : 'engine_off_weight';

        // Disable threshold if specific duration filter is active
        const isDurationFilterActive = durationFilter.min !== '' || durationFilter.max !== '';
        const effectiveThreshold = isDurationFilterActive ? 0 : bottleneckThreshold;

        const filterExpr: any[] = ['>=', ['get', weightKey], effectiveThreshold];
        const weightExpr: any[] = [
            'interpolate', ['linear'], ['get', weightKey],
            0, 0,
            effectiveThreshold || 1, 0.6,
            (effectiveThreshold || 1) * 1.25, 1
        ];

        // Cleanup existing
        [labelId, pointId, heatmapId].forEach(id => {
            if (m.getLayer(id)) m.removeLayer(id);
        });
        if (m.getSource(sourceId)) m.removeSource(sourceId);

        // Add source
        m.addSource(sourceId, { type: 'geojson', data: geojson });

        // 1. Heatmap
        m.addLayer({
            id: heatmapId,
            type: 'heatmap',
            source: sourceId,
            maxzoom: 15,
            filter: filterExpr,
            paint: {
                'heatmap-weight': weightExpr as any,
                'heatmap-intensity': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 1.5, 9, 3, 15, 6
                ],
                'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0, 'rgba(0,0,255,0)',
                    0.1, 'rgba(65,105,225,0.6)',
                    0.3, 'rgba(0,255,255,0.6)',
                    0.5, 'rgba(255,255,0,0.7)',
                    0.7, 'rgba(255,165,0,0.8)',
                    1, 'rgba(255,0,0,0.95)'
                ],
                'heatmap-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 8, 9, 20, 15, 50
                ],
                'heatmap-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    14, 0.7, 16, 0.3
                ]
            }
        });

        // 2. Point
        m.addLayer({
            id: pointId,
            type: 'circle',
            source: sourceId,
            filter: filterExpr,
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    5, ['interpolate', ['linear'], ['get', 'duration'], 0, 1.5, 48, 5],
                    9, ['interpolate', ['linear'], ['get', 'duration'], 0, 3, 48, 12],
                    13, ['interpolate', ['linear'], ['get', 'duration'],
                        0, 5,
                        6, 14,
                        12, 25,
                        24, 35,
                        48, 60
                    ]
                ],
                'circle-color': [
                    'interpolate', ['linear'], ['get', 'p90_duration'],
                    bottleneckThreshold, '#22c55e',
                    bottleneckThreshold * 2, '#eab308',
                    bottleneckThreshold * 4, '#ef4444'
                ],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff',
                'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 0.5, 15, 1],
                'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1]
            }
        });

        // 3. Label
        m.addLayer({
            id: labelId,
            type: 'symbol',
            source: sourceId,
            minzoom: 12,
            layout: {
                'text-field': ['get', 'count'],
                'text-size': 10,
                'text-allow-overlap': false
            },
            paint: { 'text-color': '#fff' }
        });

        // ─── Click Interaction ───────────────────────────────────
        m.on('mouseenter', pointId, () => m.getCanvas().style.cursor = 'pointer');
        m.on('mouseleave', pointId, () => {
            m.getCanvas().style.cursor = '';
            if (popup.current) { popup.current.remove(); popup.current = null; }
        });

        m.on('click', pointId, async (e) => {
            const props = e.features?.[0]?.properties;
            if (!props) return;

            const [lng, lat] = e.lngLat.toArray();

            m.flyTo({
                center: e.lngLat,
                padding: { top: 300, bottom: 0, left: 0, right: 0 },
                speed: 0.8, curve: 1
            });

            // Loading popup
            const popupInstance = new mapboxgl.Popup({
                closeButton: true, offset: 15, className: 'minimal-white-popup'
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
                const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,place,locality,district,region,country`);
                const data = await response.json();

                if (data.features && data.features.length > 0) {
                    const countryFeature = data.features.find((f: any) => f.place_type.includes('country'));
                    country = countryFeature ? countryFeature.text : '';

                    const specific = data.features.find((f: any) => f.place_type.includes('address') || f.place_type.includes('poi'));
                    const general = data.features.find((f: any) => f.place_type.includes('place') || f.place_type.includes('locality') || f.place_type.includes('district'));
                    const region = data.features.find((f: any) => f.place_type.includes('region'));

                    if (specific) {
                        address = specific.text;
                        subtext = specific.place_name?.replace(specific.text + ', ', '') || subtext;
                    } else if (general) {
                        address = general.text;
                        subtext = region ? region.text : general.place_name || subtext;
                    } else if (region) {
                        address = region.text;
                        subtext = country;
                    } else {
                        address = data.features[0].text || 'Remote Area';
                        subtext = data.features[0].place_name || 'GPS Coordinate';
                    }
                }
            } catch (err) {
                console.error('Geocoding error:', err);
                address = 'Network Area';
                subtext = 'Location Data Unavailable';
            }

            const fullLocation = [subtext, country].filter(Boolean).join(', ').replace(new RegExp(`, ${country}$`), `, ${country}`);
            const visitsPerTracker = props.unique_trackers > 0 ? (props.count / props.unique_trackers).toFixed(1) : '0';

            // Distribution values
            const p10 = Number(props.p10_duration || 0);
            const p25 = Number(props.p25_duration || 0);
            const median = Number(props.median_duration || 0);
            const p75 = Number(props.p75_duration || 0);
            const p90 = Number(props.p90_duration || 0);
            const minD = Number(props.min_duration || 0);
            const maxD = Number(props.max_duration || 0);
            const stddev = Number(props.stddev_duration || 0);
            const avgDwell = Number(props.avg_dwell_per_visit || 0);
            const totalDwell = Number(props.total_weight || 0);
            const engineOn = Number(props.engine_on_weight || 0);
            const engineOff = Number(props.engine_off_weight || 0);
            const engineTotal = engineOn + engineOff;
            const engineOnPct = engineTotal > 0 ? Math.round((engineOn / engineTotal) * 100) : 0;
            const engineOffPct = 100 - engineOnPct;
            const hasDistribution = p90 > 0;
            const toPct = (v: number) => {
                const range = maxD - minD || 1;
                return Math.max(0, Math.min(100, ((v - minD) / range) * 100));
            };
            const cv = avgDwell > 0 ? stddev / avgDwell : 0;
            let consistencyLabel = 'Consistent';
            let consistencyColor = '#16a34a';
            if (cv > 0.5) { consistencyLabel = 'Moderate Spread'; consistencyColor = '#d97706'; }
            if (cv > 1.0) { consistencyLabel = 'High Variation'; consistencyColor = '#dc2626'; }

            const insights: string[] = [];

            // Time of Day Analysis
            const morning = props.morning_visits || 0;
            const afternoon = props.afternoon_visits || 0;
            const evening = props.evening_visits || 0;
            const night = props.night_visits || 0;
            const totalVisits = morning + afternoon + evening + night;

            let timeInsight = '';
            if (totalVisits > 0) {
                const periods = [
                    { name: 'Morning', count: morning },
                    { name: 'Afternoon', count: afternoon },
                    { name: 'Evening', count: evening },
                    { name: 'Night', count: night }
                ];
                const max = periods.reduce((a, b) => a.count > b.count ? a : b);
                const pct = Math.round((max.count / totalVisits) * 100);

                timeInsight = `Most active: <span style="font-weight:700;color:#0f172a;">${max.name}</span> (${pct}%)`;

                if (night > 0 && (night / totalVisits) > 0.15 && max.name !== 'Night') {
                    timeInsight += ` · <span style="color:#dc2626;">Heavy night activity</span>`;
                }
            }
            if (timeInsight) insights.push(timeInsight);

            // Distribution Insights
            if (hasDistribution) {
                insights.push(`50% of visits were shorter than ${median.toFixed(0)}h`);
                insights.push(`Longest 10% exceeded ${p90.toFixed(0)}h`);
                if (maxD > p90 * 2) insights.push(`Extreme outlier: ${maxD.toFixed(0)}h`);
            }

            // Ignition Insights
            if (engineOnPct > 35) {
                insights.push(`High idle (${engineOnPct}%): Likely powering A/C or waiting`);
            } else if (engineOffPct > 90) {
                insights.push(`Efficient parking: Engine off ${engineOffPct}% of time`);
            }

            // Add std dev insight if high
            if (cv > 0.6) insights.push(`High variability (σ=${stddev.toFixed(1)}h)`);

            let timelineHtml = '';
            try {
                const trips = JSON.parse(props.timeline_trips || '[]');
                if (trips.length > 0) {
                    timelineHtml = `
                    <div style="border-top:1px solid #f1f5f9;padding-top:8px;margin-bottom:8px;">
                        <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:4px;">Recent Visits</div>
                        <div style="display:flex;flex-direction:column;gap:3px;">
                            ${trips.slice(0, 3).map((t: string) => `
                                <div style="font-size:9px;color:#475569;background:#f8fafc;padding:3px 6px;border-radius:3px;border:1px solid #e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                    ${t}
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
                }
            } catch (e) { }
            const html = `
                <style>
                    .mapboxgl-popup { filter: none !important; }
                    .mapboxgl-popup-content {
                        background: white !important; border: 1px solid #cbd5e1 !important;
                        border-radius: 6px !important; padding: 0 !important;
                        box-shadow: 0 2px 12px rgba(0,0,0,0.08) !important;
                        max-width: 480px !important; width: 480px !important;
                    }
                    .mapboxgl-popup-close-button {
                        color: #94a3b8 !important; padding: 8px 12px !important;
                        font-size: 18px !important; line-height: 1 !important; z-index: 10;
                    }
                    .mapboxgl-popup-close-button:hover { color: #ef4444 !important; }
                    .mapboxgl-popup-tip { border-top-color: #cbd5e1 !important; }
                </style>
                <div style="padding:16px;color:#1e293b;font-family:system-ui,-apple-system,sans-serif;position:relative;">
                    
                    <!-- Header -->
                    <div style="margin-bottom:12px;padding-right:24px;">
                        <div style="display:flex;justify-content:space-between;align-items:baseline;">
                            <div style="font-size:9px;font-weight:800;color:#d97706;text-transform:uppercase;letter-spacing:0.1em;">⚡ Operational Insight</div>
                            <div style="font-size:9px;color:#64748b;font-family:monospace;">HEX: ${props.h3Index}</div>
                        </div>
                        <div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1.2;margin-top:2px;">${address}</div>
                        <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fullLocation}</div>
                    </div>

                    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:12px;margin-bottom:12px;">
                        
                        <!-- Left Col: Distribution -->
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:10px;border-radius:4px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Duration Spread</div>
                                <div style="font-size:8px;font-weight:700;color:${consistencyColor};background:${consistencyColor}15;padding:1px 5px;border-radius:2px;">${consistencyLabel}</div>
                            </div>

                            ${hasDistribution ? `
                            <div style="position:relative;height:34px;margin-bottom:6px;margin-top:4px;">
                                <!-- Full Range Track (Min-Max) -->
                                <div style="position:absolute;top:16px;left:0;width:100%;height:4px;background:#f1f5f9;border-radius:2px;"></div>
                                
                                <!-- Range Limits Labels -->
                                <div style="position:absolute;top:0;left:0;font-size:7px;color:#94a3b8;">${minD.toFixed(0)}h</div>
                                <div style="position:absolute;top:0;right:0;font-size:7px;color:#94a3b8;">${maxD.toFixed(0)}h</div>

                                <!-- Box Plot (P10-P90) -->
                                <div style="position:absolute;top:17px;left:${toPct(p10)}%;right:${100 - toPct(p90)}%;height:2px;background:#94a3b8;"></div>
                                <div style="position:absolute;top:10px;left:${toPct(p25)}%;width:${toPct(p75) - toPct(p25)}%;height:16px;background:linear-gradient(135deg,#dbeafe,#fef3c7);border:1px solid #93c5fd;border-radius:2px;z-index:1;"></div>
                                <div style="position:absolute;top:8px;left:${toPct(median)}%;width:2px;height:20px;background:#dc2626;z-index:2;"></div>
                                <div style="position:absolute;top:14px;left:${toPct(avgDwell)}%;width:8px;height:8px;background:#f59e0b;border:1.5px solid #fff;border-radius:50%;transform:translateX(-4px);box-shadow:0 1px 2px rgba(0,0,0,0.15);z-index:3;"></div>
                            </div>
                            
                            <!-- Condensed Stats Row -->
                            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;text-align:center;background:white;border:1px solid #f1f5f9;border-radius:4px;padding:4px;">
                                <div title="P10: Quickest 10% of visits (Fastest turnaround)" style="background:#f0fdf4;border-radius:3px;padding:3px 0;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                                    <div style="font-size:6px;color:#15803d;font-weight:700;">P10 (Fast)</div>
                                    <div style="font-size:9px;font-weight:800;color:#166534;">${p10.toFixed(0)}h</div>
                                </div>
                                <div style="padding:3px 0;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                                    <div style="font-size:6px;color:#94a3b8;">P25</div>
                                    <div style="font-size:9px;font-weight:700;">${p25.toFixed(0)}h</div>
                                </div>
                                <div style="background:#fffbeb;border-radius:3px;padding:3px 0;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                                    <div style="font-size:6px;color:#d97706;font-weight:700;">MEDIAN</div>
                                    <div style="font-size:9px;font-weight:800;color:#b45309;">${median.toFixed(0)}h</div>
                                </div>
                                <div style="padding:3px 0;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                                    <div style="font-size:6px;color:#94a3b8;">P75</div>
                                    <div style="font-size:9px;font-weight:700;">${p75.toFixed(0)}h</div>
                                </div>
                                <div title="P90: Slowest 10% of visits (Potential delays)" style="background:#fef2f2;border-radius:3px;padding:3px 0;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                                    <div style="font-size:6px;color:#dc2626;font-weight:700;">P90 (Slow)</div>
                                    <div style="font-size:9px;font-weight:800;color:#991b1b;">${p90.toFixed(0)}h</div>
                                </div>
                            </div>
                            ` : `
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                                <div style="text-align:center;padding:6px;background:white;border:1px solid #f1f5f9;border-radius:3px;">
                                    <div style="font-size:7px;color:#f59e0b;font-weight:700;">AVG</div>
                                    <div style="font-size:12px;font-weight:800;color:#0f172a;">${avgDwell.toFixed(1)}h</div>
                                </div>
                                <div style="text-align:center;padding:6px;background:#fef2f2;border:1px solid #fecaca;border-radius:3px;">
                                    <div style="font-size:7px;color:#dc2626;font-weight:700;">P90</div>
                                    <div style="font-size:12px;font-weight:800;color:#dc2626;">${p90.toFixed(1)}h</div>
                                </div>
                            </div>
                            `}
                        </div>

                        <!-- Right Col: KPIs & Engine -->
                        <div style="display:flex;flex-direction:column;gap:8px;">
                            
                            <!-- Average Dwell (Prominent) -->
                            <div style="background:#fff7ed;border:1px solid #fdba74;padding:8px;border-radius:4px;text-align:center;">
                                <div style="font-size:8px;color:#ea580c;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Average Dwell</div>
                                <div style="font-size:20px;font-weight:900;color:#c2410c;line-height:1;">${avgDwell.toFixed(1)}h</div>
                            </div>

                            <!-- Visits & Trackers (Combined) -->
                            <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:8px 6px;border-radius:4px;display:flex;justify-content:space-around;align-items:center;">
                                <div style="text-align:center;">
                                    <div style="font-size:7px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Sessions</div>
                                    <div style="font-size:14px;font-weight:800;color:#0f172a;line-height:1.1;">${props.count}</div>
                                    <div style="font-size:7px;color:#64748b;margin-top:2px;">${props.stop_count} stops</div>
                                </div>
                                <div style="width:1px;height:24px;background:#e2e8f0;"></div>
                                <div style="text-align:center;">
                                    <div style="font-size:7px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Trackers</div>
                                    <div style="font-size:14px;font-weight:800;color:#0f172a;line-height:1.1;">${props.unique_trackers}</div>
                                    <div style="font-size:7px;color:#64748b;margin-top:2px;">${visitsPerTracker} s/t</div>
                                </div>
                            </div>

                            <!-- Engine Profile -->
                            <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:8px;border-radius:4px;flex-grow:1;display:flex;flex-direction:column;justify-content:center;">
                                <div style="font-size:8px;font-weight:700;color:#64748b;margin-bottom:4px;">ENGINE PROFILE</div>
                                <div style="height:12px;border-radius:6px;overflow:hidden;display:flex;margin-bottom:4px;">
                                    <div style="width:${engineOnPct}%;background:linear-gradient(90deg,#f59e0b,#ea580c);"></div>
                                    <div style="width:${engineOffPct}%;background:linear-gradient(90deg,#3b82f6,#6366f1);"></div>
                                </div>
                                <div style="display:flex;justify-content:space-between;font-size:9px;">
                                    <span style="color:#ea580c;font-weight:700;">${engineOnPct}% ON</span>
                                    <span style="color:#3b82f6;font-weight:700;">${engineOffPct}% OFF</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Insights Section -->
                    ${insights.length > 0 ? `
                    <div style="border-top:1px solid #f1f5f9;padding-top:10px;margin-bottom:8px;">
                        <div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Key Insights</div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            ${insights.map(i => `
                                <div style="display:flex;align-items:flex-start;gap:4px;font-size:10px;color:#475569;line-height:1.3;">
                                    <span style="color:#f59e0b;font-size:10px;line-height:1;">•</span>
                                    <span>${i}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>` : ''}

                    ${timelineHtml}
                    
                    <div style="margin-top:10px;padding-top:8px;display:flex;justify-content:space-between;font-size:8px;color:#cbd5e1;font-family:monospace;border-top:1px solid #f8fafc;">
                        <div style="display:flex;align-items:center;gap:4px;">
                            <span>σ: ${stddev.toFixed(1)}h</span>
                            <div title="Standard Deviation (σ): Measures consistency. Low values mean predictable durations; High values mean unpredictable delays." 
                                 style="cursor:help;font-size:8px;color:#64748b;background:#f1f5f9;padding:1px 4px;border-radius:2px;border:1px solid #e2e8f0;font-weight:700;">
                                INFO
                            </div>
                        </div>
                        <span>Total Dwell: ${totalDwell.toFixed(0)}h</span>
                    </div>
                    
                    <!-- Report Actions -->
                    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;display:flex;gap:6px;">
                        <button id="btn-view-report" style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;padding:6px;border-radius:4px;font-size:9px;font-weight:700;color:#475569;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all 0.2s;">
                            📄 View Report
                        </button>
                        <button id="btn-download-report" style="flex:1;background:#0f172a;border:1px solid #0f172a;padding:6px;border-radius:4px;font-size:9px;font-weight:700;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all 0.2s;">
                            ⬇ Download
                        </button>
                    </div>
                </div>
            `;


            // Convert to DOM for event listeners
            const container = document.createElement('div');
            container.innerHTML = html;

            const btnView = container.querySelector('#btn-view-report');
            const btnDown = container.querySelector('#btn-download-report');

            if (btnView) {
                btnView.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setSelectedHexReport({ id: props.h3Index, name: address });
                });
            }

            if (btnDown) {
                btnDown.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget as HTMLButtonElement;
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '⏳ Downloading...';
                    btn.style.opacity = '0.7';

                    try {
                        const { data, error } = await supabase.rpc('get_hex_details', {
                            p_h3_index: props.h3Index,
                            min_date: dateRange.start,
                            max_date: dateRange.end,
                            tracker_id_filter: trackerFilter,
                            p_limit: 10000
                        });

                        if (error) throw error;
                        if (!data || data.length === 0) {
                            alert('No data to download');
                            return;
                        }

                        // Generate CSV
                        const headers = ['Vehicle ID', 'Arrival', 'Departure', 'Duration (h)', 'Engine On (h)', 'Engine Off (h)', 'Ignition %', 'Risk Score'];
                        const rows = data.map((row: any) => [
                            row.vehicle_id,
                            row.visit_start,
                            row.visit_end,
                            row.duration_hours?.toFixed(2),
                            row.engine_on_hours?.toFixed(2),
                            row.engine_off_hours?.toFixed(2),
                            row.ignition_on_percent?.toFixed(1) + '%',
                            row.risk_score?.toFixed(1)
                        ]);
                        const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        const url = URL.createObjectURL(blob);
                        link.setAttribute('href', url);
                        link.setAttribute('download', `hex_report_${props.h3Index}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                    } catch (err) {
                        console.error('Download failed', err);
                        alert('Download failed');
                    } finally {
                        if (btn) {
                            btn.innerHTML = originalText;
                            btn.style.opacity = '1';
                        }
                    }
                });
            }

            popupInstance.setDOMContent(container);

        });

        // Fit bounds to data
        if (stopPatterns.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            stopPatterns.slice(0, 200).forEach(p => {
                bounds.extend([p.geometry.coordinates[0], p.geometry.coordinates[1]]);
            });
            if (!bounds.isEmpty()) {
                m.fitBounds(bounds, { padding: 80, maxZoom: 10 });
            }
        }

    }, [stopPatterns, bottleneckMode]);

    // ─── Dedicated threshold update (smooth, no teardown) ────────
    useEffect(() => {
        const m = map.current;
        if (!m || !mapLoaded.current) return;

        const heatmapId = 'efficiency-heatmap';
        const pointId = 'efficiency-point';

        const weightKey = bottleneckMode === 'overall' ? 'avg_dwell_per_visit'
            : bottleneckMode === 'congestion' ? 'engine_on_weight' : 'engine_off_weight';

        const isDurationFilterActive = durationFilter.min !== '' || durationFilter.max !== '';
        const effectiveThreshold = isDurationFilterActive ? 0 : bottleneckThreshold;

        const filterExpr: any[] = ['>=', ['get', weightKey], effectiveThreshold];
        const weightExpr: any[] = [
            'interpolate', ['linear'], ['get', weightKey],
            0, 0,
            effectiveThreshold || 1, 0.6,
            (effectiveThreshold || 1) * 1.25, 1
        ];

        if (m.getLayer(heatmapId)) {
            m.setFilter(heatmapId, filterExpr);
            m.setPaintProperty(heatmapId, 'heatmap-weight', weightExpr as any);
        }
        if (m.getLayer(pointId)) {
            m.setFilter(pointId, filterExpr);
            m.setPaintProperty(pointId, 'circle-color', [
                'interpolate', ['linear'], ['get', 'p90_duration'],
                bottleneckThreshold, '#22c55e',
                bottleneckThreshold * 2, '#eab308',
                bottleneckThreshold * 4, '#ef4444'
            ]);
        }
    }, [bottleneckThreshold, bottleneckMode]);


    const desc = bottleneckMode === 'congestion'
        ? 'Wait-time hotspots with Engine ON. High density indicates traffic congestion or queuing.'
        : bottleneckMode === 'efficiency'
            ? 'Wait-time hotspots with Engine OFF. High density indicates loading/unloading delays or site inefficiency.'
            : 'Combined dwell-time analysis across all operational modes. Identifies systemic chokepoints.';

    // ─── Render ───────────────────────────────────────────────────
    return (
        <div className="h-[600px] w-full rounded-xl overflow-hidden shadow-xl relative bg-slate-50 border border-slate-200">
            <div ref={mapContainer} className="w-full h-full" />

            {/* Report Modal */}
            <HexReportModal
                isOpen={!!selectedHexReport}
                onClose={() => setSelectedHexReport(null)}
                hexId={selectedHexReport?.id || ''}
                locationName={selectedHexReport?.name}
                filters={{
                    dateRange,
                    trackerId: trackerFilter,
                    hourFilter: getTimeFilter(),
                    durationFilter
                }}
            />


            {/* Map Style Selector */}
            <div className="absolute bottom-6 right-4 z-20 flex gap-2">
                {[
                    { id: 'mapbox://styles/mapbox/streets-v12', label: 'Street', icon: '🛣️' },
                    { id: 'mapbox://styles/mapbox/light-v11', label: 'Light', icon: '☀️' },
                    { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark', icon: '🌑' },
                    { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Sat', icon: '🛰️' },
                ].map((style) => (
                    <button
                        key={style.id}
                        onClick={() => {
                            if (map.current) {
                                map.current.setStyle(style.id);
                                setMapStyle(style.id);
                                // Re-render layers after style change
                                map.current.once('style.load', () => {
                                    mapLoaded.current = true;
                                });
                            }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold backdrop-blur-md border transition-colors ${mapStyle === style.id
                            ? 'bg-white text-amber-700 border-amber-400 shadow-lg'
                            : 'bg-white/80 text-slate-500 border-slate-300 hover:bg-white hover:text-slate-700'
                            }`}
                    >
                        <span className="mr-1">{style.icon}</span>
                        {style.label}
                    </button>
                ))}
            </div>

            {/* Loading */}
            {loading && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mb-2" />
                        <span className="text-xs text-amber-600 font-mono animate-pulse">Loading Efficiency Data...</span>
                    </div>
                </div>
            )}

            {/* ─── Sidebar Panel ─── */}
            <div className="absolute top-4 left-4 bottom-4 z-20 flex flex-col gap-2 max-w-[260px] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                {/* Filters */}
                <div className="bg-white/95 border border-slate-200 p-4 rounded-xl shadow-lg">
                    <h3 className="text-amber-600 font-bold text-xs uppercase tracking-wider mb-3">
                        ⚡ Efficiency Filters
                    </h3>

                    {/* Tracker Select */}
                    <div className="mb-3">
                        <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Tracker</label>
                        <select
                            className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-700 outline-none focus:border-amber-400 hover:border-slate-300"
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
                        <div className="text-[9px] text-slate-400 mt-1 text-right">
                            {vehicles.length} trackers
                        </div>
                    </div>
                    {/* Advanced Controls Toggle */}
                    <div className="border-t border-slate-100 pt-2">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="w-full flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase hover:text-slate-700 transition-colors py-1"
                        >
                            <span>Advanced Filters</span>
                            <svg
                                className={`w-3.5 h-3.5 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    </div>

                    {showAdvanced && (
                        <>
                            {/* Temporal Filter */}
                            <div className="mb-3">
                                <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">Time of Day</label>
                                <div className="flex bg-slate-100 p-0.5 rounded-lg">
                                    {['all', 'morning', 'day', 'night'].map(t => (
                                        <button
                                            key={t}
                                            onClick={() => setTimeOfDay(t as any)}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md capitalize transition-all ${timeOfDay === t
                                                ? 'bg-white text-slate-800 shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600'
                                                }`}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex justify-between px-1 mt-1 text-[8px] text-slate-400 font-mono">
                                    <span>05:00</span>
                                    <span>13:00</span>
                                    <span>22:00</span>
                                </div>
                            </div>

                            {/* Duration Filter */}
                            <div className="mb-3">
                                <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Duration (Hours)</label>
                                <div className="flex gap-2 items-center">
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            placeholder="Min"
                                            value={durationFilter.min}
                                            onChange={e => setDurationFilter(prev => ({ ...prev, min: e.target.value }))}
                                            className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700 outline-none focus:border-amber-400 text-center placeholder:text-slate-300"
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] text-slate-400 font-bold">h</span>
                                    </div>
                                    <span className="text-slate-300 text-[10px] font-bold">→</span>
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            placeholder="Max"
                                            value={durationFilter.max}
                                            onChange={e => setDurationFilter(prev => ({ ...prev, max: e.target.value }))}
                                            className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700 outline-none focus:border-amber-400 text-center placeholder:text-slate-300"
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] text-slate-400 font-bold">h</span>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                    {/* Mode Toggle */}
                    <div className="mb-3">
                        <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">Profile</label>
                        <div className="flex flex-col gap-1">
                            <button
                                onClick={() => setBottleneckMode('overall')}
                                className={`w-full py-1.5 px-2 text-[9px] font-bold rounded transition-colors ${bottleneckMode === 'overall'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-300'
                                    : 'bg-slate-50 text-slate-500 border border-slate-200 hover:text-slate-700'
                                    }`}
                            >
                                Overall Avg Dwell
                            </button>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setBottleneckMode('congestion')}
                                    className={`flex-1 py-1.5 px-1 text-[9px] font-bold rounded transition-colors ${bottleneckMode === 'congestion'
                                        ? 'bg-orange-50 text-orange-600 border border-orange-300'
                                        : 'bg-slate-50 text-slate-500 border border-slate-200 hover:text-slate-700'
                                        }`}
                                >
                                    Congestion
                                </button>
                                <button
                                    onClick={() => setBottleneckMode('efficiency')}
                                    className={`flex-1 py-1.5 px-1 text-[9px] font-bold rounded transition-colors ${bottleneckMode === 'efficiency'
                                        ? 'bg-blue-50 text-blue-600 border border-blue-300'
                                        : 'bg-slate-50 text-slate-500 border border-slate-200 hover:text-slate-700'
                                        }`}
                                >
                                    Inefficiency
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Threshold Presets */}
                    <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase mb-2 block">Threshold</label>
                        <div className="grid grid-cols-5 gap-1">
                            {[4, 8, 12, 24, 48].map(h => (
                                <button
                                    key={h}
                                    onClick={() => setBottleneckThreshold(h)}
                                    className={`py-1.5 text-[9px] font-mono font-bold rounded transition-colors ${bottleneckThreshold === h
                                        ? 'bg-amber-100 text-amber-700 border border-amber-400'
                                        : 'bg-slate-50 text-slate-500 border border-slate-200 hover:text-slate-700 hover:border-slate-300'
                                        }`}
                                >
                                    {h}h
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-2 text-[8px] text-slate-400 text-center italic leading-tight">
                        {bottleneckMode === 'overall' ? 'Weight: Avg Dwell Hours per Session' : (bottleneckMode === 'congestion' ? 'Weight: Engine ON per Session' : 'Weight: Engine OFF per Session')}
                    </div>
                </div>

                {/* Legend */}
                <div className="bg-white/95 border border-slate-200 p-4 rounded-xl shadow-lg">
                    <h3 className="text-amber-600 font-black text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        Operational Chokepoints
                    </h3>
                    <p className="text-slate-500 text-[10px] leading-relaxed mb-3">
                        {desc}
                    </p>

                    {/* Gradient */}
                    <div className="mb-3">
                        <div className="h-2 rounded-full overflow-hidden" style={{
                            background: 'linear-gradient(to right, rgba(65,105,225,0.6), rgba(0,255,255,0.6), rgba(255,255,0,0.7), rgba(255,0,0,0.95))'
                        }} />
                        <div className="flex justify-between text-[8px] text-slate-400 mt-1 font-mono">
                            <span>Low ({bottleneckThreshold}h)</span>
                            <span>High ({Math.round(bottleneckThreshold * 1.5)}h+)</span>
                        </div>
                    </div>

                    {/* Count */}
                    <div className="flex items-center justify-between text-[10px] border-t border-slate-100 pt-2 mt-2">
                        <span className="text-slate-400">Chokepoints:</span>
                        <span className="text-slate-800 font-mono font-bold">{patternCount}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
