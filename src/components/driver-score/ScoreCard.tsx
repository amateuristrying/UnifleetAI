import { useState } from 'react';
import type { VehicleScore } from '@/types/driverScore';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ChevronDown, ChevronUp, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ScoreCardProps {
    vehicle: VehicleScore;
}

export function ScoreCard({ vehicle }: ScoreCardProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Score Color Logic
    const getScoreColor = (score: number) => {
        if (score >= 90) return "bg-green-500 hover:bg-green-600";
        if (score >= 70) return "bg-yellow-500 hover:bg-yellow-600";
        return "bg-red-500 hover:bg-red-600";
    };

    return (
        <Card className="mb-4 overflow-hidden border-l-4 transition-all duration-200" style={{ borderLeftColor: vehicle.totalScore >= 90 ? '#22c55e' : vehicle.totalScore >= 70 ? '#eab308' : '#ef4444' }}>
            {/* Collapsed Header */}
            <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted font-bold text-muted-foreground">
                        #{vehicle.rank}
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold">{vehicle.vehicleName}</h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <span>{vehicle.tripCount} Trips</span>
                            <span>•</span>
                            <span>{vehicle.violationCount} Violations</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <Badge className={cn("text-lg px-3 py-1", getScoreColor(vehicle.totalScore))}>
                        {vehicle.totalScore}
                    </Badge>
                    {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="border-t bg-muted/20 p-6 animate-in slide-in-from-top-2">

                    {/* 1. Score Breakdown */}
                    <div className="mb-6">
                        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Score Breakdown</h4>
                        <div className="flex flex-wrap gap-2 text-sm font-medium">
                            <span className="px-3 py-1 rounded bg-blue-100 text-blue-700">Base: 100</span>
                            <span className="px-3 py-1 rounded bg-red-100 text-red-700">- {vehicle.violationCount * 5} Speeding</span>
                            <span className="px-3 py-1 rounded bg-red-100 text-red-700">- {vehicle.dailyScores.filter(d => !d.idlingTaskPassed && !d.isNoTaskDay).length * 2} Idling</span>
                            <span className="px-3 py-1 rounded bg-green-100 text-green-700">+ {vehicle.dailyScores.filter(d => d.distanceTaskPassed && !d.isNoTaskDay).length} Distance</span>
                            <span className="px-3 py-1 rounded bg-green-100 text-green-700">+ {vehicle.dailyScores.filter(d => d.speedTaskPassed && !d.isNoTaskDay).length * 2} Perfect Days</span>
                        </div>
                    </div>

                    {/* 2. Activity Summary Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <StatBox label="Total Distance" value={`${vehicle.totalDistanceKm.toFixed(1)} km`} />
                        <StatBox label="Total Duration" value={`${(vehicle.totalDurationSeconds / 3600).toFixed(1)} hrs`} />
                        <StatBox label="Total Idle" value={`${(vehicle.totalIdleSeconds / 3600).toFixed(1)} hrs`} />
                        <StatBox label="Avg Speed" value="N/A" /> {/* To calculate avg speed across all? Or just leave N/A or calculate from dist/dur if moving time known */}
                    </div>

                    {/* 3. Daily History */}
                    <div>
                        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Daily History</h4>
                        <div className="space-y-2">
                            {vehicle.dailyScores.map((day) => (
                                <div key={day.date} className="flex items-center justify-between p-3 bg-background rounded-lg border shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="w-24 font-medium text-sm">
                                            {format(new Date(day.date), 'MMM dd, yyyy')}
                                        </div>
                                        {day.isNoTaskDay ? (
                                            <Badge variant="outline" className="text-muted-foreground">No Task Day (Sunday)</Badge>
                                        ) : (
                                            <div className="flex gap-2">
                                                <TaskBadge label="Speed" passed={day.speedTaskPassed} />
                                                <TaskBadge label="Dist > 50km" passed={day.distanceTaskPassed} />
                                                <TaskBadge label="Idle < 30m" passed={day.idlingTaskPassed} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-sm font-medium">
                                        {day.isNoTaskDay ? '-' : (
                                            <span className={day.pointsAdded - day.pointsDeducted >= 0 ? "text-green-600" : "text-red-600"}>
                                                {day.pointsAdded - day.pointsDeducted > 0 ? '+' : ''}{day.pointsAdded - day.pointsDeducted} pts
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            )}
        </Card>
    );
}

function StatBox({ label, value }: { label: string, value: string }) {
    return (
        <div className="p-3 bg-background rounded border text-center">
            <div className="text-xs text-muted-foreground uppercase">{label}</div>
            <div className="text-xl font-bold">{value}</div>
        </div>
    );
}

function TaskBadge({ label, passed }: { label: string, passed: boolean }) {
    return (
        <div className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border",
            passed ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        )}>
            {passed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {label}
        </div>
    );
}
