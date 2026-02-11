import { AlertCircle, AlertTriangle, FileText, Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertSummaryCardProps {
    title: string;
    count: number;
    severity: 'critical' | 'warning' | 'info' | 'muted' | string;
    icon: string;
    trend: 'up' | 'down' | string;
    percentage: number;
    description: string;
    onClick?: () => void;
}

const AlertSummaryCard = ({
    title,
    count,
    severity,
    icon,
    trend,
    percentage,
    description,
    onClick
}: AlertSummaryCardProps) => {

    const getSeverityClasses = () => {
        switch (severity) {
            case 'critical':
                return 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20';
            case 'warning':
                return 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-500 dark:border-amber-500/20';
            case 'info':
                return 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-500 dark:border-blue-500/20';
            case 'muted':
                return 'bg-muted text-muted-foreground border-border';
            default:
                return 'bg-surface-card text-foreground border-border';
        }
    };

    const getIconComponent = (iconName: string) => {
        switch (iconName) {
            case 'AlertCircle': return <AlertCircle className="w-6 h-6" />;
            case 'AlertTriangle': return <AlertTriangle className="w-6 h-6" />;
            case 'FileText': return <FileText className="w-6 h-6" />;
            case 'Activity': return <Activity className="w-6 h-6" />;
            default: return <Activity className="w-6 h-6" />;
        }
    };

    const getTrendIcon = () => {
        if (trend === 'up') return <TrendingUp className="w-4 h-4" />;
        if (trend === 'down') return <TrendingDown className="w-4 h-4" />;
        return <Minus className="w-4 h-4" />;
    };

    const getTrendColor = () => {
        if (severity === 'critical' || severity === 'warning') {
            return trend === 'up' ? 'text-red-600 dark:text-red-500' : 'text-green-600 dark:text-green-500';
        }
        return trend === 'up' ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500';
    };

    return (
        <button
            onClick={onClick}
            className="w-full bg-surface-card border border-border rounded-xl p-6 hover:shadow-md transition-all hover:-translate-y-1 text-left"
        >
            <div className="flex items-start justify-between mb-4">
                <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center border", getSeverityClasses())}>
                    {getIconComponent(icon)}
                </div>
                <div className={cn("flex items-center gap-1", getTrendColor())}>
                    {getTrendIcon()}
                    <span className="text-sm font-medium">{percentage}%</span>
                </div>
            </div>
            <div>
                <h3 className="text-3xl font-bold text-foreground mb-1">
                    {count?.toLocaleString('en-IN')}
                </h3>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                    {title}
                </p>
                <p className="text-xs text-muted-foreground/70">
                    {description}
                </p>
            </div>
        </button>
    );
};

export default AlertSummaryCard;
