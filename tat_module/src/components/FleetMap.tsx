'use client';

import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Ensure you have this in .env.local
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface VehicleStatus {
  tracker_id: number;
  tracker_name: string;
  tracker_brand: string;
  lat: number;
  lng: number;
  last_address: string;
  last_seen: string;
  status: 'Active' | 'Idle' | 'Offline';
}

interface FleetMapProps {
  vehicles: VehicleStatus[];
}

export default function FleetMap({ vehicles }: FleetMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainer.current || !MAPBOX_TOKEN) return;
    if (map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/traffic-day-v2', // Consistent style
      center: [28.6, -12.9], // Default center (Zambia/Tanzania)
      zoom: 2, // Start zoomed out to see the globe effect
      projection: 'globe', // Enable 3D Globe
      attributionControl: false
    });

    // Add Atmosphere for better space look
    map.current.on('style.load', () => {
      map.current?.setFog({
        'color': 'rgb(186, 210, 235)', // Lower atmosphere
        'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
        'horizon-blend': 0.02, // Atmosphere thickness (default 0.2 at low zooms)
        'space-color': 'rgba(7, 7, 18, 1)', // Background space color
        'star-intensity': 0.35 // Background star brightness (default 0.35 at low zooms )
      });
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // 2. Update Markers when vehicles change
  useEffect(() => {
    if (!map.current || !vehicles || vehicles.length === 0) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();

    vehicles.forEach((v) => {
      if (!v.lat || !v.lng) return;

      // Create Custom Marker Element
      const el = document.createElement('div');

      // Determine Color based on Status
      let colorClass = 'bg-gray-400 ring-gray-400/30'; // Offline
      if (v.status === 'Active') colorClass = 'bg-green-500 ring-green-500/30';
      if (v.status === 'Idle') colorClass = 'bg-yellow-500 ring-yellow-500/30';

      el.className = `w-4 h-4 rounded-full border-2 border-white shadow-md ring-4 ${colorClass} cursor-pointer hover:scale-110 transition-transform`;

      // Create Popup HTML
      const popupHTML = `
        <div class="p-1 min-w-[180px]">
          <h3 class="font-bold text-sm text-gray-900">${v.tracker_name}</h3>
          <p class="text-xs text-gray-500 font-medium">${v.tracker_brand}</p>
          <div class="flex items-center gap-2 mt-2 mb-1">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border 
              ${v.status === 'Active' ? 'bg-green-50 text-green-700 border-green-200' :
          v.status === 'Idle' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
            'bg-gray-50 text-gray-600 border-gray-200'}">
              ${v.status}
            </span>
            <span class="text-[10px] text-gray-400">
              ${new Date(v.last_seen).toLocaleDateString()}
            </span>
          </div>
          <p class="text-[10px] text-gray-500 border-t pt-1 mt-1 truncate">
            ${v.last_address || 'Unknown Location'}
          </p>
        </div>
      `;

      // Add to Map
      const marker = new mapboxgl.Marker(el)
        .setLngLat([v.lng, v.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(popupHTML))
        .addTo(map.current!);

      markersRef.current.push(marker);
      bounds.extend([v.lng, v.lat]);
    });

    // Fit Bounds (Auto-zoom to show all trucks)
    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, {
        padding: 80,
        maxZoom: 14,
        duration: 1000 // Smooth animation
      });
    }

  }, [vehicles]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="h-full w-full bg-slate-50 flex items-center justify-center text-gray-400">
        Mapbox Token Missing
      </div>
    );
  }

  return (
    <div className="h-[600px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm relative bg-slate-100">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Legend Overlay */}
      <div className="absolute bottom-6 left-4 bg-white/90 backdrop-blur-sm p-3 rounded-lg shadow-md text-xs z-10 border border-gray-200">
        <div className="font-semibold mb-2 text-gray-700">Fleet Status ({vehicles.length})</div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span>Active (Last 4h)</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
          <span>Idle (24h)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gray-400"></div>
          <span>Offline</span>
        </div>
      </div>
    </div>
  );
}