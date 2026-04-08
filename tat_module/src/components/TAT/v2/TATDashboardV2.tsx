'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
    LayoutDashboard, 
    Route, 
    Waypoints, 
    Calendar,
    Search,
    Truck,
    MapPin,
    ArrowUpDown,
    Download,
    TrendingUp,
    Warehouse,
    Target,
    Compass
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PrimaryDashboardTab } from './PrimaryDashboardTab';
import CoverageLabTab from './CoverageLabTab';
import BorderManagementTab from './BorderManagementTab';
import { LoadingZonesTab } from './LoadingZonesTab';
import { UnloadingZonesTab } from './UnloadingZonesTab';
import { DestinationIntelligenceTab } from './DestinationIntelligenceTab';

type TabType = 'primary' | 'coverage' | 'borders' | 'loading' | 'unloading' | 'destinations';

export default function TATDashboardV2() {
    const [activeTab, setActiveTab] = useState<TabType>('primary');
    const [selectedDestination, setSelectedDestination] = useState('All Destinations');
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
    });

    const tabs = [
        { id: 'primary', label: 'Primary Dashboard', icon: LayoutDashboard },
        { id: 'loading', label: 'Loading Zones', icon: Warehouse },
        { id: 'borders', label: 'Border Management', icon: Waypoints },
        { id: 'unloading', label: 'Unloading Zones', icon: Target },
        { id: 'destinations', label: 'Dest Intelligence', icon: Compass },
        { id: 'coverage', label: 'Coverage Lab', icon: Route },
    ] as const;

    return (
        <div className="min-h-screen bg-[#020617] text-slate-200">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#020617]/80 backdrop-blur-md">
                <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between px-8">
                    <div className="flex items-center gap-10">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 p-2 shadow-lg shadow-cyan-500/20">
                                <Truck className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold tracking-tight text-white">Unifleet TAT <span className="text-cyan-400">v2</span></h1>
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Intelligence Engine</p>
                            </div>
                        </div>

                        <nav className="flex items-center gap-1">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'group relative flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200',
                                        activeTab === tab.id 
                                            ? 'bg-slate-800/50 text-white shadow-sm' 
                                            : 'text-slate-400 hover:bg-slate-800/30 hover:text-slate-200'
                                    )}
                                >
                                    <tab.icon className={cn(
                                        'h-4.5 w-4.5 transition-colors',
                                        activeTab === tab.id ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-400'
                                    )} />
                                    {tab.label}
                                    {activeTab === tab.id && (
                                        <div className="absolute -bottom-[21px] left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-500 to-transparent" />
                                    )}
                                </button>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-1.5 shadow-inner">
                            <div className="flex items-center gap-2 px-3">
                                <Calendar className="h-4 w-4 text-slate-500" />
                                <input 
                                    type="date" 
                                    className="bg-transparent text-sm font-medium text-slate-300 outline-none [color-scheme:dark]"
                                    value={dateRange.start}
                                    onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                />
                                <span className="text-slate-600">→</span>
                                <input 
                                    type="date" 
                                    className="bg-transparent text-sm font-medium text-slate-300 outline-none [color-scheme:dark]"
                                    value={dateRange.end}
                                    onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-1.5">
                            <div className="flex items-center gap-2 px-3">
                                <MapPin className="h-4 w-4 text-slate-500" />
                                <select 
                                    className="bg-transparent text-sm font-medium text-slate-300 outline-none [color-scheme:dark] appearance-none cursor-pointer pr-6"
                                    value={selectedDestination}
                                    onChange={(e) => setSelectedDestination(e.target.value)}
                                >
                                    <option>All Destinations</option>
                                    <option>Lubumbashi</option>
                                    <option>Kolwezi</option>
                                    <option>Ndola</option>
                                    <option>Lusaka</option>
                                </select>
                            </div>
                        </div>

                        <button className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 text-slate-400 transition hover:border-slate-700 hover:text-white">
                            <Download className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="mx-auto max-w-[1600px] px-8 py-10">
                <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {activeTab === 'primary' && (
                        <PrimaryDashboardTab 
                            dateRange={dateRange} 
                            selectedDestination={selectedDestination} 
                        />
                    )}
                    {activeTab === 'loading' && (
                        <LoadingZonesTab 
                            dateRange={dateRange} 
                        />
                    )}
                    {activeTab === 'unloading' && (
                        <UnloadingZonesTab 
                            dateRange={dateRange} 
                        />
                    )}
                    {activeTab === 'destinations' && (
                        <DestinationIntelligenceTab
                            dateRange={dateRange}
                        />
                    )}
                    {activeTab === 'borders' && (
                        <BorderManagementTab 
                            dateRange={dateRange} 
                        />
                    )}
                    {activeTab === 'coverage' && (
                        <CoverageLabTab 
                            dateRange={dateRange} 
                        />
                    )}
                </div>
            </main>

            {/* Footer / Status Bar */}
            <footer className="border-t border-slate-800/80 bg-slate-950/40 px-8 py-6">
                <div className="mx-auto flex max-w-[1600px] items-center justify-between text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                            Engine Status: Optimal
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
                            Data Freshness: Real-time
                        </div>
                    </div>
                    <div>
                        Powered by Unifleet Advanced Analytics • Phase 66 Deployment
                    </div>
                </div>
            </footer>
        </div>
    );
}
