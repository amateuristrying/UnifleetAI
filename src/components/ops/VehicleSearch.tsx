import { useState, useMemo } from 'react';
import { Search, Truck, MapPin, ChevronRight, Wifi, WifiOff } from 'lucide-react';
import type { NavixyTrackerState } from '@/services/navixy';
import { getVehicleStatus } from '@/hooks/useTrackerStatusDuration';

interface VehicleSearchProps {
    trackerLabels: Record<number, string>;
    trackerStates: Record<number, NavixyTrackerState>;
    region: 'TZ' | 'ZM';
    onRegionChange: (region: 'TZ' | 'ZM') => void;
    onSelectVehicle: (trackerId: number) => void;
}

export default function VehicleSearch({
    trackerLabels,
    trackerStates,
    region,
    onRegionChange,
    onSelectVehicle
}: VehicleSearchProps) {
    const [searchQuery, setSearchQuery] = useState('');

    // Get total count of trackers
    const totalTrackers = Object.keys(trackerLabels).length;

    // Filter vehicles based on search query
    const searchResults = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        if (!q) return [];

        return Object.entries(trackerLabels)
            .filter(([_, label]) => label.toLowerCase().includes(q))
            .slice(0, 15) // Limit to 15 results
            .map(([id, label]) => {
                const trackerId = Number(id);
                const state = trackerStates[trackerId];
                const status = state ? getVehicleStatus(state) : 'offline';
                const speed = state?.gps?.speed || 0;

                return {
                    id: trackerId,
                    label,
                    status,
                    speed,
                    isOnline: state?.connection_status !== 'offline'
                };
            });
    }, [searchQuery, trackerLabels, trackerStates]);

    // Get status styling
    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'moving':
                return { bg: 'bg-green-500/10', text: 'text-green-600', dot: 'bg-green-500' };
            case 'stopped':
                return { bg: 'bg-amber-500/10', text: 'text-amber-600', dot: 'bg-amber-500' };
            case 'parked':
                return { bg: 'bg-blue-500/10', text: 'text-blue-600', dot: 'bg-blue-500' };
            case 'idle-stopped':
            case 'idle-parked':
                return { bg: 'bg-orange-500/10', text: 'text-orange-600', dot: 'bg-orange-500' };
            default:
                return { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-slate-400' };
        }
    };

    return (
        <div className="flex flex-col h-full bg-surface-card rounded-2xl border border-border shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2 mb-4">
                    <Truck size={18} className="text-primary" />
                    <h2 className="text-sm font-black text-foreground uppercase tracking-tight">Fleet Monitoring</h2>
                </div>

                {/* Region Toggle */}
                <div className="flex bg-muted p-1 rounded-xl border border-border mb-4 shadow-inner">
                    <button
                        onClick={() => onRegionChange('TZ')}
                        className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${region === 'TZ'
                            ? 'bg-surface-raised text-primary shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        TZ Ops
                    </button>
                    <button
                        onClick={() => onRegionChange('ZM')}
                        className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${region === 'ZM'
                            ? 'bg-surface-raised text-emerald-600 shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        ZM Ops
                    </button>
                </div>

                {/* Search Input */}
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search vehicle number or name..."
                        className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted-foreground/50"
                        autoFocus
                    />
                </div>
            </div>

            {/* Results Area */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {searchQuery.trim() === '' ? (
                    <div className="text-center py-12 flex flex-col items-center justify-center h-full">
                        <div className="p-4 bg-muted rounded-full mb-4">
                            <Search className="text-muted-foreground opacity-30" size={32} />
                        </div>
                        <p className="text-sm font-bold text-foreground">Fleet Database</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mt-1">
                            {totalTrackers} ASSETS IN {region} OPS
                        </p>
                    </div>
                ) : searchResults.length === 0 ? (
                    <div className="text-center py-12">
                        <Truck className="mx-auto text-muted-foreground/30 mb-3" size={32} />
                        <p className="text-sm font-bold text-foreground">No matches found</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Try searching for ID or name
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest px-1 mb-3">
                            Search Results ({searchResults.length})
                        </p>
                        {searchResults.map((vehicle) => {
                            const statusStyle = getStatusStyle(vehicle.status);
                            return (
                                <button
                                    key={vehicle.id}
                                    onClick={() => onSelectVehicle(vehicle.id)}
                                    className="w-full h-[72px] flex items-center justify-between p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all group text-left"
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className={`w-2 h-2 rounded-full ${statusStyle.dot} ${vehicle.status === 'moving' ? 'animate-pulse' : ''}`}></div>

                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-foreground truncate group-hover:text-primary transition-colors">
                                                {vehicle.label}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[9px] px-2 py-0.5 rounded font-black uppercase ${statusStyle.bg} ${statusStyle.text}`}>
                                                    {vehicle.status.replace('-', ' ')}
                                                </span>
                                                {vehicle.status === 'moving' && (
                                                    <span className="text-[10px] text-muted-foreground font-mono font-bold">
                                                        {Math.round(vehicle.speed)} KM/H
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {vehicle.isOnline ? (
                                            <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center">
                                                <Wifi size={10} className="text-green-500" />
                                            </div>
                                        ) : (
                                            <div className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center">
                                                <WifiOff size={10} className="text-red-500" />
                                            </div>
                                        )}
                                        <ChevronRight size={16} className="text-muted-foreground opacity-30 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border bg-muted/20">
                <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    <MapPin size={10} />
                    <span>Select for Live View & Sharing</span>
                </div>
            </div>
        </div>
    );
}
