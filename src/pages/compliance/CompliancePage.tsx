import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { OpsToggle } from "@/components/ui/OpsToggle";
import {
    ShieldCheck, Clock, AlertTriangle,
    Zap, Ban, Truck, ArrowLeft, ChevronRight
} from "lucide-react";
import {
    getMockComplianceData
} from "./mockData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Types
type TimeRange = '30d' | 'all';
type Category = 'driver' | 'operational' | 'sla';

interface VehicleBreach {
    vehicleName: string;
    breachCount: number;
    totalDurationMinutes: number;
    severity: 'low' | 'medium' | 'high';
    instances: any[];
}

// --- Icons Mapping ---
const CATEGORY_ICONS = {
    driver: ShieldCheck,
    operational: Zap,
    sla: Clock
};

// --- Main Page Component ---
export function CompliancePage() {
    const [timeRange, setTimeRange] = useState<TimeRange>('30d');
    const [activeCategory, setActiveCategory] = useState<Category>('driver');
    const [activeMetric, setActiveMetric] = useState<string | null>(null);
    const [selectedVehicle, setSelectedVehicle] = useState<VehicleBreach | null>(null);

    // Load Data based on Time Range
    const { data: complianceData, summary } = useMemo(() => getMockComplianceData(timeRange), [timeRange]);

    // Derived Lists
    const activeVehicleList = useMemo(() => {
        if (!activeMetric) return [];
        // @ts-ignore
        return complianceData[activeMetric] || [];
    }, [activeMetric, complianceData]);


    // Handlers
    const handleCategoryClick = (cat: Category) => {
        setActiveCategory(cat);
        setActiveMetric(null);
        setSelectedVehicle(null);
    };

    const handleMetricClick = (metric: string) => {
        setActiveMetric(metric);
        setSelectedVehicle(null);
    };

    const handleBackToMetrics = () => {
        setActiveMetric(null);
        setSelectedVehicle(null);
    };

    const handleBackToVehicleList = () => {
        setSelectedVehicle(null);
    };

    return (
        <div className="flex flex-col h-full bg-surface-main overflow-y-auto">
            <div className="flex flex-col p-6 gap-6 w-full">

                {/* 1. Header Box */}
                <div className="rounded-2xl border border-border bg-surface-card shadow-sm px-8 py-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
                                <ShieldCheck className="h-6 w-6 text-primary" />
                                Compliance Intelligence
                            </h1>
                            <p className="text-muted-foreground mt-1">
                                Monitor behavioral discipline, operational efficiency, and contractual adherence.
                            </p>
                        </div>

                        <div className="flex items-center gap-4">
                            <OpsToggle />
                        </div>
                    </div>

                    {/* KPI Summary Strip */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <SummaryCard
                            label="Total Non-Compliant Vehicles"
                            value={summary.totalNonCompliantVehicles}
                            icon={<Truck className="h-5 w-5" />}
                            subtext={timeRange === '30d' ? 'Last 30 Days' : 'All Time'}
                        />
                        <SummaryCard
                            label="Most Frequent Breach"
                            value={summary.mostFrequentBreachType}
                            icon={<AlertTriangle className="h-5 w-5" />}
                            isText
                        />
                        <SummaryCard
                            label="Worst Offending Vehicle"
                            value={summary.worstOffendingVehicle?.name || 'None'}
                            icon={<Ban className="h-5 w-5" />}
                            isText
                            highlight
                        />
                    </div>

                    {/* Time Filter Toggle */}
                    <div className="flex justify-center">
                        <div className="bg-muted p-1 rounded-full inline-flex">
                            <button
                                onClick={() => setTimeRange('30d')}
                                className={cn(
                                    "px-6 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
                                    timeRange === '30d'
                                        ? "bg-surface-card shadow-sm text-primary"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                Last 30 Days
                            </button>
                            <button
                                onClick={() => setTimeRange('all')}
                                className={cn(
                                    "px-6 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
                                    timeRange === 'all'
                                        ? "bg-surface-card shadow-sm text-primary"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                All Time
                            </button>
                        </div>
                    </div>
                </div>

                {/* 2. Main Content Area */}
                <div className="flex flex-col gap-6 w-full">

                    {/* Breadcrumb / Back Navigation */}
                    {(activeMetric || selectedVehicle) && (
                        <div className="flex items-center gap-2">
                            {selectedVehicle ? (
                                <Button variant="ghost" className="gap-2 pl-0 hover:pl-2 transition-all" onClick={handleBackToVehicleList}>
                                    <ArrowLeft className="h-4 w-4" /> Back to Vehicle List
                                </Button>
                            ) : (
                                <Button variant="ghost" className="gap-2 pl-0 hover:pl-2 transition-all" onClick={handleBackToMetrics}>
                                    <ArrowLeft className="h-4 w-4" /> Back to Categories
                                </Button>
                            )}
                        </div>
                    )}

                    {/* VIEW: CATEGORIES SELECTION */}
                    {!activeMetric && !selectedVehicle && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <CategoryCard
                                id="driver"
                                title="Driver Compliance"
                                description="Behavioral and safety adherence"
                                metrics={['Speed Violations', 'Harsh Driving', 'Night Driving', 'Route Deviation']}
                                isActive={activeCategory === 'driver'}
                                onClick={() => handleCategoryClick('driver')}
                                onMetricSelect={(m) => handleMetricClick(m.toLowerCase().replace(/ /g, '_'))}
                            />
                            <CategoryCard
                                id="operational"
                                title="Operational Compliance"
                                description="Asset discipline and efficiency"
                                metrics={['Excess Idling', 'Long Dwell Time', 'Unauthorized Stops']}
                                isActive={activeCategory === 'operational'}
                                onClick={() => handleCategoryClick('operational')}
                                onMetricSelect={(m) => handleMetricClick(m.toLowerCase().replace(/ /g, '_'))}
                            />
                            <CategoryCard
                                id="sla"
                                title="SLA / Contract Compliance"
                                description="Commitment and contractual adherence"
                                metrics={['Late Delivery', 'Geofence Overstay', 'Route Non-Adherence']}
                                isActive={activeCategory === 'sla'}
                                onClick={() => handleCategoryClick('sla')}
                                onMetricSelect={(m) => handleMetricClick(m.toLowerCase().replace(/ /g, '_'))}
                            />
                        </div>
                    )}

                    {/* VIEW: VEHICLE LIST (Specific Metric) */}
                    {activeMetric && !selectedVehicle && (
                        <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-6">
                                <h2 className="text-xl font-semibold capitalize flex items-center gap-2">
                                    {activeMetric.replace(/_/g, ' ')}
                                    <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/20">
                                        {activeVehicleList.length} Violations
                                    </Badge>
                                </h2>
                                <p className="text-muted-foreground text-sm">
                                    Vehicles with {activeMetric.replace(/_/g, ' ')} in the {timeRange === '30d' ? 'last 30 days' : 'all time'}.
                                </p>
                            </div>

                            <div className="bg-surface-card rounded-xl border border-border shadow-sm overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-muted/50 border-b border-border sticky top-0">
                                        <tr>
                                            <th className="p-4 font-medium text-muted-foreground">Vehicle Name</th>
                                            <th className="p-4 font-medium text-muted-foreground">Total Count</th>
                                            <th className="p-4 font-medium text-muted-foreground">Total Duration</th>
                                            <th className="p-4 font-medium text-muted-foreground">Severity</th>
                                            <th className="p-4 font-medium text-muted-foreground text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {activeVehicleList.map((v: VehicleBreach) => (
                                            <tr
                                                key={v.vehicleName}
                                                className="group hover:bg-muted/30 transition-colors cursor-pointer"
                                                onClick={() => setSelectedVehicle(v)}
                                            >
                                                <td className="p-4 font-medium text-foreground">{v.vehicleName}</td>
                                                <td className="p-4">{v.breachCount}</td>
                                                <td className="p-4">{v.totalDurationMinutes} mins</td>
                                                <td className="p-4">
                                                    <Badge className={cn(
                                                        "capitalize shadow-none border-transparent",
                                                        v.severity === 'high' ? "bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25" :
                                                            v.severity === 'medium' ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 hover:bg-orange-500/25" :
                                                                "bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25"
                                                    )}>
                                                        {v.severity}
                                                    </Badge>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto group-hover:text-primary transition-colors" />
                                                </td>
                                            </tr>
                                        ))}
                                        {activeVehicleList.length === 0 && (
                                            <tr>
                                                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                                    No violations found for this metric in the selected period.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* VIEW: DETAIL TABLE (Specific Vehicle) */}
                    {selectedVehicle && (
                        <div className="flex flex-col animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="mb-6 flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold flex items-center gap-2">
                                        {selectedVehicle.vehicleName}
                                        <Badge variant="secondary" className="bg-muted text-muted-foreground font-normal">
                                            {activeMetric?.replace(/_/g, ' ')}
                                        </Badge>
                                    </h2>
                                    <div className="flex items-center gap-6 mt-4">
                                        <div className="flex flex-col">
                                            <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Duration</span>
                                            <span className="text-2xl font-bold text-foreground">
                                                {selectedVehicle.totalDurationMinutes}
                                                <span className="text-sm font-normal text-muted-foreground ml-1">mins</span>
                                            </span>
                                        </div>
                                        <div className="h-8 w-px bg-border" />
                                        <div className="flex flex-col">
                                            <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Incidents</span>
                                            <span className="text-2xl font-bold text-foreground">
                                                {selectedVehicle.breachCount}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-surface-card rounded-xl border border-border shadow-sm overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-muted/50 border-b border-border sticky top-0">
                                        <tr>
                                            <th className="p-4 font-medium text-muted-foreground">Start Time</th>
                                            <th className="p-4 font-medium text-muted-foreground">End Time</th>
                                            <th className="p-4 font-medium text-muted-foreground">Duration</th>
                                            <th className="p-4 font-medium text-muted-foreground">Details</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {selectedVehicle.instances?.map((inst: any) => (
                                            <tr key={inst.id} className="hover:bg-muted/30">
                                                <td className="p-4 tabular-nums text-foreground">
                                                    {new Date(inst.startTime).toLocaleString()}
                                                </td>
                                                <td className="p-4 tabular-nums text-foreground">
                                                    {new Date(inst.endTime).toLocaleString()}
                                                </td>
                                                <td className="p-4 tabular-nums font-medium">
                                                    {inst.durationMinutes} min
                                                </td>
                                                <td className="p-4 text-muted-foreground">
                                                    {inst.details || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// --- Sub-components for Cleanliness ---

interface SummaryCardProps {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    subtext?: string;
    highlight?: boolean;
    isText?: boolean; // Keep if we plan to use it or remove if truly unused
}

function SummaryCard({ label, value, icon, subtext, highlight }: SummaryCardProps) {
    return (
        <div className={cn(
            "flex flex-col p-4 rounded-xl border bg-surface-main/50 backdrop-blur-sm",
            highlight ? "border-red-500/20 bg-red-500/5" : "border-border"
        )}>
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider mb-2">
                {icon}
                {label}
            </div>
            <div className={cn("text-2xl font-bold tracking-tight", highlight && "text-red-500")}>
                {value}
            </div>
            {subtext && <div className="text-xs text-muted-foreground mt-1">{subtext}</div>}
        </div>
    );
}

interface CategoryCardProps {
    id: Category;
    title: string;
    description: string;
    metrics: string[];
    isActive: boolean;
    onClick: () => void;
    onMetricSelect: (metric: string) => void;
}

function CategoryCard({ id, title, description, metrics, isActive, onClick, onMetricSelect }: CategoryCardProps) {
    const Icon = CATEGORY_ICONS[id];

    return (
        <div
            className={cn(
                "relative flex flex-col p-6 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden group",
                isActive
                    ? "bg-surface-card border-primary ring-1 ring-primary shadow-lg scale-[1.02]"
                    : "bg-surface-card border-border hover:border-primary/50 hover:shadow-md opacity-80 hover:opacity-100"
            )}
            onClick={onClick}
        >
            <div className="flex items-start justify-between mb-4">
                <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                )}>
                    <Icon className="h-6 w-6" />
                </div>
                {isActive && <Badge variant="default" className="bg-primary/10 text-primary border-primary/20 pointer-events-none">Active</Badge>}
            </div>

            <h3 className="text-xl font-bold text-foreground mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground mb-6">{description}</p>

            {/* Metrics List (Expanded if active) */}
            <div className={cn(
                "space-y-2 transition-all duration-500 ease-in-out",
                isActive ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
            )}>
                {metrics.map((m) => (
                    <button
                        key={m}
                        onClick={(e) => {
                            e.stopPropagation();
                            onMetricSelect(m);
                        }}
                        className="w-full text-left px-4 py-3 rounded-lg bg-muted/40 hover:bg-muted border border-transparent hover:border-border flex items-center justify-between group/btn transition-all"
                    >
                        <span className="text-sm font-medium text-foreground">{m}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover/btn:text-primary opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                    </button>
                ))}
            </div>
        </div>
    );
}

// Export default for lazy loading if needed, though mostly named export is used
export default CompliancePage;
