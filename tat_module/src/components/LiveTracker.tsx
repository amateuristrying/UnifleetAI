'use client';

import React, { useState, useEffect } from 'react';
import { useNavixyRealtime } from '../hooks/useNavixyRealtime';
import { useFleetAnalysis } from '../hooks/useFleetAnalysis';
import { useTrackerStatusDuration, getVehicleStatus, VehicleStatus } from '../hooks/useTrackerStatusDuration';
import { useGeofences } from '../hooks/useGeofences';
import RealtimeMap from './RealtimeMap';
import RealtimeInsights from './RealtimeInsights';
import GeofencePanel from './GeofencePanel';
import IdleStatusIndicator from './IdleStatusIndicator';
import NavixyDataInspector from './NavixyDataInspector';
import { Loader2, Download } from 'lucide-react';
import { NavixyService } from '../services/navixy';
import { cn } from '@/lib/utils';
import type { CreateZonePayload } from '../types/geofence';

export default function LiveTracker() {
    const [trackerIds, setTrackerIds] = useState<number[]>([]);
    const [trackerLabels, setTrackerLabels] = useState<Record<number, string>>({});

    // Filter State
    const [filterStatus, setFilterStatus] = useState<VehicleStatus | 'all'>('all');

    // State for Drill-Down View
    const [currentView, setCurrentView] = useState<'summary' | 'traffic' | 'geofences'>('summary');
    const [focusedAction, setFocusedAction] = useState<any | null>(null);
    const [focusedId, setFocusedId] = useState<number | null>(null);

    // Geofence Drawing State
    const [drawingMode, setDrawingMode] = useState<'none' | 'polygon' | 'corridor' | 'circle'>('none');
    const [drawnPayload, setDrawnPayload] = useState<CreateZonePayload | null>(null);

    const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;

    useEffect(() => {
        if (!sessionKey || sessionKey === 'replace_with_your_session_key') return;

        const initTrackers = async () => {
            try {
                const list = await NavixyService.listTrackers(sessionKey);
                if (list && list.length > 0) {
                    // @ts-ignore
                    const ids = list.map((t: any) => t.source.id || t.id);
                    // @ts-ignore
                    const labels = list.reduce((acc: any, t: any) => {
                        acc[t.source.id || t.id] = t.label;
                        return acc;
                    }, {} as Record<number, string>);

                    console.log('Loaded Trackers:', ids.length);
                    setTrackerIds(ids);
                    setTrackerLabels(labels);
                } else {
                    console.warn('No trackers found or failed to list trackers.');
                }
            } catch (err) {
                console.error('Failed to init trackers:', err);
            }
        };
        initTrackers();
    }, [sessionKey]);


    const { trackerStates, loading } = useNavixyRealtime(trackerIds, sessionKey);
    const analysis = useFleetAnalysis(trackerStates);
    const statusDurations = useTrackerStatusDuration(trackerStates, sessionKey);

    // Initialize Geofence Hook
    const {
        zones, selectedZoneId, setSelectedZoneId,
        createZone, deleteZone
    } = useGeofences(trackerStates, sessionKey, trackerIds);

    const trackerList = Object.entries(trackerStates).map(([id, state]) => ({
        id: Number(id),
        state
    }));

    // Filter Logic
    const filteredList = trackerList.filter(({ id, state }) => {
        if (filterStatus === 'all') return true;
        const status = getVehicleStatus(state);
        return status === filterStatus;
    });

    const filteredTrackerStates = filteredList.reduce((acc, { id, state }) => {
        acc[id] = state;
        return acc;
    }, {} as Record<number, any>);

    // Filter Counts
    const counts = trackerList.reduce((acc, { state }) => {
        const status = getVehicleStatus(state);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {} as Record<VehicleStatus, number>);


    if (!sessionKey || sessionKey === 'replace_with_your_session_key') {
        return (
            <div className="p-6 bg-red-50 text-red-700 rounded-lg border border-red-200">
                <strong>Configuration Error:</strong> Please set a valid <code>NEXT_PUBLIC_NAVIXY_SESSION_KEY</code> in your <code>.env.local</code> file.<br />
                <span className="text-sm mt-2 block">Current value seems to be the default placeholder: "{sessionKey}"</span>
            </div>
        );
    }

    // Geofence Handlers
    const handleStartDrawing = (mode: 'polygon' | 'corridor' | 'circle') => {
        setDrawingMode(mode);
        setDrawnPayload(null);
    };

    const handleDrawComplete = (payload: CreateZonePayload) => {
        setDrawnPayload(payload);
        setDrawingMode('none');
    };

    const handleCancelDrawing = () => {
        setDrawingMode('none');
        setDrawnPayload(null);
    };

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
                `"${label}"`, // Quote label to handle commas
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
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Live Fleet Monitoring</h2>
                <div className="flex items-center gap-2">
                    {loading && <Loader2 className="animate-spin text-blue-500" size={20} />}
                    {!loading && <div className="flex items-center gap-1 text-xs text-green-600 font-medium"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live System Active</div>}
                </div>
            </div>

            {/* SUMMARY VIEW: Insights + Map + List */}
            {currentView === 'summary' && (
                <>
                    <RealtimeInsights
                        analysis={analysis}
                        currentView={currentView}
                        onViewChange={setCurrentView}
                        onActionSelect={setFocusedAction}
                    />

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="lg:col-span-2">
                            <RealtimeMap
                                trackers={filteredTrackerStates}
                                trackerLabels={trackerLabels}
                                analysis={analysis}
                                showDelays={false}
                                focusedTrackerId={focusedId}
                                zones={zones} // Pass zones to map even in summary for visibility
                                selectedZoneId={selectedZoneId}
                                onSelectZone={setSelectedZoneId}
                            />
                        </div>
                        {/* Status Side Panel */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 overflow-hidden flex flex-col h-[600px]">
                            <h3 className="font-bold text-slate-700 mb-4 flex items-center justify-between">
                                <span>Fleet Status <span className="text-xs font-normal text-slate-400">({filteredList.length}/{trackerList.length})</span></span>
                                <button
                                    onClick={downloadLiveStatusReport}
                                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                    title="Download CSV Report"
                                >
                                    <Download size={16} />
                                </button>
                            </h3>

                            {/* Filter Tabs */}
                            <div className="flex gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
                                <button
                                    onClick={() => setFilterStatus('all')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'all' ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}
                                >
                                    All
                                </button>
                                <button
                                    onClick={() => setFilterStatus('moving')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'moving' ? "bg-green-500 text-white border-green-500" : "bg-white text-slate-600 border-slate-200 hover:bg-green-50")}
                                >
                                    Moving ({counts['moving'] || 0})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('stopped')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'stopped' ? "bg-red-500 text-white border-red-500" : "bg-white text-slate-600 border-slate-200 hover:bg-red-50")}
                                >
                                    Stopped ({counts['stopped'] || 0})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('parked')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'parked' ? "bg-blue-500 text-white border-blue-500" : "bg-white text-slate-600 border-slate-200 hover:bg-blue-50")}
                                >
                                    Parked ({counts['parked'] || 0})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('idle-stopped')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'idle-stopped' ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-600 border-slate-200 hover:bg-orange-50")}
                                >
                                    Idle-Stopped ({counts['idle-stopped'] || 0})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('idle-parked')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'idle-parked' ? "bg-purple-500 text-white border-purple-500" : "bg-white text-slate-600 border-slate-200 hover:bg-purple-50")}
                                >
                                    Idle-Parked ({counts['idle-parked'] || 0})
                                </button>
                                <button
                                    onClick={() => setFilterStatus('offline')}
                                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border", filterStatus === 'offline' ? "bg-slate-400 text-white border-slate-400" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100")}
                                >
                                    Offline ({counts['offline'] || 0})
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                                {filteredList.length === 0 && !loading && (
                                    <div className="text-center text-slate-400 py-10 text-sm">
                                        No assets match the current filter.
                                    </div>
                                )}
                                {filteredList.map(({ id, state }) => (
                                    <div
                                        key={id}
                                        onClick={() => setFocusedId(id)}
                                        className={cn(
                                            "p-3 rounded-lg border transition-all cursor-pointer",
                                            focusedId === id
                                                ? "border-blue-500 bg-blue-50 shadow-md ring-1 ring-blue-500/20"
                                                : "border-gray-100 hover:border-blue-200 hover:shadow-md bg-slate-50/50"
                                        )}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <div className="font-bold text-slate-800">{trackerLabels[id]} <span className="text-slate-400 font-normal text-xs">(#{id})</span></div>
                                                <div className="text-xs text-slate-500 flex items-center gap-1">
                                                    Lat: {state.gps.location.lat.toFixed(4)}, Lng: {state.gps.location.lng.toFixed(4)}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-lg font-mono font-bold text-slate-700">{Math.round(state.gps.speed)} <span className="text-sm font-sans text-slate-400">km/h</span></div>
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
                    </div>
                </>
            )}

            {/* DRILL DOWN VIEW: Split Screen (Map + Interactive List/Panel) */}
            {currentView !== 'summary' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px] animate-in slide-in-from-right duration-300">
                    {/* Left Panel: The Interactive List OR Geofence Panel */}
                    <div className="h-full">
                        {currentView === 'geofences' ? (
                            <GeofencePanel
                                zones={zones}
                                selectedZoneId={selectedZoneId}
                                trackerLabels={trackerLabels}
                                onSelectZone={setSelectedZoneId}
                                onCreateZone={createZone}
                                onDeleteZone={deleteZone}
                                onStartDrawing={handleStartDrawing}
                                onCancelDrawing={handleCancelDrawing}
                                drawnPayload={drawnPayload}
                            />
                        ) : (
                            <RealtimeInsights
                                analysis={analysis}
                                currentView={currentView}
                                onViewChange={setCurrentView}
                                onActionSelect={setFocusedAction}
                            />
                        )}
                    </div>

                    {/* Right Panel: The Interactive Map */}
                    <div className="lg:col-span-2 h-full">
                        <RealtimeMap
                            trackers={filteredTrackerStates}
                            trackerLabels={trackerLabels}
                            analysis={analysis}
                            showDelays={currentView === 'traffic'} // Show Alerts only in traffic view
                            focusedAction={focusedAction} // Zoom to selection
                            focusedTrackerId={focusedId}
                            zones={zones}
                            selectedZoneId={selectedZoneId}
                            onSelectZone={setSelectedZoneId}
                            drawingMode={drawingMode}
                            onDrawComplete={handleDrawComplete}
                            onDrawCancel={handleCancelDrawing}
                        />
                    </div>
                </div>
            )}

            {/* Data Inspector - Floating Debug Tool */}
            <NavixyDataInspector trackerStates={trackerStates} trackerLabels={trackerLabels} />
        </div>
    );
}
