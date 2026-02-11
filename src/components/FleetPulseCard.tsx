import { Info, Activity, Gauge } from 'lucide-react';
import type { FleetAnalysis } from '@/types/fleet-analysis';
import { STATUS_CONFIGS } from '@/types/fleet-analysis';

interface FleetPulseCardProps {
    analysis: FleetAnalysis | null;
    loading?: boolean;
}

export function FleetPulseCard({ analysis, loading = false }: FleetPulseCardProps) {
    if (loading || !analysis) {
        return (
            <div className="w-full max-w-3xl rounded-[32px] p-10 bg-surface-card shadow-xl">
                <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-4">
                        <Activity className="h-12 w-12 animate-pulse text-muted-foreground" />
                        <span className="text-muted-foreground">Loading fleet data...</span>
                    </div>
                </div>
            </div>
        );
    }

    const getUtilizationColor = (pct: number): string => {
        if (pct >= 50) return '#10B981';
        if (pct >= 25) return '#F97316';
        return '#EF4444';
    };

    const utilizationColor = getUtilizationColor(analysis.movingPct);

    return (
        <div className="w-full max-w-3xl rounded-[32px] p-10 relative overflow-hidden bg-surface-card shadow-xl">
            {/* Subtle gradient background effect */}
            <div
                className="absolute inset-0 opacity-5 pointer-events-none"
                style={{
                    background: `radial-gradient(circle at 30% 20%, ${utilizationColor} 0%, transparent 50%)`,
                }}
            />

            {/* Content */}
            <div className="relative z-10">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <Activity className="h-6 w-6" style={{ color: utilizationColor }} />
                        <h2 className="text-xl font-semibold tracking-wide uppercase text-muted-foreground">
                            Fleet Pulse
                        </h2>
                    </div>

                    <div className="relative group">
                        <Info className="h-5 w-5 cursor-help text-muted-foreground hover:text-foreground transition-colors" />
                        <div className="absolute right-0 top-8 w-72 p-4 rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 bg-gray-800 text-white shadow-lg">
                            <p className="text-sm leading-relaxed">
                                <strong>Fleet Pulse</strong> shows real-time vehicle status distribution.
                            </p>
                            <ul className="mt-2 text-xs space-y-1 text-gray-300">
                                <li>🟢 <strong>Moving</strong> - Actively in motion</li>
                                <li>🔴 <strong>Stopped</strong> - Engine off, temp stop</li>
                                <li>🔵 <strong>Parked</strong> - Engine off, parked</li>
                                <li>🟠 <strong>Idle-Stop</strong> - Engine on, stopped</li>
                                <li>🟣 <strong>Idle-Park</strong> - Engine on, parked</li>
                                <li>⚫ <strong>Offline</strong> - No connection</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Main Metric */}
                <div className="text-center mb-10">
                    <div className="flex items-baseline justify-center gap-3">
                        <span
                            className="text-8xl font-bold tracking-tight"
                            style={{ color: utilizationColor }}
                        >
                            {analysis.movingPct}%
                        </span>
                        <span className="text-3xl font-medium text-muted-foreground">
                            Active
                        </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {analysis.moving} of {analysis.total} vehicles moving
                    </p>
                </div>

                {/* Segmented Progress Bar */}
                <div className="mb-8">
                    <div className="h-4 rounded-full overflow-hidden flex bg-muted">
                        {STATUS_CONFIGS.map((config) => {
                            const count = analysis[config.key] as number;
                            const widthPct = (count / analysis.total) * 100;

                            if (widthPct === 0) return null;

                            return (
                                <div
                                    key={config.key}
                                    className={`h-full transition-all duration-500 ease-out first:rounded-l-full last:rounded-r-full ${config.tailwindBg}`}
                                    title={`${config.label}: ${count} (${Math.round(widthPct)}%)`}
                                    style={{ width: `${widthPct}%` }}
                                />
                            );
                        })}
                    </div>
                </div>

                {/* Status Legend Grid */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    {STATUS_CONFIGS.map((config) => {
                        const count = analysis[config.key] as number;
                        return (
                            <div key={config.key} className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${config.tailwindBg}`} />
                                <span className="font-semibold text-lg text-foreground">
                                    {count}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    {config.shortLabel}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Average Speed Footer */}
                <div className="flex items-center justify-center gap-3 pt-6 border-t border-border">
                    <Gauge className="h-5 w-5 text-blue-500" />
                    <span className="text-muted-foreground">
                        Average Speed:
                    </span>
                    <span className="font-bold text-lg text-blue-600 dark:text-blue-400">
                        {analysis.avgSpeed} km/h
                    </span>
                </div>
            </div>
        </div>
    );
}
