'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
    MapPin, Plus, Trash2, Clock, ArrowLeft,
    Anchor, Files, Warehouse, Truck, Target,
    Hexagon, Circle, Share2,
} from 'lucide-react';
import type { Geofence, CreateZonePayload, GeofenceCategory } from '@/types/geofence';

type PanelView = 'list' | 'create' | 'detail';

interface GeofencePanelProps {
    zones: Geofence[];
    selectedZoneId: number | null;

    trackerLabels: Record<number, string>;
    onSelectZone: (zoneId: number | null) => void;
    onCreateZone: (payload: CreateZonePayload) => Promise<number | null>;
    onDeleteZone?: (zoneId: number) => Promise<boolean>; // Made optional to match existing prop usage if any
    onStartDrawing: (mode: 'polygon' | 'circle') => void;
    onCancelDrawing: () => void;
    drawnPayload?: CreateZonePayload | null;
    monitoredZoneIds?: number[];
    onMonitorZones?: (zoneIds: number[]) => void;
    region?: 'TZ' | 'ZM';
    onRefresh?: () => void;
    viewMode?: 'locked' | 'unlocked';
    externalViewMode?: 'list' | 'create' | 'detail';
    onViewModeChange?: (mode: 'list' | 'create' | 'detail') => void;
    drawingRadius?: number;
    onRadiusChange?: (radius: number) => void;
}



const categoryIcons: Record<GeofenceCategory, React.ReactNode> = {
    port: <Anchor size={14} className="text-blue-600" />,
    border: <Files size={14} className="text-amber-600" />,
    warehouse: <Warehouse size={14} className="text-purple-600" />,
    mining: <Truck size={14} className="text-slate-600" />,
    depot: <Target size={14} className="text-emerald-600" />,
    custom: <MapPin size={14} className="text-sky-600" />,
};

const categoryLabels: Record<GeofenceCategory, string> = {
    port: 'Port / Terminal',
    border: 'Border / Customs',
    warehouse: 'Warehouse / Hub',
    mining: 'Mining Site',
    depot: 'Depot',
    custom: 'Custom Zone',
};

export default function GeofencePanel({
    zones, selectedZoneId, trackerLabels,
    onSelectZone, onCreateZone, onDeleteZone, onStartDrawing, onCancelDrawing,
    drawnPayload, region, externalViewMode, onViewModeChange, drawingRadius, onRadiusChange
}: GeofencePanelProps) {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [view, setView] = useState<PanelView>('list');

    // Sync external view mode
    useEffect(() => {
        if (externalViewMode) setView(externalViewMode);
    }, [externalViewMode]);

    // Update parent on view change
    const updateView = (v: PanelView) => {
        setView(v);
        onViewModeChange?.(v);
    };

    const [createForm, setCreateForm] = useState({
        name: '',
        category: 'custom' as GeofenceCategory,
        type: 'polygon' as 'polygon' | 'circle',
    });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Force re-render every minute for duration updates
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(timer);
    }, []);

    const selectedZone = zones.find(z => z.id === selectedZoneId);

    useEffect(() => {
        if (selectedZoneId && view === 'list') {
            updateView('detail');
        }
    }, [selectedZoneId, view]); // Added view to dependency array

    const handleZoneClick = (zoneId: number) => {
        onSelectZone(zoneId);
        updateView('detail');
    };

    const handleDelete = async (zoneId: number) => {
        if (onDeleteZone) {
            setDeleting(true);
            await onDeleteZone(zoneId);
            setDeleting(false);
            updateView('list');
        }
    };

    const handleStartDraw = () => {
        onStartDrawing(createForm.type);
    };

    const handleSaveZone = async () => {
        console.log('[GeofencePanel] handleSaveZone called');
        console.log('[GeofencePanel] name:', createForm.name, 'drawnPayload:', drawnPayload);

        if (!createForm.name.trim()) {
            console.warn('[GeofencePanel] No name — button should be disabled');
            return;
        }
        if (!drawnPayload) {
            console.warn('[GeofencePanel] No drawn payload — button should be disabled');
            return;
        }

        setSaving(true);

        const payload: CreateZonePayload = {
            ...drawnPayload,
            label: createForm.name.trim(),
            category: createForm.category,
            color: '#3b82f6',
        };

        console.log('[GeofencePanel] Sending payload to Navixy:', JSON.stringify(payload, null, 2));

        try {
            const result = await onCreateZone(payload);
            console.log('[GeofencePanel] Create zone result:', result);
            setCreateForm({ name: '', category: 'custom', type: 'polygon' });
            onCancelDrawing();
            updateView('list');
        } catch (err) {
            console.error('[GeofencePanel] Failed to save zone:', err);
        } finally {
            setSaving(false);
        }
    };

    // Sort zones by vehicle count descending
    const sortedZones = [...zones].sort((a, b) => (b.vehicleCount || 0) - (a.vehicleCount || 0));

    // LIST VIEW
    if (view === 'list') {
        return (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-[30px] border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Geofence Zones</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{zones.length} zones configured</p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {sortedZones.length === 0 ? (
                        <div className="text-center py-12">
                            <MapPin className="mx-auto text-slate-300 mb-3" size={32} />
                            <p className="text-sm font-medium text-slate-500">No geofence zones</p>
                            <p className="text-xs text-slate-400 mt-1">Create your first zone to start monitoring</p>
                            <p className="text-xs text-slate-400 mt-1">Create your first zone to start monitoring</p>
                            <button
                                onClick={() => updateView('create')}
                                className="mt-4 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700"
                            >
                                <Plus size={12} className="inline mr-1" /> Create Zone
                            </button>
                        </div>
                    ) : (
                        sortedZones.map(zone => (
                            <div
                                key={zone.id}
                                onClick={() => handleZoneClick(zone.id)}
                                className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedZoneId === zone.id
                                    ? 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/50 dark:bg-blue-900/20'
                                    : 'border-gray-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-sm bg-white dark:bg-slate-900'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }}></div>
                                        <div className="flex items-center gap-1.5">
                                            {categoryIcons[zone.category]}
                                            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{zone.name}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] uppercase text-slate-400 dark:text-slate-500 font-medium">
                                            {zone.type === 'sausage' ? 'corridor' : zone.type}
                                        </span>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${zone.vehicleCount > 0
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                            }`}>
                                            {zone.vehicleCount}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    }

    // CREATE VIEW
    if (view === 'create') {
        const isCircle = createForm.type === 'circle';
        const hasPayload = !!drawnPayload;
        const circleRadius = (drawnPayload?.type === 'circle' ? drawnPayload.radius : drawingRadius) || 0;

        return (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-[30px] border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-3">
                    <button
                        onClick={() => { updateView('list'); onCancelDrawing(); }}
                        className="p-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Geofence</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Draw a zone on the map</p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">Zone Name</label>
                        <input
                            type="text"
                            value={createForm.name}
                            onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="e.g., Dar es Salaam Port Terminal"
                            className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-950 dark:text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">Zone Shape</label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { value: 'polygon' as const, label: 'Polygon', icon: <Hexagon size={14} /> },
                                { value: 'circle' as const, label: 'Circle', icon: <Circle size={14} /> },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => {
                                        setCreateForm(prev => ({ ...prev, type: opt.value }));
                                        if (opt.value !== createForm.type) {
                                            onCancelDrawing();
                                        }
                                    }}
                                    disabled={hasPayload}
                                    className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${createForm.type === opt.value
                                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300'
                                        : 'border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-blue-300'
                                        } ${hasPayload ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                    {opt.icon}
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Circle radius display (read-only) */}
                    {isCircle && (
                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Radius</span>
                                <span className="text-lg font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                    {circleRadius > 0 ? `${circleRadius.toLocaleString()}m` : '—'}
                                </span>
                            </div>
                            {!hasPayload && (
                                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                    Click &amp; drag on the map to draw a circle
                                </p>
                            )}
                            {circleRadius > 0 && (
                                <div className="h-1 bg-blue-100 dark:bg-blue-900/30 rounded-full mt-1 overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                        style={{ width: `${Math.min(100, (circleRadius / 10000) * 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    )}



                    {/* Action area */}
                    {!hasPayload ? (
                        <button
                            onClick={handleStartDraw}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 dark:bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors"
                        >
                            <MapPin size={16} />
                            {isCircle ? 'Draw Circle on Map' : 'Draw on Map'}
                        </button>
                    ) : (
                        <div className="space-y-2">
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
                                <p className="text-xs font-bold text-green-700 dark:text-green-300">✓ Zone drawn on map</p>
                                <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">
                                    {drawnPayload?.type === 'polygon' && drawnPayload.points && `${drawnPayload.points.length} points`}
                                    {(drawnPayload?.type === 'sausage' || drawnPayload?.type === 'corridor') && drawnPayload.points && `${drawnPayload.points.length} waypoints`}
                                    {drawnPayload?.type === 'circle' && `${drawnPayload.radius?.toLocaleString()}m radius`}
                                </p>
                            </div>
                            {/* Redraw / Cancel drawn geofence */}
                            <button
                                onClick={() => {
                                    onCancelDrawing();
                                    onRadiusChange?.(0);
                                    // Re-enter drawing mode
                                    setTimeout(() => onStartDrawing(createForm.type), 100);
                                }}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            >
                                <Trash2 size={12} /> Clear &amp; Redraw
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-100 dark:border-slate-800">
                    <button
                        onClick={handleSaveZone}
                        disabled={!createForm.name.trim() || !drawnPayload || saving}
                        className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {saving ? 'Pushing to Navixy...' : 'Push Geofence to Navixy'}
                    </button>
                </div>
            </div>
        );
    }

    // DETAIL VIEW
    if (view === 'detail' && selectedZone) {
        return (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-[30px] border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-3">
                    <button
                        onClick={() => { updateView('list'); onSelectZone(null); }}
                        className="p-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    {/* WhatsApp Share Button */}
                    <button
                        onClick={() => {
                            const baseUrl = window.location.origin + window.location.pathname;
                            const regionParam = region || 'TZ';
                            const shareUrl = `${baseUrl}?geofence_id=${selectedZone.id}&view=locked&region=${regionParam}`;
                            const text = `Live Geofence Monitor: ${selectedZone.name}`;
                            const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text + '\n' + shareUrl)}`;
                            window.open(whatsappUrl, '_blank');
                        }}
                        className="p-1.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 transition-colors"
                        title="Share Limitless View on WhatsApp"
                    >
                        <Share2 size={16} />
                    </button>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{selectedZone.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            {categoryIcons[selectedZone.category]}
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                {categoryLabels[selectedZone.category]} &middot; {selectedZone.type === 'sausage' ? 'Corridor' : selectedZone.type}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center border border-blue-100 dark:border-blue-800">
                            <div className="text-2xl font-black text-blue-700 dark:text-blue-300">{selectedZone.vehicleCount}</div>
                            <div className="text-[10px] text-blue-500 dark:text-blue-400 font-bold uppercase">Vehicles Inside</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 text-center border border-slate-100 dark:border-slate-800">
                            <div className="text-2xl font-black text-slate-700 dark:text-slate-200">
                                {selectedZone.radius ? `${(selectedZone.radius / 1000).toFixed(1)}km` : '--'}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase">
                                {selectedZone.type === 'sausage' ? 'Width' : 'Radius'}
                            </div>
                        </div>
                    </div>

                    {selectedZone.vehicleIds.length > 0 && (
                        <div>
                            <h3 className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">Vehicles Currently Inside</h3>
                            <div className="space-y-1">
                                {selectedZone.vehicleIds.map((tId: number) => {
                                    const occupant = selectedZone.occupants?.[tId];
                                    const now = Date.now();
                                    const durationMs = occupant ? now - occupant.entryTime : 0;

                                    // Helper for formatting
                                    const formatDwellTime = (ms: number) => {
                                        if (ms < 60000) return 'Just now';
                                        const totalMins = Math.floor(ms / 60000);
                                        const totalHrs = Math.floor(totalMins / 60);
                                        const totalDays = Math.floor(totalHrs / 24);

                                        if (totalDays >= 365) {
                                            const y = Math.floor(totalDays / 365);
                                            const remDays = totalDays % 365;
                                            const mo = Math.floor(remDays / 30);
                                            const d = remDays % 30;
                                            return `${y}y ${mo}mo ${d}d`;
                                        }
                                        if (totalDays >= 30) {
                                            const mo = Math.floor(totalDays / 30);
                                            const d = totalDays % 30;
                                            return `${mo}mo ${d}d`;
                                        }
                                        if (totalDays >= 1) {
                                            const h = totalHrs % 24;
                                            return `${totalDays}d ${h}h`;
                                        }
                                        if (totalHrs > 0) {
                                            return `${totalHrs}h ${totalMins % 60}m`;
                                        }
                                        return `${totalMins}m`;
                                    };

                                    const durationStr = formatDwellTime(durationMs);

                                    // Severity color
                                    let dotColor = 'bg-blue-500';
                                    let timerColor = 'text-slate-400 dark:text-slate-500';

                                    if (durationMs > 4 * 60 * 60 * 1000) { // > 4 hours
                                        dotColor = 'bg-red-500';
                                        timerColor = 'text-red-500';
                                    } else if (durationMs > 1 * 60 * 60 * 1000) { // > 1 hour
                                        dotColor = 'bg-amber-500';
                                        timerColor = 'text-amber-600';
                                    }

                                    return (
                                        <div key={tId} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-100 dark:border-slate-800">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${dotColor} ${durationMs < 60000 ? 'animate-pulse' : ''}`}></div>
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                                                        {trackerLabels[tId] || `Tracker #${tId}`}
                                                    </span>
                                                    {occupant?.status && (
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                                                            {occupant.status}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Clock size={10} className={timerColor} />
                                                <span className={`text-[10px] font-bold ${timerColor}`}>
                                                    {durationStr}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-100 dark:border-slate-800">
                    {isAdmin && (
                        <button
                            onClick={() => handleDelete(selectedZone.id)}
                            disabled={deleting}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
                        >
                            <Trash2 size={12} /> {deleting ? 'Deleting...' : 'Delete Zone from Navixy'}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return null;
}
