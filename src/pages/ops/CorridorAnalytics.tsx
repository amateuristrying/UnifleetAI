import { useState, useEffect } from 'react';
import SecurityMap from '@/components/maps/SecurityMap';
import type { Vehicle } from '@/types/telemetry';
import { NavixyService } from '@/services/navixy';
import { useOps } from '@/context/OpsContext';

export default function CorridorAnalytics() {
    const { ops } = useOps();
    const sessionKey = ops === 'zambia'
        ? import.meta.env.VITE_NAVIXY_SESSION_KEY_ZM
        : import.meta.env.VITE_NAVIXY_SESSION_KEY_TZ;

    // Basic state for the map props logic
    const [dateRange] = useState({
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 Days for historical patterns
        end: new Date().toISOString()
    });
    const [filters] = useState({ brands: [], vehicles: [] });
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);

    useEffect(() => {
        if (!sessionKey) return;
        const fetchVehicles = async () => {
            try {
                const list = await NavixyService.listTrackers(sessionKey);
                if (list && Array.isArray(list)) {
                    const mapped: Vehicle[] = list.map((t: any) => ({
                        tracker_id: t.id,
                        tracker_name: t.label || t.name || `Vehicle ${t.id}`,
                        tracker_brand: t.source?.vehicle_type_id || 'Unknown'
                    }));
                    setVehicles(mapped);
                }
            } catch (err) {
                console.error("Failed to fetch vehicles for analytics", err);
            }
        };
        fetchVehicles();
    }, [sessionKey]);

    return (
        <div className="flex flex-1 flex-col h-full w-full overflow-hidden px-6 pt-8 pb-3">
            <div className="flex-1 h-full w-full rounded-[24px] overflow-hidden shadow-lg border border-border relative bg-surface-card">
                <SecurityMap
                    dateRange={dateRange}
                    filters={filters}
                    vehicles={vehicles}
                    sessionKey={sessionKey}
                />
            </div>
        </div>
    );
}
