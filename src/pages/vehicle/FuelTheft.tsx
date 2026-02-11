import { useState, useEffect } from 'react';
import { Download, Filter, ArrowUpRight, ArrowDownRight, Droplets, AlertTriangle, TrendingUp, DollarSign } from "lucide-react";
import RealTimeMonitoringPanel from './fuel-theft/RealTimeMonitoringPanel';
import AlertManagementSidebar from './fuel-theft/AlertManagementSidebar';
import FuelVarianceAnalysis from './fuel-theft/FuelVarianceAnalysis';
import IncidentDetailsModal from './fuel-theft/IncidentDetailsModal';

export function FuelTheft() {
    const [selectedIncident, setSelectedIncident] = useState<any>(null);
    const [filterSeverity, setFilterSeverity] = useState('all');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [autoRefresh] = useState(true);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [, setLastUpdate] = useState(new Date()); // Used to trigger re-renders

    const kpis = [
        {
            title: 'Total Fuel Theft',
            value: '245 L',
            change: '12% vs last week',
            trendUp: false,
            icon: Droplets,
            color: 'text-red-500',
            bg: 'bg-red-500'
        },
        {
            title: 'Active Alerts',
            value: '12',
            change: '3 new today',
            trendUp: true,
            icon: AlertTriangle,
            color: 'text-amber-500',
            bg: 'bg-amber-500'
        },
        {
            title: 'Est. Financial Loss',
            value: '$420',
            change: '8% decrease',
            trendUp: true,
            icon: DollarSign,
            color: 'text-green-500',
            bg: 'bg-green-500'
        },
        {
            title: 'Reporting Efficiency',
            value: '94%',
            change: '2% increase',
            trendUp: true,
            icon: TrendingUp,
            color: 'text-blue-500',
            bg: 'bg-blue-500'
        }
    ];

    // Auto-refresh simulation
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            setLastUpdate(new Date());
        }, 15000); // Update every 15 seconds

        return () => clearInterval(interval);
    }, [autoRefresh]);

    const handleIncidentClick = (incident: any) => {
        setSelectedIncident(incident);
    };

    const handleCloseModal = () => {
        setSelectedIncident(null);
    };

    return (
        <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-foreground tracking-tight">Fuel Theft Monitoring</h1>
                    <p className="text-muted-foreground mt-1">Real-time detection and analysis of fuel anomalies.</p>
                </div>
                <div className="flex gap-3">
                    <button className="flex items-center gap-2 px-4 py-2 bg-surface-card border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors text-foreground">
                        <Download size={16} className="text-muted-foreground" />
                        Export Report
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm shadow-blue-900/20">
                        <Filter size={16} />
                        Filter Events
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map((kpi, idx) => (
                    <div key={idx} className="bg-surface-card rounded-2xl p-5 border border-border shadow-sm flex flex-col justify-between group hover:border-border/80 transition-all duration-300">
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-3 rounded-xl ${kpi.bg} bg-opacity-10 group-hover:scale-110 transition-transform duration-300`}>
                                <kpi.icon size={22} className={kpi.color} />
                            </div>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${kpi.trendUp ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                } flex items-center gap-1`}>
                                {kpi.trendUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                {kpi.change}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-3xl font-bold text-foreground tracking-tight mb-1">{kpi.value}</h3>
                            <p className="text-sm font-medium text-muted-foreground">{kpi.title}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Content Area - Split Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Real-Time Monitoring Panel - 2/3 width on desktop */}
                <div className="lg:col-span-2 h-full">
                    <RealTimeMonitoringPanel
                        filterSeverity={filterSeverity}
                        onIncidentClick={handleIncidentClick}
                    />
                </div>

                {/* Alert Management Sidebar - 1/3 width on desktop */}
                <div className="lg:col-span-1 h-full">
                    <AlertManagementSidebar
                        filterSeverity={filterSeverity}
                        onFilterChange={setFilterSeverity}
                        onIncidentClick={handleIncidentClick}
                    />
                </div>
            </div>

            {/* Fuel Variance Analysis - Full Width */}
            <FuelVarianceAnalysis />

            {/* Incident Details Modal */}
            {selectedIncident && (
                <IncidentDetailsModal
                    incident={selectedIncident}
                    onClose={handleCloseModal}
                />
            )}
        </div>
    );
}
