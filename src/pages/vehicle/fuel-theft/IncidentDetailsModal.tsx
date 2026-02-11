import { AlertCircle, X, MapPin, Cpu, FileText, Clock, CheckCircle, AlertTriangle, Lightbulb, ArrowRight, Circle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface IncidentDetailsModalProps {
    incident: any;
    onClose: () => void;
}

const IncidentDetailsModal = ({ incident, onClose }: IncidentDetailsModalProps) => {
    if (!incident) return null;

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

    const formatTimestamp = (timestamp: any) => {
        // Handle both Date object and string/number
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    };

    // Mock detailed incident data
    const incidentDetails = {
        ...incident,
        detectedBy: 'AI Anomaly Detection System',
        confidence: 94,
        evidence: [
            'Fuel level dropped 45L in 15 minutes during idle time',
            'No corresponding refueling transaction recorded',
            'GPS location shows vehicle stationary at unauthorized location',
            'Driver behavior pattern deviation detected'
        ],
        timeline: [
            { time: '14:23', event: 'Vehicle entered parking area', status: 'normal' },
            { time: '14:35', event: 'Engine turned off', status: 'normal' },
            { time: '14:38', event: 'Fuel level anomaly detected', status: 'alert' },
            { time: '14:52', event: 'Fuel drain completed', status: 'critical' },
            { time: '14:55', event: 'Alert triggered to security team', status: 'action' }
        ],
        recommendations: [
            'Immediate vehicle inspection required',
            'Interview driver and review CCTV footage',
            'Check fuel tank seal and locking mechanism',
            'Review parking area security protocols'
        ]
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity"
                onClick={onClose}
            />

            {/* Full Screen Overlay */}
            <div className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in zoom-in duration-200">
                <div className="max-w-5xl mx-auto min-h-screen flex flex-col">
                    {/* Header */}
                    <div className="sticky top-0 bg-background border-b border-border p-6 flex items-start justify-between gap-4 z-10">
                        <div className="flex items-start gap-3">
                            <div className={cn("flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center border border-transparent", getSeverityColor(incident?.severity))}>
                                <AlertCircle className="w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-foreground mb-1">
                                    {incidentDetails?.title || 'Incident Details'}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    Incident ID: #{incidentDetails?.id} • {formatTimestamp(incidentDetails?.timestamp)}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex-shrink-0 p-2 rounded-full hover:bg-muted transition-colors"
                            aria-label="Close modal"
                        >
                            <X className="w-5 h-5 text-muted-foreground" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        {/* Key Metrics */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-muted/30 rounded-lg p-3 border border-border">
                                <p className="text-xs text-muted-foreground mb-1">Vehicle ID</p>
                                <p className="text-sm font-semibold text-foreground">{incidentDetails?.vehicleId}</p>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 border border-border">
                                <p className="text-xs text-muted-foreground mb-1">Driver</p>
                                <p className="text-sm font-semibold text-foreground">{incidentDetails?.driver || 'Unknown'}</p>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 border border-border">
                                <p className="text-xs text-muted-foreground mb-1">Fuel Loss</p>
                                <p className="text-sm font-semibold text-red-600 dark:text-red-500">{incidentDetails?.fuelLoss}</p>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 border border-border">
                                <p className="text-xs text-muted-foreground mb-1">Risk Score</p>
                                <p className="text-sm font-semibold text-red-600 dark:text-red-500">{incidentDetails?.riskScore || 0}/100</p>
                            </div>
                        </div>

                        {/* Location */}
                        <div>
                            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-primary" />
                                Location
                            </h3>
                            <p className="text-sm text-foreground bg-muted/30 p-3 rounded-lg border border-border">
                                {incidentDetails?.location}
                            </p>
                        </div>

                        {/* Detection Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-primary" />
                                    Detection Information
                                </h3>
                                <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-muted-foreground">Detected By:</span>
                                        <span className="text-sm font-medium text-foreground">{incidentDetails?.detectedBy}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Confidence Level:</span>
                                        <span className="text-sm font-medium text-green-600 dark:text-green-500">{incidentDetails?.confidence}%</span>
                                    </div>
                                </div>
                            </div>

                            {/* Evidence */}
                            <div>
                                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-primary" />
                                    Evidence
                                </h3>
                                <ul className="space-y-2 bg-muted/30 p-3 rounded-lg border border-border">
                                    {incidentDetails?.evidence?.map((item: string, index: number) => (
                                        <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                                            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        {/* Timeline */}
                        <div>
                            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                <Clock className="w-4 h-4 text-primary" />
                                Incident Timeline
                            </h3>
                            <div className="space-y-3 pl-2">
                                {incidentDetails?.timeline?.map((item: any, index: number) => (
                                    <div key={index} className="flex items-start gap-3 relative before:absolute before:left-[15px] before:top-8 before:bottom-[-12px] before:w-0.5 before:bg-border last:before:hidden">
                                        <div className={cn("flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10 border border-transparent",
                                            item?.status === 'critical' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500' :
                                                item?.status === 'alert' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500' :
                                                    item?.status === 'action' ? 'bg-blue-50 text-blue-600 dark:bg-primary/10 dark:text-primary' : 'bg-muted text-muted-foreground'
                                        )}>
                                            <Circle className="w-2 h-2 fill-current" />
                                        </div>
                                        <div className="flex-1 pb-1">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="text-xs font-semibold text-foreground">{item?.time}</span>
                                                <span className={cn("text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold",
                                                    item?.status === 'critical' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500' :
                                                        item?.status === 'alert' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500' :
                                                            item?.status === 'action' ? 'bg-blue-50 text-blue-600 dark:bg-primary/10 dark:text-primary' : 'bg-muted text-muted-foreground'
                                                )}>
                                                    {item?.status}
                                                </span>
                                            </div>
                                            <p className="text-sm text-muted-foreground">{item?.event}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recommendations */}
                        <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/20 rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-500 mb-2 flex items-center gap-2">
                                <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-500" />
                                Recommended Actions
                            </h3>
                            <ul className="space-y-2">
                                {incidentDetails?.recommendations?.map((item: string, index: number) => (
                                    <li key={index} className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-400">
                                        <ArrowRight className="w-4 h-4 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="sticky bottom-0 bg-background border-t border-border p-6 flex flex-col sm:flex-row gap-3 z-10 rounded-b-xl">
                        <Button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground">
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Mark as Resolved
                        </Button>
                        <Button variant="destructive" className="flex-1">
                            <AlertTriangle className="w-4 h-4 mr-2" />
                            Escalate to Security
                        </Button>
                        <Button variant="outline">
                            <Download className="w-4 h-4 mr-2" />
                            Export Report
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default IncidentDetailsModal;
