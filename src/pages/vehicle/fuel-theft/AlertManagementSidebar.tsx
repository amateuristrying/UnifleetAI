import { AlertCircle, CheckCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AlertManagementSidebarProps {
    filterSeverity: string;
    onFilterChange: (severity: string) => void;
    onIncidentClick: (incident: any) => void;
}

const AlertManagementSidebar = ({ filterSeverity, onFilterChange, onIncidentClick }: AlertManagementSidebarProps) => {
    const severityFilters = [
        { value: 'all', label: 'All Alerts', count: 84 },
        { value: 'critical', label: 'Critical', count: 12 },
        { value: 'warning', label: 'Warning', count: 27 },
        { value: 'info', label: 'Info', count: 45 }
    ];

    // Mock prioritized incident queue with risk scoring
    const incidents = [
        {
            id: 1,
            title: 'Excessive Fuel Drain Detected',
            vehicleId: 'WB-19-AB-1234',
            driver: 'Rajesh Kumar',
            severity: 'critical',
            riskScore: 95,
            fuelLoss: '45L',
            timestamp: new Date(Date.now() - 7200000),
            location: 'Warehouse District, Kolkata',
            status: 'unresolved'
        },
        {
            id: 2,
            title: 'Unusual Refueling Pattern',
            vehicleId: 'WB-19-CD-5678',
            driver: 'Amit Sharma',
            severity: 'warning',
            riskScore: 72,
            fuelLoss: '28L',
            timestamp: new Date(Date.now() - 14400000),
            location: 'Highway NH-16',
            status: 'investigating'
        },
        {
            id: 3,
            title: 'Fuel Tank Tampering Alert',
            vehicleId: 'WB-19-EF-9012',
            driver: 'Suresh Patel',
            severity: 'critical',
            riskScore: 88,
            fuelLoss: '52L',
            timestamp: new Date(Date.now() - 21600000),
            location: 'Industrial Area, Durgapur',
            status: 'unresolved'
        },
        {
            id: 4,
            title: 'Consumption Variance Detected',
            vehicleId: 'WB-19-GH-3456',
            driver: 'Vikram Singh',
            severity: 'warning',
            riskScore: 65,
            fuelLoss: '18L',
            timestamp: new Date(Date.now() - 28800000),
            location: 'City Center, Kolkata',
            status: 'investigating'
        },
        {
            id: 5,
            title: 'Suspicious Idle Time Pattern',
            vehicleId: 'WB-19-IJ-7890',
            driver: 'Manoj Gupta',
            severity: 'info',
            riskScore: 45,
            fuelLoss: '12L',
            timestamp: new Date(Date.now() - 36000000),
            location: 'Parking Lot, Salt Lake',
            status: 'monitoring'
        }
    ];

    const filteredIncidents = filterSeverity === 'all'
        ? incidents
        : incidents?.filter(inc => inc?.severity === filterSeverity);

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical':
                return 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20';
            case 'warning':
                return 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-500 dark:border-amber-500/20';
            case 'info':
                return 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-500 dark:border-blue-500/20';
            default:
                return 'bg-muted text-muted-foreground border-border';
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'unresolved':
                return 'text-red-500';
            case 'investigating':
                return 'text-amber-500';
            case 'monitoring':
                return 'text-blue-500';
            default:
                return 'text-gray-500';
        }
    };

    const getRiskScoreColor = (score: number) => {
        if (score >= 80) return 'text-red-600';
        if (score >= 60) return 'text-amber-600';
        return 'text-green-600';
    };

    const formatTimeAgo = (timestamp: Date) => {
        const seconds = Math.floor((new Date().getTime() - timestamp.getTime()) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    return (
        <div className="bg-surface-card border border-border rounded-xl p-4 md:p-6 shadow-sm h-full flex flex-col">
            {/* Header */}
            <div className="mb-6">
                <h3 className="text-lg font-bold text-foreground mb-1">
                    Alert Management
                </h3>
                <p className="text-sm text-muted-foreground">
                    Prioritized incident queue
                </p>
            </div>

            {/* Severity Filters */}
            <div className="space-y-2 mb-6">
                {severityFilters?.map((filter) => (
                    <button
                        key={filter?.value}
                        onClick={() => onFilterChange(filter?.value)}
                        className={cn(
                            "w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                            filterSeverity === filter?.value
                                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                                : "bg-muted/50 text-muted-foreground hover:bg-muted"
                        )}
                    >
                        <span>{filter?.label}</span>
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold",
                            filterSeverity === filter?.value
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : "bg-surface-card text-muted-foreground border border-border"
                        )}>
                            {filter?.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Incident Queue */}
            <div className="space-y-3 flex flex-col flex-1 min-h-0">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-foreground">
                        Active Incidents ({filteredIncidents?.length})
                    </h4>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs text-primary">
                        View All
                    </Button>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto pr-1 scrollbar-thin min-h-0">
                    {filteredIncidents?.map((incident) => (
                        <button
                            key={incident?.id}
                            onClick={() => onIncidentClick(incident)}
                            className="w-full bg-surface-card border border-border rounded-xl p-3 hover:bg-muted/50 hover:border-primary/50 hover:shadow-sm transition-all text-left group"
                        >
                            {/* Header */}
                            <div className="flex items-start gap-3 mb-2">
                                <div className={cn("flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border border-transparent", getSeverityColor(incident?.severity))}>
                                    <AlertCircle className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-foreground mb-0.5 truncate group-hover:text-primary transition-colors">
                                        {incident?.title}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {incident?.vehicleId} • {incident?.driver}
                                    </p>
                                </div>
                            </div>

                            {/* Risk Score */}
                            <div className="flex items-center gap-2 mb-3">
                                <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className={cn("h-full transition-all rounded-full",
                                            incident?.riskScore >= 80 ? 'bg-red-500' :
                                                incident?.riskScore >= 60 ? 'bg-amber-500' : 'bg-green-500'
                                        )}
                                        style={{ width: `${incident?.riskScore}%` }}
                                    />
                                </div>
                                <span className={cn("text-xs font-bold", getRiskScoreColor(incident?.riskScore))}>
                                    {incident?.riskScore}
                                </span>
                            </div>

                            {/* Details */}
                            <div className="bg-muted/30 rounded-lg p-2 space-y-1.5 border border-border">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Fuel Loss:</span>
                                    <span className="font-semibold text-red-600 dark:text-red-400">{incident?.fuelLoss}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className={cn("font-medium capitalize", getStatusColor(incident?.status))}>
                                        {incident?.status}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Time:</span>
                                    <span className="font-medium text-foreground">{formatTimeAgo(incident?.timestamp)}</span>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Bulk Actions */}
            <div className="mt-4 pt-4 border-t border-border">
                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Acknowledge Selected
                </Button>
            </div>
        </div>
    );
};

export default AlertManagementSidebar;
