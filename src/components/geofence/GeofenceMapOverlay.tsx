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
    drawingMode: 'none' | 'polygon' | 'circle';
    onDrawComplete: (payload: CreateZonePayload) => void;
    onDrawCancel: () => void;
    viewMode?: 'locked' | 'unlocked';
    drawingRadius?: number;
    onRadiusChange?: (r: number) => void;
    drawnPayload?: CreateZonePayload | null;
}

const SOURCE_ID = 'geofences-source';
const FILL_LAYER = 'geofences-fill';
const OUTLINE_LAYER = 'geofences-outline';
const LABEL_LAYER = 'geofences-labels';

const PREVIEW_SOURCE = 'circle-preview-source';
const PREVIEW_FILL = 'circle-preview-fill';
const PREVIEW_OUTLINE = 'circle-preview-outline';

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
                    id: zone.id, name: zone.name, color: zone.color,
                    category: zone.category, selected: zone.id === selectedZoneId,
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
                    id: zone.id, name: zone.name, color: zone.color,
                    category: zone.category, selected: zone.id === selectedZoneId,
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
                        id: zone.id, name: zone.name, color: zone.color,
                        category: zone.category, selected: zone.id === selectedZoneId,
                    }
                };
            }
        }
        return null;
    }).filter(Boolean);

    return { type: 'FeatureCollection' as const, features };
}

export default function GeofenceMapOverlay({
    map, zones, selectedZoneId, onSelectZone,
    drawingMode, onDrawComplete,
    onRadiusChange, drawnPayload,
}: GeofenceMapOverlayProps) {
    const drawRef = useRef<MapboxDraw | null>(null);
    const layersAdded = useRef(false);

    // Circle drawing local state via refs (no React render needed during drag)
    const isDraggingRef = useRef(false);
    const centerRef = useRef<{ lng: number, lat: number } | null>(null);
    // Track radius locally during drag (NOT via props - avoids async delay)
    const localRadiusRef = useRef(0);

    // ---------------------------------------------------------
    // 1. Add/update geofence layers for existing zones
    // ---------------------------------------------------------
    const updateLayers = useCallback(() => {
        if (!map) return;
        const geojson = buildZonesGeoJSON(zones, selectedZoneId);

        if (!map.getSource(SOURCE_ID)) {
            if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER);
            if (map.getLayer(OUTLINE_LAYER)) map.removeLayer(OUTLINE_LAYER);
            if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            map.addSource(SOURCE_ID, { type: 'geojson', data: geojson as any });

            map.addLayer({
                id: FILL_LAYER, type: 'fill', source: SOURCE_ID,
                paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.35, 0.15]
                }
            });
            map.addLayer({
                id: OUTLINE_LAYER, type: 'line', source: SOURCE_ID,
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': ['case', ['==', ['get', 'selected'], true], 3, 1.5],
                    'line-dasharray': [2, 2]
                }
            });
            map.addLayer({
                id: LABEL_LAYER, type: 'symbol', source: SOURCE_ID,
                layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-allow-overlap': false },
                paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
            });
            layersAdded.current = true;
        } else {
            const source = map.getSource(SOURCE_ID) as GeoJSONSource;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (source) source.setData(geojson as any);
        }
    }, [map, zones, selectedZoneId]);

    useEffect(() => {
        if (!map) return;
        if (map.isStyleLoaded()) updateLayers();
        const onStyleData = () => { if (map.isStyleLoaded()) updateLayers(); };
        map.on('styledata', onStyleData);
        map.on('load', updateLayers);
        return () => { map.off('styledata', onStyleData); map.off('load', updateLayers); };
    }, [map, updateLayers]);

    // ---------------------------------------------------------
    // 2. Click handler for zone selection
    // ---------------------------------------------------------
    useEffect(() => {
        if (!map || !layersAdded.current) return;
        const handleClick = (e: MapMouseEvent) => {
            if (drawingMode !== 'none') return;
            const features = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
            if (features.length > 0) { onSelectZone(features[0].properties?.id ?? null); }
            else { onSelectZone(null); }
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

    // Auto-zoom to selected zone
    useEffect(() => {
        if (!map || !selectedZoneId) return;
        const zone = zones.find(z => z.id === selectedZoneId);
        if (!zone) return;
        try {
            const fc = buildZonesGeoJSON([zone], selectedZoneId);
            const feature = fc.features[0];
            if (feature) {
                const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);
                map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 100, maxZoom: 16 });
            }
        } catch (e) { console.warn('Failed to zoom to zone:', e); }
    }, [map, selectedZoneId, zones]);

    // ---------------------------------------------------------
    // 3. MapboxDraw for POLYGON drawing
    // ---------------------------------------------------------
    useEffect(() => {
        if (!map) return;

        if (drawingMode !== 'polygon') {
            if (drawRef.current) {
                try { map.removeControl(drawRef.current); } catch { /* ok */ }
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

        // Start polygon drawing immediately
        draw.changeMode('draw_polygon');

        const handleCreate = (e: { features: GeoJSON.Feature[] }) => {
            const feature = e.features[0];
            if (!feature?.geometry) return;

            if (feature.geometry.type === 'Polygon') {
                let coords = (feature.geometry.coordinates as number[][][])[0].map(c => ({
                    lat: c[1], lng: c[0],
                }));
                coords = coords.slice(0, -1); // Remove closing point

                if (coords.length > 100) {
                    const line = turf.lineString(coords.map(c => [c.lng, c.lat]));
                    const simplified = turf.simplify(line, { tolerance: 0.001, highQuality: true });
                    coords = (simplified.geometry.coordinates as number[][]).map(c => ({
                        lat: c[1], lng: c[0],
                    }));
                }

                console.log('[GeofenceOverlay] Polygon drawn with', coords.length, 'points');
                onDrawComplete({ label: '', type: 'polygon', points: coords });
            }
            if (drawRef.current) draw.deleteAll();
        };

        map.on('draw.create', handleCreate);

        return () => {
            map.off('draw.create', handleCreate);
            if (drawRef.current) {
                try { map.removeControl(drawRef.current); } catch { /* ok */ }
                drawRef.current = null;
            }
        };
    }, [map, drawingMode, onDrawComplete]);

    // ---------------------------------------------------------
    // 4. Custom Circle Drawing (mousedown → drag → mouseup)
    // ---------------------------------------------------------
    useEffect(() => {
        if (!map) return;

        const removePreview = () => {
            try {
                if (map.getLayer(PREVIEW_OUTLINE)) map.removeLayer(PREVIEW_OUTLINE);
                if (map.getLayer(PREVIEW_FILL)) map.removeLayer(PREVIEW_FILL);
                if (map.getSource(PREVIEW_SOURCE)) map.removeSource(PREVIEW_SOURCE);
            } catch { /* ignore */ }
        };

        const showCircle = (center: { lng: number, lat: number }, radius: number) => {
            if (radius <= 10) return;
            const circle = turf.circle([center.lng, center.lat], radius / 1000, { steps: 64, units: 'kilometers' });
            if (!map.getSource(PREVIEW_SOURCE)) {
                map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: circle });
                map.addLayer({
                    id: PREVIEW_FILL, type: 'fill', source: PREVIEW_SOURCE,
                    paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.2 }
                });
                map.addLayer({
                    id: PREVIEW_OUTLINE, type: 'line', source: PREVIEW_SOURCE,
                    paint: { 'line-color': '#3b82f6', 'line-width': 2.5 }
                });
            } else {
                (map.getSource(PREVIEW_SOURCE) as GeoJSONSource).setData(circle);
            }
        };

        // When NOT in circle mode
        if (drawingMode !== 'circle') {
            // If there's a drawn circle payload, keep it visible
            if (drawnPayload?.type === 'circle' && drawnPayload.center && drawnPayload.radius) {
                showCircle(drawnPayload.center, drawnPayload.radius);
            } else {
                removePreview();
            }
            return;
        }

        // --- Circle drawing mode active ---
        map.getCanvas().style.cursor = 'crosshair';

        // If already drawn, block further drawing
        if (drawnPayload) {
            showCircle(drawnPayload.center!, drawnPayload.radius!);
            return () => { map.getCanvas().style.cursor = ''; };
        }

        const onMouseDown = (e: MapMouseEvent) => {
            if (drawnPayload) return;
            e.preventDefault();
            isDraggingRef.current = true;
            localRadiusRef.current = 0;
            centerRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
            map.dragPan.disable();
        };

        const onMouseMove = (e: MapMouseEvent) => {
            if (!isDraggingRef.current || !centerRef.current) return;
            const r = Math.round(turf.distance(
                turf.point([centerRef.current.lng, centerRef.current.lat]),
                turf.point([e.lngLat.lng, e.lngLat.lat]),
                { units: 'meters' }
            ));
            localRadiusRef.current = r;
            onRadiusChange?.(r);
            showCircle(centerRef.current, r);
        };

        const onMouseUp = () => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            map.dragPan.enable();

            const finalRadius = localRadiusRef.current;
            const center = centerRef.current;

            console.log('[GeofenceOverlay] Circle mouseup — radius:', finalRadius, 'center:', center);

            if (finalRadius > 50 && center) {
                const payload: CreateZonePayload = {
                    label: '',
                    type: 'circle',
                    center: { lat: center.lat, lng: center.lng },
                    radius: finalRadius,
                };
                console.log('[GeofenceOverlay] Calling onDrawComplete with:', payload);
                onDrawComplete(payload);
            } else {
                removePreview();
                onRadiusChange?.(0);
                centerRef.current = null;
            }
        };

        map.on('mousedown', onMouseDown);
        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);

        return () => {
            map.off('mousedown', onMouseDown);
            map.off('mousemove', onMouseMove);
            map.off('mouseup', onMouseUp);
            map.dragPan.enable();
            map.getCanvas().style.cursor = '';
        };
    }, [map, drawingMode, drawnPayload, onDrawComplete, onRadiusChange]);

    // ---------------------------------------------------------
    // 5. Cleanup on unmount
    // ---------------------------------------------------------
    useEffect(() => {
        return () => {
            if (!map) return;
            try {
                if (drawRef.current) { map.removeControl(drawRef.current); drawRef.current = null; }
                [LABEL_LAYER, OUTLINE_LAYER, FILL_LAYER].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
                if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
                [PREVIEW_OUTLINE, PREVIEW_FILL].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
                if (map.getSource(PREVIEW_SOURCE)) map.removeSource(PREVIEW_SOURCE);
                layersAdded.current = false;
            } catch { /* map might be destroyed */ }
        };
    }, [map]);

    return null;
}
