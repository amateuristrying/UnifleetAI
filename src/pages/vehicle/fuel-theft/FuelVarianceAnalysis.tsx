import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart3, Users, AlertCircle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';

const FuelVarianceAnalysis = () => {
    const [analysisView, setAnalysisView] = useState<'variance' | 'correlation'>('variance');

    // Mock variance data
    const varianceData = [
        { vehicle: 'WB-19-AB-1234', expected: 120, actual: 165, variance: 45, status: 'critical' },
        { vehicle: 'WB-19-CD-5678', expected: 95, actual: 123, variance: 28, status: 'warning' },
        { vehicle: 'WB-19-EF-9012', expected: 140, actual: 192, variance: 52, status: 'critical' },
        { vehicle: 'WB-19-GH-3456', expected: 85, actual: 103, variance: 18, status: 'warning' },
        { vehicle: 'WB-19-IJ-7890', expected: 110, actual: 122, variance: 12, status: 'normal' },
        { vehicle: 'WB-19-KL-2345', expected: 75, actual: 81, variance: 6, status: 'normal' },
        { vehicle: 'WB-19-MN-6789', expected: 130, actual: 138, variance: 8, status: 'normal' }
    ];

    // Mock driver behavior correlation
    const correlationData = [
        { driver: 'Rajesh Kumar', incidents: 8, avgVariance: 42, riskScore: 92, behavior: 'high-risk' },
        { driver: 'Amit Sharma', incidents: 5, avgVariance: 28, riskScore: 68, behavior: 'moderate-risk' },
        { driver: 'Suresh Patel', incidents: 7, avgVariance: 38, riskScore: 85, behavior: 'high-risk' },
        { driver: 'Vikram Singh', incidents: 3, avgVariance: 18, riskScore: 45, behavior: 'low-risk' },
        { driver: 'Manoj Gupta', incidents: 2, avgVariance: 12, riskScore: 32, behavior: 'low-risk' }
    ];

    const getVarianceColor = (status: string) => {
        switch (status) {
            case 'critical':
                return '#ef4444'; // red-500
            case 'warning':
                return '#f59e0b'; // amber-500
            case 'normal':
                return '#22c55e'; // green-500
            default:
                return '#9ca3af';
        }
    };

    const getBehaviorColor = (behavior: string) => {
        switch (behavior) {
            case 'high-risk':
                return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20';
            case 'moderate-risk':
                return 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:text-amber-500 dark:border-amber-500/20';
            case 'low-risk':
                return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-500/10 dark:text-green-500 dark:border-green-500/20';
            default:
                return 'text-muted-foreground bg-muted border-border';
        }
    };

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload?.length) {
            const data = payload?.[0]?.payload;
            return (
                <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                    <p className="text-sm font-medium text-popover-foreground mb-2">{data?.vehicle}</p>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4 text-xs">
                            <span className="text-muted-foreground">Expected:</span>
                            <span className="font-medium text-popover-foreground">{data?.expected}L</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-xs">
                            <span className="text-muted-foreground">Actual:</span>
                            <span className="font-medium text-popover-foreground">{data?.actual}L</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-xs">
                            <span className="text-muted-foreground">Variance:</span>
                            <span className="font-bold text-red-600 dark:text-red-500">+{data?.variance}L</span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-surface-card border border-border rounded-xl p-6 shadow-sm">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-foreground mb-1">
                        Fuel Variance Analysis
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        Threshold-based alerting and driver behavior correlation
                    </p>
                </div>
                <div className="flex gap-2 bg-muted p-1 rounded-lg">
                    <button
                        onClick={() => setAnalysisView('variance')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                            analysisView === 'variance'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <BarChart3 className="w-4 h-4" />
                        Variance
                    </button>
                    <button
                        onClick={() => setAnalysisView('correlation')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                            analysisView === 'correlation'
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Users className="w-4 h-4" />
                        Driver Correlation
                    </button>
                </div>
            </div>

            {/* Variance View */}
            {analysisView === 'variance' && (
                <div className="animate-in fade-in duration-300">
                    <div className="w-full h-80 mb-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={varianceData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis
                                    dataKey="vehicle"
                                    stroke="hsl(var(--muted-foreground))"
                                    tick={{ fontSize: 11 }}
                                    angle={-45}
                                    textAnchor="end"
                                    height={80}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    stroke="hsl(var(--muted-foreground))"
                                    tick={{ fontSize: 12 }}
                                    axisLine={false}
                                    tickLine={false}
                                    label={{ value: 'Fuel (L)', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 } }}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="variance" radius={[4, 4, 0, 0]}>
                                    {varianceData?.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={getVarianceColor(entry?.status)} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap justify-center border-t border-border pt-4">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded bg-red-500" />
                            <span>Critical (&gt;40L)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded bg-amber-500" />
                            <span>Warning (20-40L)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded bg-green-500" />
                            <span>Normal (&lt;20L)</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Driver Correlation View */}
            {analysisView === 'correlation' && (
                <div className="space-y-3 animate-in fade-in duration-300">
                    <div className="grid grid-cols-4 gap-3 text-xs font-bold text-muted-foreground/60 uppercase tracking-wider pb-2 border-b border-border">
                        <div>Driver Name</div>
                        <div className="text-center">Incidents</div>
                        <div className="text-center">Avg Variance</div>
                        <div className="text-center">Risk Level</div>
                    </div>
                    {correlationData?.map((driver, index) => (
                        <div key={index} className="grid grid-cols-4 gap-3 items-center bg-muted/30 rounded-lg p-3 hover:bg-muted/60 transition-colors">
                            <div>
                                <p className="text-sm font-semibold text-foreground">{driver?.driver}</p>
                            </div>
                            <div className="text-center">
                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500 text-sm font-bold">
                                    {driver?.incidents}
                                </span>
                            </div>
                            <div className="text-center">
                                <span className="text-sm font-medium text-muted-foreground">{driver?.avgVariance}L</span>
                            </div>
                            <div className="text-center">
                                <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border", getBehaviorColor(driver?.behavior))}>
                                    <AlertCircle className="w-3 h-3" />
                                    {driver?.riskScore}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Predictive Insights */}
            <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-start gap-4 bg-primary/5 border border-primary/10 rounded-xl p-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Lightbulb className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-sm font-bold text-primary mb-1">Predictive Theft Risk Indicator</h4>
                        <p className="text-sm text-primary/80 mb-3 leading-relaxed">
                            Machine learning analysis suggests 3 vehicles are at high risk of fuel theft in the next 48 hours based on historical patterns and driver behavior.
                        </p>
                        <Button variant="link" size="sm" className="p-0 h-auto text-primary font-semibold hover:text-primary/80">
                            View Detailed Analysis →
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FuelVarianceAnalysis;
