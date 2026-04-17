import { MapAdapter } from './map/MapAdapter'
import type { Vehicle } from '@/data/mock';

interface MapMainProps {
    vehicles?: Vehicle[];
    selectedVehicleId?: string | null;
    onMarkerClick?: (id: string) => void;
    autoFit?: boolean;
}

export function MapMain({ vehicles, selectedVehicleId, onMarkerClick, autoFit }: MapMainProps) {
    return (
        <MapAdapter
            vehicles={vehicles}
            selectedVehicleId={selectedVehicleId}
            onMarkerClick={onMarkerClick}
            autoFit={autoFit}
        />
    )
}
