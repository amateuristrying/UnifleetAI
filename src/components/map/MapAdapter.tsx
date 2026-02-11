import { MapboxLayer } from './MapboxLayer';
import { VEHICLES as MOCK_VEHICLES } from '@/data/mock';
import type { Vehicle } from '@/data/mock';

interface MapAdapterProps {
    vehicles?: Vehicle[];
    selectedVehicleId?: string | null;
    onMarkerClick?: (id: string) => void;
}

export function MapAdapter({ vehicles, selectedVehicleId, onMarkerClick }: MapAdapterProps) {
    // 1. Environmental Check
    const token = import.meta.env.VITE_MAPBOX_TOKEN;

    // Fallback to mock if vehicles is undefined (allows standalone map testing)
    const effectiveVehicles = vehicles || MOCK_VEHICLES;

    // 2. Error UI if no token
    if (!token) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-gray-50 rounded-[24px] border border-red-200">
                <h3 className="text-lg font-semibold text-gray-800">Map Configuration Error</h3>
                <p className="text-gray-500 text-sm">Missing Mapbox Access Token.</p>
            </div>
        );
    }

    // 3. Render Layer (simplified - no more hover/popup logic needed here)
    return (
        <MapboxLayer
            token={token}
            vehicles={effectiveVehicles}
            selectedVehicleId={selectedVehicleId}
            onMarkerClick={onMarkerClick || (() => { })}
        />
    );
}
