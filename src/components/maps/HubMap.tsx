'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
// @ts-ignore
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import { Layers, ListFilter, Map as MapIcon, Globe } from 'lucide-react';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface HubData {
  lat: number;
  lng: number;
  visit_count: number;
  point_type: 'origin' | 'destination';
  intensity: number;
}

export default function HubMap({ data }: { data: HubData[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite'>('dark');
  const [showOrigins, setShowOrigins] = useState(true);
  const [showDestinations, setShowDestinations] = useState(true);
  const [layerMode, setLayerMode] = useState<'clusters' | 'heatmap'>('clusters');

  // 1. Prepare GeoJSON Data (Shared)
  const geojsonData = useMemo(() => {
    if (!data) return null;

    const features = data
      .filter(d => {
        if (d.point_type === 'origin' && !showOrigins) return false;
        if (d.point_type === 'destination' && !showDestinations) return false;
        return true;
      })
      .map(d => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
        properties: {
          id: `${d.lat}-${d.lng}-${d.point_type}`, // simplistic unique id
          visit_count: Number(d.visit_count),
          point_type: d.point_type,
          // For visualization logic
          is_origin: d.point_type === 'origin' ? 1 : 0,
          is_dest: d.point_type === 'destination' ? 1 : 0,
          lat: d.lat, // Pass through for Popup
          lng: d.lng  // Pass through for Popup
        }
      }));

    return {
      type: 'FeatureCollection',
      features
    };
  }, [data, showOrigins, showDestinations]);

  // 2. Calculate Stats for Heatmap (Restored)
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    // Filter raw data directly to avoid dependency cycle if we used geojsonData extensively
    // Actually using the raw data is fine for percentiles
    const values = data.map(d => Number(d.visit_count)).sort((a, b) => a - b);
    const getPercentile = (p: number) => values[Math.floor(p * (values.length - 1))];
    return {
      p50: getPercentile(0.50), // Median
      p75: getPercentile(0.75),
      p90: getPercentile(0.90),
      max: values[values.length - 1]
    };
  }, [data]);

  // 3. Initialize Map
  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return;
    if (map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [34.8, -6.3], // Default center, maybe should fit bounds later
      zoom: 4,
      attributionControl: false,
      projection: 'globe' // Globe view at low zooms (Industry Standard)
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    const geocoder = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl: mapboxgl as any,
      marker: false,
      placeholder: 'Search hubs...',
      collapsed: true,
    });
    map.current.addControl(geocoder, 'top-left');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // 4. Update Style
  useEffect(() => {
    if (!map.current) return;
    const styleUrl = mapStyle === 'dark'
      ? 'mapbox://styles/mapbox/dark-v11'
      : 'mapbox://styles/mapbox/satellite-streets-v12';

    // Changing style removes layers/sources, so we need to reload them.
    // Mapbox preserves camera but clears data. 
    // We rely on the Data Source Effect (below) to re-add everything when style loads.
    map.current.setStyle(styleUrl);
  }, [mapStyle]);

  // 5. Handle Data & Layers (Unified)
  useEffect(() => {
    const currentMap = map.current;
    if (!currentMap || !geojsonData || !stats) return;

    const updateLayers = () => {
      // Clean up previous layers/sources to prevent conflicts when switching modes
      const layersToRemove = ['clusters', 'cluster-count', 'unclustered-point', 'hub-heatmap'];
      layersToRemove.forEach(id => {
        if (currentMap.getLayer(id)) currentMap.removeLayer(id);
      });

      const sourcesToRemove = ['hubs-source'];
      sourcesToRemove.forEach(id => {
        if (currentMap.getSource(id)) currentMap.removeSource(id);
      });

      // ------------------------------------------------------
      // MODE: CLUSTERS
      // ------------------------------------------------------
      if (layerMode === 'clusters') {
        currentMap.addSource('hubs-source', {
          type: 'geojson',
          data: geojsonData as any,
          cluster: true, // CLUSTERING ON
          clusterMaxZoom: 14,
          clusterRadius: 50,
          clusterProperties: {
            'sum_visits': ['+', ['get', 'visit_count']],
            'sum_origins': ['+', ['get', 'is_origin']],
            'sum_dests': ['+', ['get', 'is_dest']]
          }
        });

        // Layer 1: Bubbles
        currentMap.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'hubs-source',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'interpolate', ['linear'], ['get', 'sum_visits'],
              100, '#60a5fa',
              1000, '#818cf8',
              5000, '#a78bfa',
              10000, '#c084fc',
              50000, '#f472b6',
              100000, '#f97316'
            ],
            'circle-radius': [
              'interpolate', ['linear'], ['log10', ['get', 'sum_visits']],
              1, 15,
              3, 25,
              5, 40
            ],
            'circle-opacity': 0.8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 0.3
          }
        });

        // Layer 2: Counts
        currentMap.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'hubs-source',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{sum_visits}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-allow-overlap': true
          },
          paint: { 'text-color': '#ffffff' }
        });

        // Layer 3: Unclustered Points
        currentMap.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'hubs-source',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': [
              'match', ['get', 'point_type'],
              'origin', '#34d399',
              'destination', '#facc15',
              '#9ca3af'
            ],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8, 16, 12],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
          }
        });
      }

      // ------------------------------------------------------
      // MODE: HEATMAP
      // ------------------------------------------------------
      if (layerMode === 'heatmap') {
        currentMap.addSource('hubs-source', {
          type: 'geojson',
          data: geojsonData as any,
          cluster: false // CLUSTERING OFF for Heatmap accuracy
        });

        currentMap.addLayer({
          id: 'hub-heatmap',
          type: 'heatmap',
          source: 'hubs-source',
          maxzoom: 15,
          paint: {
            // Dynamic Weighting based on Statistics
            'heatmap-weight': [
              'interpolate', ['linear'], ['get', 'visit_count'],
              0, 0,
              stats.p50, 0,    // Kills the snake (Bottom 50% invisible)
              stats.p75, 0.1,  // Snake tail faint
              stats.p90, 0.5,  // Significant hubs
              stats.max, 1     // Max value
            ],
            'heatmap-intensity': 1.5,
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)',
              0.1, '#3b82f6', // Blue
              0.3, '#06b6d4', // Cyan
              0.5, '#22c55e', // Green
              0.7, '#eab308', // Yellow
              0.9, '#f97316', // Orange
              1, '#ef4444'  // Red
            ],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 9, 25],
            'heatmap-opacity': 0.8
          }
        });

        // Optional: Add points on top at high zoom? 
        // Often nice, but pure heatmap requested.
      }
    };

    if (currentMap.isStyleLoaded()) {
      updateLayers();
    } else {
      currentMap.on('style.load', updateLayers);
    }

  }, [geojsonData, mapStyle, layerMode, stats]); // Trigger on mode change

  // Re-attach listeners for Clusters (Need to be safe about duplicates)
  useEffect(() => {
    if (!map.current) return;
    const m = map.current; // capture ref

    const onClusterClick = (e: any) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      const clusterId = features[0]?.properties?.cluster_id;
      if (!clusterId) return;
      (m.getSource('hubs-source') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || !zoom) return;
        m.easeTo({ center: (features[0].geometry as any).coordinates, zoom: zoom + 1 });
      });
    };

    const onPointClick = (e: any) => {
      const coordinates = (e.features![0].geometry as any).coordinates.slice();
      const props = e.features![0].properties;

      // Deterministic Fake Data Generation based on lat/lng (Mocking Data)
      // This ensures the same hub always gets the same 'random' values
      const seed = Math.abs(props.lat * 1000 + props.lng);
      const efficiency = 85 + (seed % 14); // 85-99%
      const dwell = 2 + (seed % 50) / 10; // 2.0h - 7.0h

      const latDisplay = props.lat ? Number(props.lat).toFixed(4) : '-';
      const lngDisplay = props.lng ? Number(props.lng).toFixed(4) : '-';

      new mapboxgl.Popup({ className: 'custom-popup-class' })
        .setLngLat(coordinates)
        .setHTML(`
            <div class="p-1 min-w-[200px]">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-gray-500">${props?.point_type} HUB</span>
                <span class="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono">
                   ${latDisplay}, ${lngDisplay}
                </span>
              </div>
              <div class="text-2xl font-bold text-slate-800 flex items-baseline gap-1">
                  ${Number(props?.visit_count).toLocaleString()}
                  <span class="text-xs font-normal text-slate-500">visits</span>
              </div>

               <div class="mt-3 pt-2 border-t border-gray-100 flex gap-2">
                   <div class="flex-1 bg-blue-50 rounded p-1 text-center">
                      <div class="text-[10px] text-blue-400 font-bold uppercase">Efficiency</div>
                      <div class="text-sm font-semibold text-blue-700">${efficiency.toFixed(0)}%</div>
                   </div>
                   <div class="flex-1 bg-amber-50 rounded p-1 text-center">
                      <div class="text-[10px] text-amber-500 font-bold uppercase">Avg Dwell</div>
                      <div class="text-sm font-semibold text-amber-700">${dwell.toFixed(1)}h</div>
                   </div>
                </div>
            </div>
          `)
        .addTo(m);
    };

    // We only bind these if in cluster mode, or just bind 'em and let Mapbox ignore if layer missing
    m.on('click', 'clusters', onClusterClick);
    m.on('click', 'unclustered-point', onPointClick);

    // Hover
    const onEnter = () => { m.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { m.getCanvas().style.cursor = ''; };
    m.on('mouseenter', 'clusters', onEnter);
    m.on('mouseleave', 'clusters', onLeave);
    m.on('mouseenter', 'unclustered-point', onEnter);
    m.on('mouseleave', 'unclustered-point', onLeave);

    return () => {
      m.off('click', 'clusters', onClusterClick);
      m.off('click', 'unclustered-point', onPointClick);
      m.off('mouseenter', 'clusters', onEnter);
      m.off('mouseleave', 'clusters', onLeave);
      m.off('mouseenter', 'unclustered-point', onEnter);
      m.off('mouseleave', 'unclustered-point', onLeave);
    }
  }, [layerMode]); // Re-bind when mode changes/layers recreated

  return (
    <div className="h-[600px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm relative bg-slate-900 group">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Floating Control Panel */}
      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <div className="bg-white/90 backdrop-blur-sm shadow-md rounded-lg overflow-hidden border border-gray-200 flex flex-col">
          <button
            onClick={() => setMapStyle(prev => prev === 'dark' ? 'satellite' : 'dark')}
            className="p-2 hover:bg-gray-100 transition-colors text-slate-700 border-b border-gray-100"
            title="Toggle Satellite View"
          >
            {mapStyle === 'dark' ? <Globe size={20} /> : <MapIcon size={20} />}
          </button>
          <button
            onClick={() => setLayerMode(prev => prev === 'clusters' ? 'heatmap' : 'clusters')}
            className={`p-2 transition-colors ${layerMode === 'heatmap' ? 'text-red-500 bg-red-50' : 'text-slate-700 hover:bg-gray-100'}`}
            title="Toggle Heatmap"
          >
            <Layers size={20} />
          </button>
        </div>
      </div>

      {/* Legend / Filter Panel */}
      <div className="absolute bottom-6 left-6 bg-white/95 backdrop-blur-md shadow-lg rounded-xl border border-gray-200 p-4 w-64 animate-in slide-in-from-bottom-4">
        <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold text-sm">
          <ListFilter size={16} className="text-blue-600" />
          Hub Filters ({layerMode === 'clusters' ? 'Cluster' : 'Heatmap'})
        </div>

        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer group hover:bg-slate-50 p-1.5 rounded transition-colors -mx-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-sm ring-2 ring-emerald-100"></div>
              <span className="text-sm text-slate-600 font-medium">Origin Nodes</span>
            </div>
            <input type="checkbox" checked={showOrigins} onChange={(e) => setShowOrigins(e.target.checked)} className="accent-blue-600 h-4 w-4" />
          </label>

          <label className="flex items-center justify-between cursor-pointer group hover:bg-slate-50 p-1.5 rounded transition-colors -mx-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-yellow-400 shadow-sm ring-2 ring-yellow-100"></div>
              <span className="text-sm text-slate-600 font-medium">Destination Nodes</span>
            </div>
            <input type="checkbox" checked={showDestinations} onChange={(e) => setShowDestinations(e.target.checked)} className="accent-blue-600 h-4 w-4" />
          </label>
        </div>


        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="text-[10px] uppercase font-bold text-gray-400 mb-2">Visit Intensity</div>
          <div className="h-2 w-full rounded-full bg-gradient-to-r from-blue-400 via-purple-400 to-orange-500 shadow-inner"></div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-medium">
            <span>Low</span>
            <span>High Traffic</span>
          </div>
        </div>
      </div>
    </div>
  );
}