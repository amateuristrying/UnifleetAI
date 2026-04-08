'use client';

import React, { useState } from 'react';
import { 
    AlertTriangle, 
    Activity, 
    MapPin, 
    Anchor, 
    Warehouse, 
    Files, 
    ArrowRight, 
    Truck,
    ShieldCheck,
    ArrowLeft
} from 'lucide-react';
import { FleetAnalysis, ZoneType, ActionItem } from '../hooks/useFleetAnalysis';

interface RealtimeInsightsProps {
    analysis: FleetAnalysis | null;
    currentView: 'summary' | 'traffic' | 'geofences';
    onViewChange: (view: 'summary' | 'traffic' | 'geofences') => void;
    onActionSelect?: (action: ActionItem) => void; // New callback
}

export default function RealtimeInsights({ analysis, currentView, onViewChange, onActionSelect }: RealtimeInsightsProps) {
    // New State for Selected Action in List View
    const [selectedId, setSelectedId] = useState<string | null>(null);

    if (!analysis) return (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm animate-pulse mb-6">
            <div className="h-4 bg-slate-100 rounded w-1/3 mb-4"></div>
            <div className="h-20 bg-slate-50 rounded"></div>
        </div>
    );

    const getIcon = (type: ZoneType) => {
        switch (type) {
            case 'port': return <Anchor size={16} className="text-blue-600" />;
            case 'border': return <Files size={16} className="text-amber-600" />;
            case 'warehouse': return <Warehouse size={16} className="text-purple-600" />;
            case 'mining': return <Truck size={16} className="text-slate-600" />;
            default: return <AlertTriangle size={16} className="text-red-500" />;
        }
    };

    const handleActionClick = (item: ActionItem) => {
        setSelectedId(item.id);
        if (onActionSelect) {
            onActionSelect(item);
        }
    };

    // Filter actions based on view
    const filteredActions = analysis.actions.filter(a => {
        if (currentView === 'traffic') return true; 
        if (currentView === 'geofences') return a.type !== 'road'; 
        return true;
    });

    const utilizationColor = analysis.movingPct > 80 ? 'text-green-600' : analysis.movingPct > 50 ? 'text-blue-600' : 'text-amber-600';
    const trafficIssues = analysis.actions.length;

    // --- SUMMARY VIEW (Dashboard) ---
    if (currentView === 'summary') {
        return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                
                {/* Card 1: Fleet Pulse */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col justify-between relative overflow-hidden group hover:border-blue-300 transition-all">
                    <div className="absolute top-0 right-0 p-3 opacity-5"><Activity size={80} /></div>
                    <div>
                        <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Fleet Pulse</h3>
                        <div className={`text-3xl font-black ${utilizationColor} flex items-baseline gap-2`}>
                            {analysis.movingPct}% <span className="text-sm font-medium text-slate-400">Active</span>
                        </div>
                    </div>
                    <div className="mt-4 flex gap-0.5 h-1.5 w-full rounded-full overflow-hidden bg-slate-100">
                        <div className="bg-green-500" style={{ width: `${(analysis.moving / analysis.total) * 100}%` }}></div>
                        <div className="bg-red-400" style={{ width: `${(analysis.stopped / analysis.total) * 100}%` }}></div>
                        <div className="bg-blue-500" style={{ width: `${(analysis.parked / analysis.total) * 100}%` }}></div>
                        <div className="bg-orange-400" style={{ width: `${(analysis.idleStopped / analysis.total) * 100}%` }}></div>
                        <div className="bg-purple-400" style={{ width: `${(analysis.idleParked / analysis.total) * 100}%` }}></div>
                        <div className="bg-slate-300" style={{ width: `${(analysis.offline / analysis.total) * 100}%` }}></div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-2 text-[9px] text-slate-400 font-medium">
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>{analysis.moving} Moving</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>{analysis.stopped} Stop</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>{analysis.parked} Park</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>{analysis.idleStopped} I-Stop</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>{analysis.idleParked} I-Park</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>{analysis.offline} Off</span>
                    </div>
                </div>

                {/* Card 2: Traffic Flow (Clickable) */}
                <div 
                    onClick={() => onViewChange('traffic')}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col justify-between cursor-pointer hover:shadow-md hover:border-blue-300 transition-all"
                >
                    <div>
                        <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Traffic Flow</h3>
                        <div className="flex items-center gap-3">
                             <div className="text-2xl font-bold text-slate-800">{analysis.avgSpeed.toFixed(0)} <span className="text-sm font-normal text-slate-400">km/h</span></div>
                             <div className="h-8 w-[1px] bg-slate-100"></div>
                             <div>
                                <div className={`text-sm font-bold ${trafficIssues > 0 ? 'text-red-500' : 'text-green-500'} flex items-center gap-1`}>
                                    {trafficIssues > 0 ? <AlertTriangle size={14}/> : <ShieldCheck size={14}/>}
                                    {trafficIssues > 0 ? `${trafficIssues} Delays` : 'Smooth'}
                                </div>
                                <div className="text-[10px] text-slate-400">Congestion Detected</div>
                             </div>
                        </div>
                    </div>
                    <div className={`mt-3 text-xs p-2 rounded border ${trafficIssues > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                        {trafficIssues > 0 
                            ? "⚠️ High density slow-moving clusters detected."
                            : "✅ No significant traffic bottlenecks currently."}
                    </div>
                </div>

                {/* Card 3: Active Geofences (Clickable) */}
                <div 
                    onClick={() => onViewChange('geofences')}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 md:col-span-2 flex flex-col cursor-pointer hover:shadow-md hover:border-blue-300 transition-all"
                >
                    <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                        <MapPin size={14} /> Active Geofences
                    </h3>
                    <div className="grid grid-cols-2 gap-3 flex-1 content-start">
                        {Object.entries(analysis.zoneOccupancy).slice(0, 4).map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-100">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <div className={`w-2 h-2 shrink-0 rounded-full ${count > 0 ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`}></div>
                                    <span className="text-sm font-medium text-slate-700 truncate" title={name}>{name}</span>
                                </div>
                                <span className="text-xs font-bold bg-white px-2 py-1 rounded shadow-sm border border-slate-200 text-slate-600 whitespace-nowrap">
                                    {count} <span className="text-[9px] text-slate-400 font-normal">assets</span>
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 flex justify-center">
                        <span className="text-xs text-blue-500 font-medium flex items-center gap-1">
                            + Add Custom Zone
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    // --- DETAILED VIEW (Drill Down) ---
    // If used as a side-panel component, we adjust layout
    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden order-1 lg:order-2">
            <div className="p-4 border-b border-gray-100 flex items-center gap-3 bg-slate-50">
                <button 
                    onClick={() => {
                        setSelectedId(null);
                        onViewChange('summary');
                    }}
                    className="p-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 text-slate-600 transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h2 className="text-sm font-bold text-slate-900 leading-tight">
                        {currentView === 'traffic' ? 'Traffic Analysis' : 'Geofence Ops'}
                    </h2>
                    <p className="text-xs text-slate-500">
                        {filteredActions.length} Active Items
                    </p>
                </div>
            </div>

            {/* Scrollable List Container */}
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar bg-slate-50/50">
                {filteredActions.length === 0 ? (
                     <div className="bg-green-50 border border-green-100 rounded-lg p-6 text-center">
                        <div className="inline-flex bg-white p-2 rounded-full shadow-sm mb-2">
                            <ShieldCheck className="text-green-500" size={20} />
                        </div>
                        <h4 className="font-bold text-green-800 text-sm">No Critical Issues</h4>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {filteredActions.map((item) => (
                            <div 
                                key={item.id} 
                                onClick={() => handleActionClick(item)}
                                className={`
                                    bg-white rounded-lg border p-3 shadow-sm transition-all cursor-pointer relative overflow-hidden
                                    ${selectedId === item.id 
                                        ? 'ring-2 ring-blue-500 border-blue-500' 
                                        : 'hover:border-blue-300 hover:shadow-md'
                                    }
                                    ${item.severity === 'high' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-amber-400'}
                                `}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`p-1.5 rounded-md ${item.severity === 'high' ? 'bg-red-50' : 'bg-amber-50'}`}>
                                            {getIcon(item.type)}
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-slate-800 text-xs leading-tight truncate pr-2" title={item.title}>{item.title}</h4>
                                            <p className="text-[10px] text-slate-500 truncate" title={item.location}>{item.location}</p>
                                        </div>
                                    </div>
                                    <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                                        {item.count} Assets
                                    </span>
                                </div>
                                
                                <div className="pl-9">
                                     <p className="text-[10px] text-slate-600 font-medium bg-slate-50 p-1.5 rounded border border-slate-100 leading-snug">
                                        {item.action}
                                    </p>
                                    <div className="flex items-center gap-1 text-[9px] text-blue-600 font-bold mt-1.5 uppercase tracking-wide opacity-80 group-hover:opacity-100">
                                        Zoom to Zone <ArrowRight size={8} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
