import { MapAdapter } from './map/MapAdapter'
import type { Vehicle } from '@/data/mock';

interface MapMainProps {
    vehicles?: Vehicle[];
    selectedVehicleId?: string | null;
    onMarkerClick?: (id: string) => void;
}

export function MapMain({ vehicles, selectedVehicleId, onMarkerClick }: MapMainProps) {
    return (
        <MapAdapter
            vehicles={vehicles}
            selectedVehicleId={selectedVehicleId}
            onMarkerClick={onMarkerClick}
        />
    )
}
