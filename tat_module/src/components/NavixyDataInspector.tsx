'use client';

import React, { useState } from 'react';
import { NavixyTrackerState } from '../services/navixy';
import { getVehicleStatus } from '../hooks/useTrackerStatusDuration';
import { calculateEngineMetrics, formatDuration, estimateIdleFuelWaste } from '../lib/engine-hours';
import { Eye, EyeOff, Code, Fuel, Clock } from 'lucide-react';

interface NavixyDataInspectorProps {
    trackerStates: Record<number, NavixyTrackerState>;
    trackerLabels: Record<number, string>;
}



// ...

export default function NavixyDataInspector({ trackerStates, trackerLabels }: NavixyDataInspectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedTracker, setSelectedTracker] = useState<number | null>(null);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-colors z-50"
                title="Open Data Inspector"
            >
                <Code size={20} />
            </button>
        );
    }

    const trackerEntries = Object.entries(trackerStates);
    const selectedState = selectedTracker ? trackerStates[selectedTracker] : null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-slate-800 text-white p-4 flex items-center justify-between shadow-md z-10">
                    <div className="flex items-center gap-3">
                        <Code size={24} className="text-blue-400" />
                        <div>
                            <h2 className="text-lg font-bold">Navixy Data Inspector</h2>
                            <p className="text-xs text-slate-300">Raw API Data vs Derived Values</p>
                        </div>
                    </div>

                    {/* Title only, no tabs needed as there's only one view */}
                    <div className="flex bg-slate-700 rounded-lg p-1">
                        <span className="px-4 py-1.5 rounded-md text-xs font-bold bg-blue-500 text-white shadow">
                            Tracker State
                        </span>
                    </div>

                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-2 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
                    >
                        <EyeOff size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex">
                    {/* Tracker List */}
                    <div className="w-80 border-r border-slate-200 overflow-y-auto bg-slate-50">
                        <div className="p-3 bg-white border-b border-slate-200 sticky top-0 shadow-sm z-10">
                            <h3 className="font-bold text-xs uppercase text-slate-400">Select Entity ({trackerEntries.length})</h3>
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
                                        className={`w-full p-3 text-left hover:bg-white transition-all border-l-4 ${selectedTracker === trackerId
                                            ? 'bg-white border-blue-500 shadow-sm'
                                            : 'border-transparent'
                                            }`}
                                    >
                                        <div className="font-bold text-sm text-slate-800 truncate">
                                            {trackerLabels[trackerId] || `Tracker #${id}`}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-bold uppercase ${statusColor}`}>
                                                {status}
                                            </span>
                                            <span className="text-xs text-slate-500 font-mono">#{id}</span>
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
                                <Code size={64} className="mb-4 opacity-20" />
                                <p className="text-lg font-medium">Select a tracker to inspect data</p>
                            </div>
                        ) : selectedState ? (
                            <div className="p-6 space-y-6">
                                {/* ... [Existing Tracker State Views] ... */}
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <h3 className="font-bold text-blue-900 mb-2">📊 Data Summary</h3>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <span className="text-blue-700 font-medium">Tracker ID:</span>
                                            <span className="ml-2 text-blue-900">{selectedState.source_id}</span>
                                        </div>
                                        <div>
                                            <span className="text-blue-700 font-medium">Derived Status:</span>
                                            <span className="ml-2 text-blue-900 font-bold">
                                                {getVehicleStatus(selectedState).toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* GPS Data (From Navixy) */}
                                <section>
                                    <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                        <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">FROM NAVIXY</span>
                                        GPS Data
                                    </h3>
                                    <div className="bg-slate-50 rounded-lg p-4 space-y-2 font-mono text-sm border border-slate-100">
                                        <DataRow label="gps.location.lat" value={selectedState.gps.location.lat} />
                                        <DataRow label="gps.location.lng" value={selectedState.gps.location.lng} />
                                        <DataRow label="gps.speed" value={`${selectedState.gps.speed} km/h`} highlight />
                                        <DataRow label="gps.heading" value={`${selectedState.gps.heading}°`} />
                                        <DataRow label="gps.updated" value={selectedState.gps.updated || 'N/A'} />
                                    </div>
                                </section>

                                {/* Movement Status (From Navixy) */}
                                <section>
                                    <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                        <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">FROM NAVIXY</span>
                                        Movement Detection
                                    </h3>
                                    <div className="bg-slate-50 rounded-lg p-4 space-y-2 font-mono text-sm border border-slate-100">
                                        <DataRow
                                            label="movement_status"
                                            value={selectedState.movement_status || 'NOT PROVIDED'}
                                            highlight
                                            important={!!selectedState.movement_status}
                                        />
                                        <DataRow
                                            label="movement_status_update"
                                            value={selectedState.movement_status_update || 'N/A'}
                                        />
                                        <DataRow
                                            label="connection_status"
                                            value={selectedState.connection_status || 'NOT PROVIDED'}
                                            highlight
                                        />
                                        <DataRow label="last_update" value={selectedState.last_update} />
                                    </div>
                                    {selectedState.movement_status && (
                                        <div className="mt-2 text-xs text-green-700 bg-green-50 p-2 rounded border border-green-200">
                                            ✓ <strong>Using Navixy's movement_status</strong> - Sophisticated algorithm includes GPS drift compensation, time-based analysis
                                        </div>
                                    )}
                                    {!selectedState.movement_status && (
                                        <div className="mt-2 text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                                            ⚠ <strong>Fallback mode</strong> - movement_status not provided, using speed-based detection
                                        </div>
                                    )}
                                </section>

                                {/* Ignition Data (From Navixy) */}
                                <section>
                                    <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                        <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">FROM NAVIXY</span>
                                        Ignition Status
                                    </h3>
                                    <div className="bg-slate-50 rounded-lg p-4 space-y-2 font-mono text-sm border border-slate-100">
                                        <DataRow
                                            label="ignition"
                                            value={selectedState.ignition !== undefined ? String(selectedState.ignition) : 'NOT PROVIDED'}
                                            highlight
                                        />
                                        <DataRow
                                            label="ignition_update"
                                            value={selectedState.ignition_update || 'N/A'}
                                        />
                                        <DataRow
                                            label="inputs[0] (fallback)"
                                            value={String(selectedState.inputs?.[0] || false)}
                                        />
                                    </div>
                                </section>

                                {/* Derived Values (Computed by Us) */}
                                <section>
                                    <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                        <span className="bg-purple-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">DERIVED BY US</span>
                                        Computed Status
                                    </h3>
                                    <div className="bg-purple-50 rounded-lg p-4 space-y-3 border border-purple-100">
                                        <div className="text-sm space-y-2">
                                            <div className="font-medium text-purple-900">Status Determination Logic (Priority Order):</div>
                                            <div className="pl-4 space-y-1 text-xs text-purple-800">
                                                <div>1. Connection Status: <strong>{selectedState.connection_status || 'NOT PROVIDED'}</strong></div>
                                                {selectedState.connection_status === 'offline' && (
                                                    <div className="ml-4 text-red-600">✓ OFFLINE (no GPS signal)</div>
                                                )}
                                                {selectedState.connection_status !== 'offline' && (
                                                    <>
                                                        <div>2. Movement Status: <strong>{selectedState.movement_status || 'NOT PROVIDED'}</strong></div>
                                                        {selectedState.movement_status === 'moving' && (
                                                            <div className="ml-4 text-green-600">✓ MOVING (vehicle in transit)</div>
                                                        )}
                                                        {selectedState.movement_status === 'parked' && (
                                                            <>
                                                                <div>3. Ignition Status: <strong>{selectedState.ignition !== undefined ? String(selectedState.ignition) : 'NOT PROVIDED'}</strong></div>
                                                                {(selectedState.ignition !== undefined ? selectedState.ignition : (selectedState.inputs?.[0] || false)) ? (
                                                                    <div className="ml-4 text-purple-600">✓ IDLE-PARKED (engine running while parked - unusual!)</div>
                                                                ) : (
                                                                    <div className="ml-4 text-blue-600">✓ PARKED (long-term parking 15+ min, engine off)</div>
                                                                )}
                                                            </>
                                                        )}
                                                        {selectedState.movement_status === 'stopped' && (
                                                            <>
                                                                <div>3. Ignition Status: <strong>{selectedState.ignition !== undefined ? String(selectedState.ignition) : 'NOT PROVIDED'}</strong></div>
                                                                {(selectedState.ignition !== undefined ? selectedState.ignition : (selectedState.inputs?.[0] || false)) ? (
                                                                    <div className="ml-4 text-orange-600">✓ IDLE-STOPPED (engine running while stopped - fuel waste!)</div>
                                                                ) : (
                                                                    <div className="ml-4 text-red-600">✓ STOPPED (temporary halt &lt; 15 min, engine off)</div>
                                                                )}
                                                            </>
                                                        )}
                                                        {!selectedState.movement_status && (
                                                            <div className="ml-4 text-amber-600">⚠ Using fallback: speed={selectedState.gps.speed} km/h, ignition={(selectedState.ignition !== undefined ? selectedState.ignition : (selectedState.inputs?.[0] || false)).toString()}</div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="border-t border-purple-200 pt-3">
                                            <div className="text-lg font-bold text-purple-900">
                                                Final Status: <span className="text-purple-600">{getVehicleStatus(selectedState).toUpperCase()}</span>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                {/* Raw JSON */}
                                <section>
                                    <h3 className="font-bold text-slate-800 mb-3">🔍 Raw JSON (Full State Object)</h3>
                                    <pre className="bg-slate-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto border border-slate-700">
                                        {JSON.stringify(selectedState, null, 2)}
                                    </pre>
                                </section>
                            </div>
                        ) : (
                            <div className="p-8 text-center text-slate-500">State data not available for this tracker.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ...

// Helper component for data rows
function DataRow({ label, value, highlight, important }: { label: string; value: any; highlight?: boolean; important?: boolean }) {
    return (
        <div className={`flex justify-between items-start ${highlight ? 'bg-yellow-100 -mx-2 px-2 py-1 rounded' : ''}`}>
            <span className={`text-slate-600 ${important ? 'font-bold' : ''}`}>{label}:</span>
            <span className={`text-slate-900 font-medium ml-4 text-right ${important ? 'text-green-700 font-bold' : ''}`}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
        </div>
    );
}
