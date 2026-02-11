import { useEffect, useRef, useCallback } from 'react';
import type { Map as MapboxMap, GeoJSONSource, MapMouseEvent } from 'mapbox-gl';
// @ts-expect-error no types for mapbox-gl-draw
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import * as turf from '@turf/turf';
import type { Geofence, CreateZonePayload } from '../../types/geofence';

interface GeofenceMapOverlayProps {
    map: MapboxMap | null;
    zones: Geofence[];
    selectedZoneId: number | null;
    onSelectZone: (zoneId: number | null) => void;
    drawingMode: 'none' | 'polygon' | 'corridor' | 'circle';
    onDrawComplete: (payload: CreateZonePayload) => void;
    onDrawCancel: () => void;
    corridorRadius?: number;
    viewMode?: 'locked' | 'unlocked';
}

const SOURCE_ID = 'geofences-source';
const FILL_LAYER = 'geofences-fill';
const OUTLINE_LAYER = 'geofences-outline';
const LABEL_LAYER = 'geofences-labels';

function buildZonesGeoJSON(zones: Geofence[], selectedZoneId: number | null) {
    const features = zones.map(zone => {
        if (zone.type === 'circle' && zone.center && zone.radius) {
            const circle = turf.circle(
                [zone.center.lng, zone.center.lat],
                zone.radius / 1000,
                { steps: 64, units: 'kilometers' }
            );
            return {
                ...circle,
                properties: {
                    id: zone.id,
                    name: zone.name,
                    color: zone.color,
                    category: zone.category,
                    selected: zone.id === selectedZoneId,
                }
            };
        }

        if (zone.type === 'polygon' && zone.points && zone.points.length >= 3) {
            const coords = zone.points.map(p => [p.lng, p.lat]);
            coords.push(coords[0]);
            return {
                type: 'Feature' as const,
                geometry: { type: 'Polygon' as const, coordinates: [coords] },
                properties: {
                    id: zone.id,
                    name: zone.name,
                    color: zone.color,
                    category: zone.category,
                    selected: zone.id === selectedZoneId,
                }
            };
        }

        if (zone.type === 'sausage' && zone.points && zone.points.length >= 2 && zone.radius) {
            const coords = zone.points.map(p => [p.lng, p.lat]);
            const line = turf.lineString(coords);
            const buffered = turf.buffer(line, zone.radius / 1000, { units: 'kilometers' });
            if (buffered) {
                return {
                    ...buffered,
                    properties: {
                        id: zone.id,
                        name: zone.name,
                        color: zone.color,
                        category: zone.category,
                        selected: zone.id === selectedZoneId,
                    }
                };
            }
        }

        return null;
    }).filter(Boolean);

    return { type: 'FeatureCollection' as const, features };
}

export default function GeofenceMapOverlay({
    map,
    zones,
    selectedZoneId,
    onSelectZone,
    drawingMode,
    onDrawComplete,
    corridorRadius = 500,
}: GeofenceMapOverlayProps) {
    const drawRef = useRef<MapboxDraw | null>(null);
    const layersAdded = useRef(false);

    // ---------------------------------------------------------
    // 1. Add/update geofence layers
    // ---------------------------------------------------------
    const updateLayers = useCallback(() => {
        if (!map) return;

        const geojson = buildZonesGeoJSON(zones, selectedZoneId);

        if (!layersAdded.current) {
            if (map.getSource(SOURCE_ID)) {
                if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER);
                if (map.getLayer(OUTLINE_LAYER)) map.removeLayer(OUTLINE_LAYER);
                if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
                map.removeSource(SOURCE_ID);
            }

            map.addSource(SOURCE_ID, {
                type: 'geojson',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: geojson as any,
            });

            map.addLayer({
                id: FILL_LAYER,
                type: 'fill',
                source: SOURCE_ID,
                paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': [
                        'case',
                        ['==', ['get', 'selected'], true], 0.35,
                        0.15
                    ]
                }
            });

            map.addLayer({
                id: OUTLINE_LAYER,
                type: 'line',
                source: SOURCE_ID,
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': [
                        'case',
                        ['==', ['get', 'selected'], true], 3,
                        1.5
                    ],
                    'line-dasharray': [2, 2]
                }
            });

            map.addLayer({
                id: LABEL_LAYER,
                type: 'symbol',
                source: SOURCE_ID,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 11,
                    'text-allow-overlap': false,
                },
                paint: {
                    'text-color': '#334155',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 1.5,
                }
            });

            layersAdded.current = true;
        } else {
            const source = map.getSource(SOURCE_ID) as GeoJSONSource;
            if (source) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                source.setData(geojson as any);
            }
        }
    }, [map, zones, selectedZoneId]);

    useEffect(() => {
        if (!map) return;

        if (map.isStyleLoaded()) {
            updateLayers();
        } else {
            map.on('load', updateLayers);
            return () => { map.off('load', updateLayers); };
        }
    }, [map, updateLayers]);

    // ---------------------------------------------------------
    // 2. Click handler for zone selection
    // ---------------------------------------------------------
    useEffect(() => {
        if (!map || !layersAdded.current) return;

        const handleClick = (e: MapMouseEvent) => {
            if (drawingMode !== 'none') return;

            const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
            if (features.length > 0) {
                const zoneId = features[0].properties?.id;
                onSelectZone(zoneId ?? null);
            } else {
                onSelectZone(null);
            }
        };

        map.on('click', FILL_LAYER, handleClick);

        const onEnter = () => { if (drawingMode === 'none') map.getCanvas().style.cursor = 'pointer'; };
        const onLeave = () => { if (drawingMode === 'none') map.getCanvas().style.cursor = ''; };
        map.on('mouseenter', FILL_LAYER, onEnter);
        map.on('mouseleave', FILL_LAYER, onLeave);

        return () => {
            map.off('click', FILL_LAYER, handleClick);
            map.off('mouseenter', FILL_LAYER, onEnter);
            map.off('mouseleave', FILL_LAYER, onLeave);
        };
    }, [map, onSelectZone, drawingMode]);

    // ---------------------------------------------------------
    // 2a. Auto-zoom to selected zone
    // ---------------------------------------------------------
    useEffect(() => {
        if (!map || !selectedZoneId) return;

        const zone = zones.find(z => z.id === selectedZoneId);
        if (!zone) return;

        try {
            const featureCollection = buildZonesGeoJSON([zone], selectedZoneId);
            const feature = featureCollection.features[0];

            if (feature) {
                const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);
                map.fitBounds(
                    [[minLng, minLat], [maxLng, maxLat]],
                    { padding: 100, maxZoom: 16 }
                );
            }
        } catch (e) {
            console.warn('Failed to zoom to zone:', e);
        }
    }, [map, selectedZoneId, zones]);

    // ---------------------------------------------------------
    // 3. MapboxDraw for polygon/corridor creation
    // ---------------------------------------------------------
    useEffect(() => {
        if (!map) return;

        if (drawingMode === 'none') {
            if (drawRef.current) {
                map.removeControl(drawRef.current);
                drawRef.current = null;
            }
            return;
        }

        const draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: { trash: true },
            defaultMode: 'simple_select',
        });

        map.addControl(draw);
        drawRef.current = draw;

        if (drawingMode === 'polygon' || drawingMode === 'circle') {
            draw.changeMode('draw_polygon');
        } else if (drawingMode === 'corridor') {
            draw.changeMode('draw_line_string');
        }

        const handleCreate = (e: { features: GeoJSON.Feature[] }) => {
            const feature = e.features[0];
            if (!feature || !feature.geometry) return;

            if (feature.geometry.type === 'Polygon') {
                let coords = (feature.geometry.coordinates as number[][][])[0].map(c => ({
                    lat: c[1],
                    lng: c[0],
                }));
                coords = coords.slice(0, -1);

                if (coords.length > 100) {
                    const line = turf.lineString(coords.map(c => [c.lng, c.lat]));
                    const simplified = turf.simplify(line, { tolerance: 0.001, highQuality: true });
                    coords = (simplified.geometry.coordinates as number[][]).map(c => ({
                        lat: c[1],
                        lng: c[0],
                    }));
                }

                if (drawingMode === 'circle') {
                    const polygon = turf.polygon([(feature.geometry.coordinates as number[][][])[0]]);
                    const centroid = turf.centroid(polygon);
                    const [cLng, cLat] = centroid.geometry.coordinates;
                    let maxDist = 0;
                    coords.forEach(c => {
                        const d = turf.distance(
                            turf.point([cLng, cLat]),
                            turf.point([c.lng, c.lat]),
                            { units: 'meters' }
                        );
                        if (d > maxDist) maxDist = d;
                    });

                    onDrawComplete({
                        label: '',
                        type: 'circle',
                        center: { lat: cLat, lng: cLng },
                        radius: Math.round(maxDist),
                    });
                } else {
                    onDrawComplete({
                        label: '',
                        type: 'polygon',
                        points: coords,
                    });
                }
            } else if (feature.geometry.type === 'LineString') {
                const coords = (feature.geometry.coordinates as number[][]).map(c => ({
                    lat: c[1],
                    lng: c[0],
                }));

                onDrawComplete({
                    label: '',
                    type: 'sausage',
                    radius: corridorRadius,
                    points: coords,
                });
            }

            if (drawRef.current) {
                draw.deleteAll();
            }
        };

        map.on('draw.create', handleCreate);
        map.on('draw.update', handleCreate);

        return () => {
            map.off('draw.create', handleCreate);
            map.off('draw.update', handleCreate);
            if (drawRef.current) {
                try {
                    map.removeControl(drawRef.current);
                } catch { /* already removed */ }
                drawRef.current = null;
            }
        };
    }, [map, drawingMode, corridorRadius]);

    // ---------------------------------------------------------
    // 4. Cleanup on unmount
    // ---------------------------------------------------------
    useEffect(() => {
        return () => {
            if (!map) return;
            try {
                if (drawRef.current) {
                    map.removeControl(drawRef.current);
                    drawRef.current = null;
                }
                if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER);
                if (map.getLayer(OUTLINE_LAYER)) map.removeLayer(OUTLINE_LAYER);
                if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
                if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
                layersAdded.current = false;
            } catch { /* map might be destroyed */ }
        };
    }, [map]);

    return null;
}
