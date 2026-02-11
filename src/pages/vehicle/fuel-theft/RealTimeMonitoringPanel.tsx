import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Activity, MapPin, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface RealTimeMonitoringPanelProps {
    filterSeverity: string;
    onIncidentClick: (incident: any) => void;
}

const RealTimeMonitoringPanel = ({ filterSeverity: _filterSeverity, onIncidentClick }: RealTimeMonitoringPanelProps) => {
    const [viewMode, setViewMode] = useState<'timeline' | 'map'>('timeline');

    // Mock data for fuel consumption anomalies
    const timelineData = [
        { time: '00:00', consumption: 45, threshold: 50, anomaly: false },
        { time: '02:00', consumption: 48, threshold: 50, anomaly: false },
        { time: '04:00', consumption: 52, threshold: 50, anomaly: true },
        { time: '06:00', consumption: 67, threshold: 50, anomaly: true },
        { time: '08:00', consumption: 49, threshold: 50, anomaly: false },
        { time: '10:00', consumption: 51, threshold: 50, anomaly: true },
        { time: '12:00', consumption: 46, threshold: 50, anomaly: false },
        { time: '14:00', consumption: 72, threshold: 50, anomaly: true },
        { time: '16:00', consumption: 48, threshold: 50, anomaly: false },
        { time: '18:00', consumption: 50, threshold: 50, anomaly: false },
        { time: '20:00', consumption: 65, threshold: 50, anomaly: true },
        { time: '22:00', consumption: 47, threshold: 50, anomaly: false }
    ];

    // Mock geographic incidents
    const geographicIncidents = [
        {
            id: 1,
            location: 'Warehouse District, Kolkata',
            vehicleId: 'WB-19-AB-1234',
            severity: 'critical',
            fuelLoss: '45L',
            timestamp: '2 hours ago',
            lat: 22.5726,
            lng: 88.3639
        },
        {
            id: 2,
            location: 'Highway NH-16, Bhubaneswar',
            vehicleId: 'WB-19-CD-5678',
            severity: 'warning',
            fuelLoss: '28L',
            timestamp: '4 hours ago',
            lat: 20.2961,
            lng: 85.8245
        },
        {
            id: 3,
            location: 'Industrial Area, Durgapur',
            vehicleId: 'WB-19-EF-9012',
            severity: 'critical',
            fuelLoss: '52L',
            timestamp: '6 hours ago',
            lat: 23.5204,
            lng: 87.3119
        }
    ];

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload?.length) {
            const isAnomaly = payload?.[0]?.payload?.anomaly;
            return (
                <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                    <p className="text-sm font-medium text-popover-foreground mb-2">{label}</p>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                            <div className="w-3 h-3 rounded-full bg-blue-500" />
                            <span className="text-muted-foreground">Consumption:</span>
                            <span className="font-medium text-popover-foreground">{payload?.[0]?.value}L</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <div className="w-3 h-3 rounded-full bg-amber-500" />
                            <span className="text-muted-foreground">Threshold:</span>
                            <span className="font-medium text-popover-foreground">{payload?.[1]?.value}L</span>
                        </div>
                        {isAnomaly && (
                            <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500 mt-2 font-medium">
                                <AlertCircle className="w-3 h-3" />
                                <span>Anomaly Detected</span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical':
                return 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20';
            case 'warning':
                return 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-500 dark:border-amber-500/20';
            default:
                return 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-500 dark:border-blue-500/20';
        }
    };

    return (
        <div className="bg-surface-card border border-border rounded-xl p-6 shadow-sm h-full">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-foreground mb-1">
                        Real-Time Monitoring
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        Live fuel consumption anomalies
                    </p>
                </div>
                <div className="flex gap-2 bg-muted p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('timeline')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                            viewMode === 'timeline'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Activity className="w-4 h-4" />
                        Timeline
                    </button>
                    <button
                        onClick={() => setViewMode('map')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                            viewMode === 'map'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <MapPin className="w-4 h-4" />
                        Map
                    </button>
                </div>
            </div>

            {/* Timeline View */}
            {viewMode === 'timeline' && (
                <div className="animate-in fade-in duration-300">
                    <div className="w-full h-80 mb-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={timelineData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <XAxis
                                    dataKey="time"
                                    stroke="#9ca3af"
                                    tick={{ fontSize: 12 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    stroke="#9ca3af"
                                    tick={{ fontSize: 12 }}
                                    axisLine={false}
                                    tickLine={false}
                                    label={{ value: 'Fuel (L)', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af', fontSize: 12 } }}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <ReferenceLine
                                    y={50}
                                    stroke="#f59e0b"
                                    strokeDasharray="5 5"
                                    label={{ value: 'Threshold', position: 'right', style: { fontSize: '11px', fill: '#f59e0b' } }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="consumption"
                                    stroke="#3b82f6"
                                    strokeWidth={3}
                                    dot={(props: any) => {
                                        const { cx, cy, payload } = props;
                                        return (
                                            <circle
                                                cx={cx}
                                                cy={cy}
                                                r={payload?.anomaly ? 6 : 4}
                                                fill={payload?.anomaly ? '#dc2626' : '#3b82f6'}
                                                stroke="white"
                                                strokeWidth={2}
                                            />
                                        );
                                    }}
                                    activeDot={{ r: 8 }}
                                    name="Fuel Consumption"
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex items-center gap-6 text-xs text-muted-foreground justify-center bg-muted/50 py-3 rounded-lg border border-border">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500" />
                            <span>Normal Consumption</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-600 dark:bg-red-500" />
                            <span>Anomaly Detected</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-0.5 bg-amber-500" style={{ width: '16px' }} />
                            <span>Alert Threshold</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Geographic Map View */}
            {viewMode === 'map' && (
                <div className="animate-in fade-in duration-300">
                    <div className="w-full h-80 bg-muted/20 rounded-xl mb-6 relative overflow-hidden border border-border">
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                                <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground font-medium">Geographic incident mapping</p>
                                <p className="text-xs text-muted-foreground/60 mt-1">Interactive map visualization placeholder</p>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-foreground border-b border-border pb-2">Recent Incidents by Location</h4>
                        {geographicIncidents?.map((incident) => (
                            <button
                                key={incident?.id}
                                onClick={() => onIncidentClick(incident)}
                                className="w-full bg-surface-card border border-border rounded-lg p-3 hover:bg-muted/50 transition-all text-left flex items-start gap-4 group"
                            >
                                <div className={cn("flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors border border-transparent", getSeverityColor(incident?.severity))}>
                                    <MapPin className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{incident?.location}</p>
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">{incident?.timestamp}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span>Vehicle: <span className="font-medium text-foreground/80">{incident?.vehicleId}</span></span>
                                        <span className="text-muted-foreground/40">•</span>
                                        <span className="text-red-600 dark:text-red-400 font-medium">Loss: {incident?.fuelLoss}</span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RealTimeMonitoringPanel;
