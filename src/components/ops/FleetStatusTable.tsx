import { useState } from 'react';
import { Download, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type NavixyTrackerState } from '@/services/navixy';
import { useTrackerStatusDuration, getVehicleStatus, type VehicleStatus } from '@/hooks/useTrackerStatusDuration';
import IdleStatusIndicator from './IdleStatusIndicator';

interface FleetStatusTableProps {
    trackerStates: Record<number, NavixyTrackerState>;
    trackerLabels: Record<number, string>;
    onVehicleClick: (id: number) => void;
    selectedVehicleId: number | null;
    sessionKey?: string;
}

export default function FleetStatusTable({
    trackerStates,
    trackerLabels,
    onVehicleClick,
    selectedVehicleId,
    sessionKey
}: FleetStatusTableProps) {
    const [filterStatus, setFilterStatus] = useState<VehicleStatus | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    // We use the hook to get durations for the status cells
    const statusDurations = useTrackerStatusDuration(trackerStates, sessionKey);

    const trackerList = Object.entries(trackerStates).map(([id, state]) => ({
        id: Number(id),
        state
    }));

    // Filter Logic
    const filteredList = trackerList.filter(({ id, state }) => {
        // 1. Status Filter
        if (filterStatus !== 'all') {
            const status = getVehicleStatus(state);
            if (status !== filterStatus) return false;
        }

        // 2. Search Filter
        if (searchQuery) {
            const label = trackerLabels[id] || '';
            const query = searchQuery.toLowerCase();
            if (!label.toLowerCase().includes(query) && !String(id).includes(query)) {
                return false;
            }
        }

        return true;
    });

    // Filter Counts
    const counts = trackerList.reduce((acc, { state }) => {
        const status = getVehicleStatus(state);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {} as Record<VehicleStatus, number>);

    const downloadLiveStatusReport = () => {
        if (!trackerList || trackerList.length === 0) return;

        const headers = ['Tracker ID', 'Label', 'Status', 'Last Update', 'Last Active', 'Speed (km/h)', 'Latitude', 'Longitude'];
        const rows = trackerList.map(({ id, state }) => {
            const status = getVehicleStatus(state);
            const label = trackerLabels[id] || `Vehicle #${id}`;
            const lastUpdate = state.last_update ? new Date(state.last_update).toLocaleString() : 'N/A';

            // Calculate Last Active (Duration since last update)
            let lastActive = 'N/A';
            if (state.last_update) {
                const diffMs = new Date().getTime() - new Date(state.last_update).getTime();
                const seconds = Math.floor(diffMs / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                if (days > 0) lastActive = `${days}d ${hours % 24}h ago`;
                else if (hours > 0) lastActive = `${hours}h ${minutes % 60}m ago`;
                else if (minutes > 0) lastActive = `${minutes}m ${seconds % 60}s ago`;
                else lastActive = `${seconds}s ago`;
            }

            return [
                id,
                `"${label}"`,
                status,
                lastUpdate,
                lastActive,
                Math.round(state.gps.speed),
                state.gps.location.lat,
                state.gps.location.lng
            ].join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `fleet_live_status_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="bg-surface-card rounded-[30px] border border-border shadow-xl overflow-hidden flex flex-col h-full">
            {/* Header Area */}
            <div className="p-4 border-b border-border/50 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-foreground flex items-center gap-2">
                        <span>Fleet Status <span className="text-xs font-normal text-muted-foreground">({filteredList.length}/{trackerList.length})</span></span>
                    </h3>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-full bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all w-32 focus:w-48 text-foreground placeholder:text-muted-foreground"
                            />
                        </div>
                        <button
                            onClick={downloadLiveStatusReport}
                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded-md transition-colors"
                            title="Download CSV Report"
                        >
                            <Download size={16} />
                        </button>
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    <button
                        onClick={() => setFilterStatus('all')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'all' ? "bg-primary text-primary-foreground border-primary" : "bg-surface-raised text-muted-foreground border-border hover:bg-muted")}
                    >
                        All
                    </button>
                    <button
                        onClick={() => setFilterStatus('moving')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'moving' ? "bg-green-500 text-white border-green-500" : "bg-surface-raised text-muted-foreground border-border hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-400 hover:border-green-500/20")}
                    >
                        Moving ({counts['moving'] || 0})
                    </button>
                    <button
                        onClick={() => setFilterStatus('stopped')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'stopped' ? "bg-red-500 text-white border-red-500" : "bg-surface-raised text-muted-foreground border-border hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/20")}
                    >
                        Stopped ({counts['stopped'] || 0})
                    </button>
                    <button
                        onClick={() => setFilterStatus('parked')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'parked' ? "bg-blue-500 text-white border-blue-500" : "bg-surface-raised text-muted-foreground border-border hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500/20")}
                    >
                        Parked ({counts['parked'] || 0})
                    </button>
                    <button
                        onClick={() => setFilterStatus('idle-stopped')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'idle-stopped' ? "bg-orange-500 text-white border-orange-500" : "bg-surface-raised text-muted-foreground border-border hover:bg-orange-500/10 hover:text-orange-600 dark:hover:text-orange-400 hover:border-orange-500/20")}
                    >
                        Idle-Stopped ({counts['idle-stopped'] || 0})
                    </button>
                    <button
                        onClick={() => setFilterStatus('idle-parked')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'idle-parked' ? "bg-purple-500 text-white border-purple-500" : "bg-surface-raised text-muted-foreground border-border hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-500/20")}
                    >
                        Idle-Parked ({counts['idle-parked'] || 0})
                    </button>
                    <button
                        onClick={() => setFilterStatus('offline')}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'offline' ? "bg-muted-foreground text-surface-card border-muted-foreground" : "bg-surface-raised text-muted-foreground border-border hover:bg-muted")}
                    >
                        Offline ({counts['offline'] || 0})
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 p-3 custom-scrollbar">
                {filteredList.length === 0 && (
                    <div className="text-center text-muted-foreground py-10 text-sm">
                        No assets match the current filter.
                    </div>
                )}
                {filteredList.map(({ id, state }) => (
                    <div
                        key={id}
                        onClick={() => onVehicleClick(id)}
                        className={cn(
                            "p-3 rounded-xl border transition-all cursor-pointer",
                            selectedVehicleId === id
                                ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
                                : "border-border/50 hover:border-primary/50 hover:shadow-md bg-surface-raised/50"
                        )}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <div className="font-bold text-foreground text-sm">{trackerLabels[id] || `Vehicle #${id}`}</div>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                    Lat: {state.gps.location.lat.toFixed(4)}, Lng: {state.gps.location.lng.toFixed(4)}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-lg font-mono font-bold text-foreground leading-none">{Math.round(state.gps.speed)} <span className="text-[10px] font-sans text-muted-foreground font-medium">km/h</span></div>
                            </div>
                        </div>
                        <IdleStatusIndicator
                            status={getVehicleStatus(state)}
                            lastUpdate={state.last_update}
                            statusStartTime={statusDurations[id]?.startTime}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
