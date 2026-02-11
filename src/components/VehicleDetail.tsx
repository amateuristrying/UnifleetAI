import { useState, useEffect } from "react";
import { X, Clock, MapPin, Gauge, Activity } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { NavixyService } from "@/services/navixy";
import type { NavixyEvent, NavixyTrackerState } from "@/services/navixy";

interface VehicleDetailProps {
    vehicleId: number;
    vehicleName: string;
    trackerState: NavixyTrackerState | null;
    onClose: () => void;
}

export function VehicleDetail({ vehicleId, vehicleName, trackerState, onClose }: VehicleDetailProps) {
    const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'sensors'>('overview');
    const [events, setEvents] = useState<NavixyEvent[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(false);

    useEffect(() => {
        if (activeTab === 'history' && vehicleId) {
            const fetchHistory = async () => {
                setLoadingEvents(true);
                const sessionKey = import.meta.env.VITE_NAVIXY_SESSION_KEY;
                if (sessionKey) {
                    try {
                        const data = await NavixyService.getTrackerEvents(vehicleId, sessionKey);
                        setEvents(data || []);
                    } catch (e) {
                        console.error("Failed to fetch events", e);
                    }
                }
                setLoadingEvents(false);
            };
            fetchHistory();
        }
    }, [activeTab, vehicleId]);

    if (!trackerState) return null;

    const getStatusColor = (status: string) => {
        if (status === 'moving') return 'bg-[#9ef01a] text-black';
        if (status === 'stopped') return 'bg-red-500 text-white';
        if (status === 'offline') return 'bg-gray-400 text-white';
        return 'bg-orange-400 text-white';
    }

    return (
        <div className="absolute top-4 right-4 bottom-4 w-[380px] bg-surface-card rounded-[24px] shadow-2xl z-50 flex flex-col overflow-hidden border border-border animate-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="p-5 border-b border-border flex justify-between items-start bg-muted/50">
                <div>
                    <h2 className="text-xl font-bold text-foreground leading-tight mb-1">{vehicleName}</h2>
                    <div className="flex items-center gap-2">
                        <Badge className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide border-none ${getStatusColor(trackerState.movement_status || 'offline')}`}>
                            {trackerState.movement_status || 'Unknown'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">ID: {vehicleId}</span>
                    </div>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 -mt-1 -mr-2 text-muted-foreground hover:text-foreground">
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                {['overview', 'history', 'sensors'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === tab
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 bg-surface-card">

                {/* OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className="flex flex-col gap-6">
                        {/* Speed Gauge */}
                        <div className="flex items-center gap-4 bg-primary/5 p-4 rounded-2xl border border-primary/10">
                            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                <Gauge className="h-6 w-6" />
                            </div>
                            <div>
                                <div className="text-sm text-muted-foreground font-medium">Current Speed</div>
                                <div className="text-2xl font-bold text-foreground">{trackerState.gps.speed.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">km/h</span></div>
                            </div>
                        </div>

                        {/* Details Grid */}
                        <div className="grid grid-cols-[24px_1fr] gap-x-3 gap-y-6">
                            <Clock className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Last Update</div>
                                <div className="text-sm text-foreground/80 font-medium">{new Date(trackerState.last_update).toLocaleString()}</div>
                            </div>

                            <MapPin className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Location</div>
                                <div className="text-sm text-foreground/80 font-medium">
                                    {trackerState.gps.location.lat.toFixed(5)}, {trackerState.gps.location.lng.toFixed(5)}
                                </div>
                                <div className="text-xs text-primary mt-1 cursor-pointer hover:underline">View on Google Maps</div>
                            </div>

                            <Activity className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">Connection</div>
                                <div className="text-sm text-foreground/80 font-medium capitalize">{trackerState.connection_status || 'Unknown'}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* HISTORY TAB */}
                {activeTab === 'history' && (
                    <div className="flex flex-col gap-4">
                        {loadingEvents ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">Loading events...</div>
                        ) : events.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">No recent events found.</div>
                        ) : (
                            <div className="relative border-l-2 border-border ml-3 space-y-6 pl-6 py-2">
                                {events.map((event, idx) => (
                                    <div key={idx} className="relative">
                                        <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-primary border-2 border-surface-card ring-1 ring-border" />
                                        <div className="text-xs text-muted-foreground mb-0.5">{new Date(event.time).toLocaleTimeString()}</div>
                                        <div className="text-sm font-medium text-foreground">{event.message || event.type}</div>
                                        <div className="text-xs text-muted-foreground mt-0.5 bg-muted inline-block px-1.5 py-0.5 rounded">
                                            {new Date(event.time).toLocaleDateString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* SENSORS TAB */}
                {activeTab === 'sensors' && (
                    <div className="flex flex-col gap-3">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Digital Inputs</div>
                        <div className="grid grid-cols-2 gap-3">
                            {trackerState.inputs?.map((isActive, idx) => (
                                <div key={idx} className={`p-3 rounded-xl border flex items-center gap-3 ${isActive ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-muted border-border opacity-60'}`}>
                                    <div className={`h-2.5 w-2.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                    <span className="text-sm font-medium text-foreground/80">Input {idx + 1}</span>
                                </div>
                            ))}
                            {(!trackerState.inputs || trackerState.inputs.length === 0) && (
                                <div className="col-span-2 text-center text-muted-foreground text-sm italic py-4">No sensor inputs detected</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
