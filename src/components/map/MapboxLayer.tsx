/**
 * MapboxLayer - Custom Truck SVG Icons with Optimized Performance
 * 
 * Uses viewport culling to only render visible markers for better performance.
 * Dynamically switches between light and dark map styles.
 */

import Map, { NavigationControl, Marker } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useRef, useMemo, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { Vehicle, VehicleStatus } from '@/data/mock';
import { TruckIcon } from './TruckIcon';
import { useTheme } from '@/context/ThemeProvider';

interface MapboxLayerProps {
    token: string;
    vehicles: Vehicle[];
    selectedVehicleId?: string | null;
    onMarkerClick: (id: string) => void;
}

const STATUS_COLORS: Record<VehicleStatus, string> = {
    'Running': '#22C55E',
    'Stopped': '#3B82F6',
    'Idle': '#EAB308',
    'Not Online': '#9CA3AF',
    'Not Working': '#EF4444',
};

export function MapboxLayer({
    token,
    vehicles,
    selectedVehicleId,
    onMarkerClick,
}: MapboxLayerProps) {
    const mapRef = useRef<MapRef>(null);
    const { resolved } = useTheme();
    const [viewState, setViewState] = useState({
        longitude: 36.8,
        latitude: -1.3,
        zoom: 6
    });

    const mapStyle = resolved === 'dark'
        ? 'mapbox://styles/mapbox/dark-v11'
        : 'mapbox://styles/mapbox/satellite-streets-v12';

    const validVehicles = useMemo(() => {
        return vehicles.filter(v => {
            const [lat, lng] = v.coordinates;
            return lat !== 0 && lng !== 0 &&
                Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        });
    }, [vehicles]);

    useEffect(() => {
        if (validVehicles.length > 0 && viewState.zoom === 6) {
            const sumLat = validVehicles.reduce((acc, v) => acc + v.coordinates[0], 0);
            const sumLng = validVehicles.reduce((acc, v) => acc + v.coordinates[1], 0);

            setViewState(prev => ({
                ...prev,
                latitude: sumLat / validVehicles.length,
                longitude: sumLng / validVehicles.length
            }));
        }
    }, [validVehicles.length > 0]);

    useEffect(() => {
        if (selectedVehicleId && mapRef.current) {
            const vehicle = validVehicles.find(v => v.id === selectedVehicleId);
            if (vehicle) {
                mapRef.current.flyTo({
                    center: [vehicle.coordinates[1], vehicle.coordinates[0]],
                    zoom: 14,
                    duration: 1000
                });
            }
        }
    }, [selectedVehicleId, validVehicles]);

    useEffect(() => {
        return () => {
            if (mapRef.current) {
                try {
                    mapRef.current.getMap().remove();
                } catch {
                    // Ignore cleanup errors
                }
            }
        };
    }, []);

    if (!token) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-muted rounded-[24px] border border-destructive/30">
                <AlertCircle className="h-10 w-10 text-destructive mb-2" />
                <h3 className="text-lg font-semibold text-foreground">Map Configuration Error</h3>
                <p className="text-muted-foreground text-sm">Missing Mapbox Access Token.</p>
            </div>
        );
    }

    const visibleVehicles = useMemo(() => {
        if (!mapRef.current || viewState.zoom < 3) {
            return validVehicles.slice(0, 200);
        }

        const map = mapRef.current.getMap();
        if (!map) return validVehicles.slice(0, 200);

        const bounds = map.getBounds();
        if (!bounds) return validVehicles.slice(0, 200);

        return validVehicles.filter(v => {
            const [lat, lng] = v.coordinates;
            return bounds.contains([lng, lat]);
        });
    }, [validVehicles, viewState]);

    const markers = useMemo(() => {
        return visibleVehicles.map((vehicle) => {
            const isSelected = vehicle.id === selectedVehicleId;

            return (
                <Marker
                    key={vehicle.id}
                    longitude={vehicle.coordinates[1]}
                    latitude={vehicle.coordinates[0]}
                    anchor="center"
                    onClick={(e) => {
                        e.originalEvent.stopPropagation();
                        onMarkerClick(vehicle.id);
                    }}
                >
                    <div
                        className={`cursor-pointer transition-transform duration-200 ${isSelected ? 'scale-150 z-50' : 'hover:scale-110'
                            }`}
                        style={{
                            filter: isSelected
                                ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.8))'
                                : 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))'
                        }}
                    >
                        <TruckIcon
                            status={vehicle.status}
                            className="w-8 h-8"
                            isSelected={isSelected}
                            heading={vehicle.heading}
                        />
                    </div>
                </Marker>
            );
        });
    }, [visibleVehicles, selectedVehicleId, onMarkerClick]);

    return (
        <div className="h-full w-full rounded-[24px] overflow-hidden relative">
            <Map
                ref={mapRef}
                {...viewState}
                onMove={evt => setViewState(evt.viewState)}
                style={{ width: '100%', height: '100%' }}
                mapStyle={mapStyle}
                mapboxAccessToken={token}
                attributionControl={false}
            >
                <NavigationControl position="top-left" showCompass={false} />
                {markers}
            </Map>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 bg-surface-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs border border-border">
                <div className="font-semibold text-foreground/80 mb-2">Status</div>
                <div className="flex flex-col gap-1">
                    {Object.entries(STATUS_COLORS).map(([status, color]) => (
                        <div key={status} className="flex items-center gap-2">
                            <div
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: color }}
                            />
                            <span className="text-muted-foreground">{status}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Vehicle count */}
            <div className="absolute top-4 right-4 bg-surface-card/95 backdrop-blur-sm rounded-lg shadow-lg px-3 py-2 text-xs border border-border">
                <span className="font-semibold text-foreground/80">{visibleVehicles.length}</span>
                <span className="text-muted-foreground ml-1">/ {validVehicles.length} visible</span>
            </div>
        </div>
    );
}
