import { useState } from 'react';
import type { NavixyTrackerState } from '@/services/navixy';
import { getVehicleStatus } from '@/hooks/useTrackerStatusDuration';

import { EyeOff, Code } from 'lucide-react';

interface NavixyDataInspectorProps {
    trackerStates: Record<number, NavixyTrackerState>;
    trackerLabels: Record<number, string>;
}

export default function NavixyDataInspector({ trackerStates, trackerLabels }: NavixyDataInspectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedTracker, setSelectedTracker] = useState<number | null>(null);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 bg-slate-800 text-white p-3 rounded-full shadow-lg hover:bg-slate-900 transition-colors z-[100] border border-slate-700"
                title="Open Data Inspector"
            >
                <Code size={20} />
            </button>
        );
    }

    const trackerEntries = Object.entries(trackerStates);
    const selectedState = selectedTracker ? trackerStates[selectedTracker] : null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-[24px] shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-border">
                {/* Header */}
                <div className="bg-slate-900 text-white p-5 flex items-center justify-between shadow-md z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-xl">
                            <Code size={24} className="text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black tracking-tight uppercase">Navixy Data Inspector</h2>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Raw API Data vs Derived Values</p>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-2 hover:bg-slate-800 rounded-xl transition-colors text-slate-400 hover:text-white"
                    >
                        <EyeOff size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex">
                    {/* Tracker List */}
                    <div className="w-80 border-r border-slate-200 overflow-y-auto bg-slate-50">
                        <div className="p-4 bg-white border-b border-slate-200 sticky top-0 shadow-sm z-10">
                            <h3 className="font-bold text-[10px] uppercase text-slate-400 tracking-widest">Active Entities ({trackerEntries.length})</h3>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {trackerEntries.map(([id, state]) => {
                                const trackerId = Number(id);
                                const status = getVehicleStatus(state);
                                const statusColor = {
                                    moving: 'bg-green-100 text-green-700',
                                    stopped: 'bg-red-100 text-red-700',
                                    parked: 'bg-blue-100 text-blue-700',
                                    'idle-stopped': 'bg-orange-100 text-orange-700',
                                    'idle-parked': 'bg-purple-100 text-purple-700',
                                    offline: 'bg-slate-100 text-slate-700'
                                }[status];

                                return (
                                    <button
                                        key={id}
                                        onClick={() => setSelectedTracker(trackerId)}
                                        className={`w-full p-4 text-left hover:bg-white transition-all border-l-4 ${selectedTracker === trackerId
                                            ? 'bg-white border-blue-500 shadow-sm'
                                            : 'border-transparent'
                                            }`}
                                    >
                                        <div className="font-bold text-sm text-slate-800 truncate">
                                            {trackerLabels[trackerId] || `Tracker #${id}`}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${statusColor}`}>
                                                {status}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-mono font-bold">#{id}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Data View */}
                    <div className="flex-1 overflow-y-auto bg-white relative">
                        {!selectedTracker ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300">
                                <Code size={64} className="mb-4 opacity-10" />
                                <p className="text-sm font-black uppercase tracking-widest">Select an entity to inspect</p>
                            </div>
                        ) : selectedState ? (
                            <div className="p-6 space-y-8">
                                <div className="bg-blue-600 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/20">
                                    <h3 className="text-xs font-black uppercase tracking-widest mb-4 opacity-80">🔍 Telemetry Quick Analysis</h3>
                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <span className="text-[10px] uppercase font-black opacity-60 block mb-1">Entity ID</span>
                                            <span className="text-xl font-black">{selectedState.source_id}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] uppercase font-black opacity-60 block mb-1">System status</span>
                                            <span className="text-xl font-black uppercase">
                                                {getVehicleStatus(selectedState)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* GPS Data */}
                                    <section className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                                        <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                                            Navixy GPS Signal
                                        </h3>
                                        <div className="space-y-2 font-mono text-xs">
                                            <DataRow label="lat" value={selectedState.gps.location.lat} />
                                            <DataRow label="lng" value={selectedState.gps.location.lng} />
                                            <DataRow label="speed" value={`${selectedState.gps.speed} km/h`} highlight />
                                            <DataRow label="heading" value={`${selectedState.gps.heading}°`} />
                                            <DataRow label="updated" value={selectedState.gps.updated || 'N/A'} />
                                        </div>
                                    </section>

                                    {/* Movement Detection */}
                                    <section className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                                        <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                                            Navixy Movement
                                        </h3>
                                        <div className="space-y-2 font-mono text-xs">
                                            <DataRow label="status" value={selectedState.movement_status || 'NOT PROVIDED'} highlight />
                                            <DataRow label="updated" value={selectedState.movement_status_update || 'N/A'} />
                                            <DataRow label="connection" value={selectedState.connection_status || 'NOT PROVIDED'} />
                                            <DataRow label="last_update" value={selectedState.last_update} />
                                        </div>
                                    </section>
                                </div>

                                {/* Derived Logic Details */}
                                <section className="bg-slate-900 rounded-2xl p-6 text-white overflow-hidden relative">
                                    <div className="absolute top-0 right-0 p-8 opacity-5">
                                        <Code size={120} />
                                    </div>
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-500 mb-4">Derived System State Logic</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold">1</div>
                                                <div className="text-xs">
                                                    <span className="text-slate-500">Connection test:</span>
                                                    <span className={`ml-2 font-bold ${selectedState.connection_status === 'offline' ? 'text-red-400' : 'text-green-400'}`}>
                                                        {selectedState.connection_status === 'offline' ? 'OFFLINE DETECTED' : 'HEARTBEAT OK'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold">2</div>
                                                <div className="text-xs">
                                                    <span className="text-slate-500">Navixy status:</span>
                                                    <span className="ml-2 font-bold text-blue-400 uppercase">{selectedState.movement_status || 'INFERRED FROM SPEED'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold">3</div>
                                                <div className="text-xs">
                                                    <span className="text-slate-500">Engine state:</span>
                                                    <span className={`ml-2 font-bold ${selectedState.ignition ? 'text-orange-400' : 'text-slate-400'}`}>
                                                        {selectedState.ignition ? 'IGNITION ON' : 'IGNITION OFF'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t border-slate-800 flex items-baseline gap-2">
                                            <span className="text-[10px] font-black uppercase text-slate-500">Conclusion:</span>
                                            <span className="text-2xl font-black text-blue-400 uppercase">{getVehicleStatus(selectedState)}</span>
                                        </div>
                                    </div>
                                </section>

                                {/* Raw JSON */}
                                <section>
                                    <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-400 mb-3">Raw Payload Structure</h3>
                                    <pre className="bg-slate-50 text-slate-600 text-[11px] p-6 rounded-2xl overflow-x-auto border border-slate-100 font-mono">
                                        {JSON.stringify(selectedState, null, 2)}
                                    </pre>
                                </section>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function DataRow({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
    return (
        <div className={`flex justify-between items-center py-1 ${highlight ? 'text-blue-600 font-bold' : 'text-slate-600'}`}>
            <span className="opacity-60">{label}:</span>
            <span className="font-bold">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
        </div>
    );
}
