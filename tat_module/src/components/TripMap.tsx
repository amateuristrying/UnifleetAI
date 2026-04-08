'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

// Ensure you have this token in your .env.local as NEXT_PUBLIC_MAPBOX_TOKEN
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface TripMapProps {
    startGeom: any;
    endGeom: any;
    routeGeom?: any;
}

export default function TripMap({ startGeom, endGeom, routeGeom }: TripMapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);

    // Helper to extract [lon, lat] from GeoJSON Point
    const getLngLat = (geom: any): [number, number] | null => {
        if (!geom || !geom.coordinates) return null;
        return [geom.coordinates[0], geom.coordinates[1]];
    };

    const startPos = getLngLat(startGeom);
    const endPos = getLngLat(endGeom);

    // 1. Initialize Map
    useEffect(() => {
        if (!mapContainer.current || !startPos || !MAPBOX_TOKEN) return;
        if (map.current) return; // initialize map only once

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/traffic-day-v2',
            center: startPos,
            zoom: 10,
            attributionControl: false
        });

        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
        map.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        // Add markers when map loads
        map.current.on('load', () => {
            if (!map.current) return;

            // Start Marker (Green)
            const startEl = document.createElement('div');
            startEl.className = 'w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm ring-1 ring-green-500/20';
            new mapboxgl.Marker(startEl)
                .setLngLat(startPos)
                .addTo(map.current);

            // End Marker (Red)
            if (endPos) {
                const endEl = document.createElement('div');
                endEl.className = 'w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-sm ring-1 ring-red-500/20';
                new mapboxgl.Marker(endEl)
                    .setLngLat(endPos)
                    .addTo(map.current);
            }
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []); // Run once on mount

    // 2. Fetch or Set Route
    useEffect(() => {
        if (!startPos || !endPos) return;

        // A. Priority: Use Real Route from DB if available
        if (routeGeom) {
            const geojson = {
                type: 'Feature',
                properties: {},
                geometry: routeGeom // Assumes standard GeoJSON Geometry object
            };
            setRouteGeoJSON(geojson);
            return;
        }

        // B. Fallback: Mapbox Matching API
        if (!MAPBOX_TOKEN) return;

        const fetchRoute = async () => {
            try {
                const query = await fetch(
                    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${startPos[0]},${startPos[1]};${endPos[0]},${endPos[1]}?steps=true&geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
                );
                const json = await query.json();
                if (json.routes && json.routes[0]) {
                    const data = json.routes[0];
                    const route = data.geometry.coordinates;

                    const geojson = {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: route
                        }
                    };
                    setRouteGeoJSON(geojson);
                }
            } catch (err) {
                console.error('Error fetching route:', err);
            }
        };

        fetchRoute();
    }, [startGeom, endGeom, routeGeom]);

    // 3. Draw Route & Fit Bounds
    useEffect(() => {
        if (!map.current || !routeGeoJSON) return;

        const addRouteLayer = () => {
            if (!map.current) return;

            // Remove existing layer/source if any
            if (map.current.getSource('route')) {
                if (map.current.getLayer('route')) map.current.removeLayer('route');
                map.current.removeSource('route');
            }

            map.current.addSource('route', {
                type: 'geojson',
                data: routeGeoJSON
            });

            map.current.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#3b82f6',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            // Move markers to top (z-index hack or just re-add them, but markers are DOM elements so they sit on top of canvas anyway)
        };

        if (map.current.isStyleLoaded()) {
            addRouteLayer();
        } else {
            map.current.on('load', addRouteLayer);
        }

        // Fit bounds
        const coordinates = routeGeoJSON.geometry.coordinates;
        const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
        for (const coord of coordinates) {
            bounds.extend(coord as [number, number]);
        }

        map.current.fitBounds(bounds, {
            padding: 50
        });

    }, [routeGeoJSON]);


    if (!MAPBOX_TOKEN) {
        return (
            <div className="h-[400px] bg-slate-50 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500">
                <div className="text-center p-6">
                    <p className="font-bold mb-2">Mapbox Token Missing</p>
                    <p className="text-xs">Please add NEXT_PUBLIC_MAPBOX_TOKEN to your .env.local file.</p>
                </div>
            </div>
        );
    }

    if (!startPos || !endPos) {
        return (
            <div className="h-[400px] bg-slate-50 rounded-xl border border-gray-200 flex items-center justify-center text-gray-400">
                <p>Invalid GPS Data</p>
            </div>
        );
    }

    return (
        <div className="h-[400px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm relative">
            <div ref={mapContainer} className="w-full h-full" />
        </div>
    );
}
