import { useNavigate } from 'react-router-dom';
import {
    Timer,
    TrendingUp,
    Zap,
    Moon,
    AlertTriangle,
    Trophy,
    Fuel,
    Route as RouteIcon,
    Clock,
    Wrench,
    ActivitySquare,
    ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOps } from '@/context/OpsContext';

export default function AnalyticsDashboard() {
    const navigate = useNavigate();
    const { ops, setOps } = useOps();

    const analyticsItems = [
        {
            title: "Corridor Analytics",
            description: "Monitor end-to-end trip logic, stoppage times, and overall route performance.",
            icon: <TrendingUp className="text-blue-500" size={24} />,
            path: "/corridor-analytics",
            active: true
        },
        {
            title: "Fleet Efficiency Analytics",
            description: "Overall fleet uptime, utilization rates, and operational efficiency insights.",
            icon: <Zap className="text-yellow-500" size={24} />,
            path: "/analytics/efficiency",
            active: false
        },
        {
            title: "Unsupervised Night Events",
            description: "Track unauthorized nighttime driving and off-geofence parking events with full GPS data.",
            icon: <Moon className="text-indigo-500" size={24} />,
            path: "/analytics/unsupervised-night-events",
            active: true
        },
        {
            title: "Night Speeding Incidents",
            description: "Identify high-risk speeding events during night hours to strictly enforce driver safety.",
            icon: <AlertTriangle className="text-red-500" size={24} />,
            path: "/analytics/night-speeding",
            active: true
        },
        {
            title: "Route Deviation & Adherence",
            description: "Highlight instances where drivers unlawfully exited standard, approved operational routes.",
            icon: <RouteIcon className="text-purple-500" size={24} />,
            path: "/analytics/route-deviation",
            active: false,
            comingSoon: true
        },
        {
            title: "Site Detention & Dwell Time",
            description: "Determine exact delays at customer endpoints vs transit time in the broader logistics chain.",
            icon: <Clock className="text-cyan-500" size={24} />,
            path: "/analytics/dwell-detention",
            active: false,
            comingSoon: true
        },
        {
            title: "Predictive Maintenance",
            description: "Predict next service dates instantly using ongoing mileages and real-time engine health markers.",
            icon: <Wrench className="text-slate-500" size={24} />,
            path: "/analytics/maintenance",
            active: false,
            comingSoon: true
        },
        {
            title: "Harsh Driving & G-Force Events",
            description: "Record hard braking, rapid acceleration, and dangerous cornering maneuvers on a geospatial map.",
            icon: <ActivitySquare className="text-rose-500" size={24} />,
            path: "/analytics/harsh-telematics",
            active: false,
            comingSoon: true
        }
    ];

    return (
        <div className="flex flex-col h-full bg-surface-main p-8 gap-8 overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="bg-surface-card border border-border rounded-3xl px-8 py-8 shadow-sm shrink-0 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                <div className="flex flex-col relative z-10">
                    <h1 className="text-3xl font-black text-foreground uppercase tracking-tighter leading-none flex items-center gap-3">
                        <LineChartIcon className="text-primary" size={32} />
                        Intelligence & Analytics
                    </h1>
                    <div className="flex items-center gap-4 mt-4">
                        <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">Command Center</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-border" />

                        <div className="flex items-center gap-1 bg-muted rounded-full p-1 border border-border overflow-hidden">
                            <button
                                onClick={() => setOps('tanzania')}
                                className={`px-4 py-1 text-[10px] font-black uppercase rounded-full transition-all tracking-wider ${ops === 'tanzania'
                                    ? 'bg-surface-raised text-primary shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                TZ OPS
                            </button>
                            <button
                                onClick={() => setOps('zambia')}
                                disabled
                                className="px-4 py-1 text-[10px] font-black uppercase rounded-full transition-all tracking-wider opacity-40 cursor-not-allowed text-muted-foreground"
                            >
                                ZM OPS
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Analytics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
                {analyticsItems.map((item, idx) => (
                    <button
                        key={idx}
                        onClick={() => navigate(item.path)}
                        className={cn(
                            "group flex flex-col items-start p-6 text-left rounded-3xl border transition-all duration-300 relative overflow-hidden cursor-pointer",
                            item.active
                                ? "bg-surface-card border-border hover:border-primary/30 hover:shadow-lg hover:-translate-y-1"
                                : "bg-surface-card border-border opacity-80 hover:opacity-100 hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5"
                        )}
                    >
                        {/* Abstract background shape on hover */}
                        <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors pointer-events-none" />

                        <div className="flex items-center justify-between w-full mb-4">
                            <div className="w-12 h-12 rounded-2xl bg-background border border-border shadow-sm flex items-center justify-center">
                                {item.icon}
                            </div>
                            <div className={cn("px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest border",
                                item.active ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                                    item.comingSoon ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                        "bg-slate-500/10 text-slate-500 border-slate-500/20")}>
                                {item.active ? "Active" : item.comingSoon ? "Coming Soon" : "Module Ready"}
                            </div>
                        </div>

                        <h3 className="text-lg font-black text-foreground leading-tight tracking-tight mb-2 group-hover:text-primary transition-colors">
                            {item.title}
                        </h3>

                        <p className="text-sm text-muted-foreground font-medium leading-relaxed mb-6">
                            {item.description}
                        </p>

                        <div className="mt-auto flex items-center gap-2 text-xs font-bold text-foreground group-hover:text-primary uppercase tracking-wide">
                            Open Module <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

function LineChartIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 3v18h18" />
            <path d="m19 9-5 5-4-4-3 3" />
        </svg>
    )
}
