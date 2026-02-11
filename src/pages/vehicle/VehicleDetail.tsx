import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, MapPin, Gauge, Clock, Fuel, Battery, Thermometer, Droplets, AlertTriangle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ActivityTable, { type ActivityRow } from "@/components/ActivityTable";

interface VehicleDetailProps {
    vehicle: any;
    activityData: ActivityRow[];
    onBack: () => void;
    loading: boolean;
}

export function VehicleDetail({ vehicle, activityData, onBack, loading }: VehicleDetailProps) {
    // Mock Data for Charts if activityData is sparse
    const chartData = (activityData && activityData.length > 5) ? activityData.map((_, i) => ({
        time: i,
        speed: Math.random() * 80 + 20, // Mock speed
        fuel: Math.random() * 20 + 60,  // Mock fuel efficiency
    })) : Array.from({ length: 12 }).map((_, i) => ({
        time: `${i * 2}:00`,
        speed: Math.random() * 60 + 30,
        fuel: Math.random() * 10 + 5,
    }));

    // KPI Calculations
    const totalDist = Math.round(activityData.reduce((acc, curr) => acc + (curr.distanceKm || 0), 0));
    const avgSpeed = 62; // Mock or calculate
    const fuelCons = 55.2; // Mock
    const opHours = 8.5; // Mock

    return (
        <div className="h-full w-full overflow-y-auto p-6 animate-in slide-in-from-right duration-300 scrollbar-thin">
            <div className="max-w-[1600px] mx-auto space-y-6">

                {/* 1. Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-surface-card p-6 rounded-xl border border-border shadow-sm">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" onClick={onBack} className="hover:bg-muted">
                            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
                        </Button>
                        <div>
                            <div className="flex items-center gap-3">
                                <TruckIcon className="h-10 w-10 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 p-2 rounded-lg" />
                                <div>
                                    <h1 className="text-2xl font-bold text-foreground">{vehicle?.label || `Vehicle #${vehicle?.id}`}</h1>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </span>
                            <span className="font-semibold text-green-700 dark:text-green-500 text-sm">Moving</span>
                        </div>
                        <span className="text-xs text-muted-foreground">Updated 3m ago</span>
                    </div>
                </div>

                {/* 2. KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <KPICard title="Today's Distance" value={`${totalDist} km`} icon={<MapPin className="text-blue-500" />} trend="+12%" />
                    <KPICard title="Fuel Consumption" value={`${fuelCons} L`} icon={<Fuel className="text-orange-500" />} trend="-5%" trendDown />
                    <KPICard title="Average Speed" value={`${avgSpeed} km/h`} icon={<Gauge className="text-purple-500" />} trend="+8%" />
                    <KPICard title="Operational Hours" value={`${opHours} hrs`} icon={<Clock className="text-green-500" />} trend="+3%" />
                </div>

                {/* 3. Main Content Tabs */}
                <Tabs defaultValue="performance" className="w-full space-y-4">
                    <TabsList className="bg-surface-card border border-border w-full justify-start h-12 p-1">
                        <TabsTrigger value="performance" className="data-[state=active]:bg-blue-50 dark:data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-700 dark:data-[state=active]:text-blue-400">Performance</TabsTrigger>
                        <TabsTrigger value="history">Route History</TabsTrigger>
                        <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
                        <TabsTrigger value="driver">Driver Behavior</TabsTrigger>
                    </TabsList>

                    {/* Tab: PERFORMANCE */}
                    <TabsContent value="performance" className="space-y-4">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                            {/* LEFT: Chart (Span 2) */}
                            <Card className="lg:col-span-2 border-none shadow-sm">
                                <CardHeader>
                                    <CardTitle>Speed & Fuel Efficiency Trends</CardTitle>
                                </CardHeader>
                                <CardContent className="h-[400px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorFuel" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.1} />
                                                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                                            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))' }} />
                                            <Area type="monotone" dataKey="speed" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorSpeed)" name="Speed (km/h)" />
                                            <Area type="monotone" dataKey="fuel" stroke="#f97316" strokeWidth={3} fillOpacity={1} fill="url(#colorFuel)" name="Fuel Eff." />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>

                            {/* RIGHT: Status Panel (Span 1) */}
                            <div className="space-y-6">

                                {/* Location Widget */}
                                <Card className="border-none shadow-sm overflow-hidden bg-surface-card">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-muted-foreground">Current Location</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <div className="h-32 bg-muted relative">
                                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
                                                [Map Placeholder]
                                            </div>
                                            <div className="absolute bottom-2 left-2 bg-background/90 backdrop-blur px-2 py-1 rounded text-xs font-mono shadow-sm border border-border">
                                                23.2599, 87.8614
                                            </div>
                                        </div>
                                        <div className="p-4">
                                            <div className="text-sm font-medium text-foreground">NH-2, Near Bardhaman Toll Plaza</div>
                                            <div className="text-xs text-muted-foreground mt-1">West Bengal, 713101</div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Engine Diagnostics */}
                                <Card className="border-none shadow-sm">
                                    <CardHeader>
                                        <CardTitle className="text-sm font-medium">Engine Diagnostics</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <DiagnosticItem label="Engine Temp" value="92°C" status="normal" icon={<Thermometer className="h-4 w-4" />} />
                                        <DiagnosticItem label="Oil Pressure" value="45 PSI" status="normal" icon={<Droplets className="h-4 w-4" />} />
                                        <DiagnosticItem label="Battery" value="13.8 V" status="normal" icon={<Battery className="h-4 w-4" />} />
                                        <DiagnosticItem label="Brake System" value="Optimal" status="normal" icon={<AlertTriangle className="h-4 w-4" />} />
                                    </CardContent>
                                </Card>

                                {/* Fuel Level */}
                                <Card className="border-none shadow-sm bg-surface-card">
                                    <CardHeader>
                                        <CardTitle className="text-sm font-medium">Fuel Level</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="flex items-end justify-between mb-2">
                                            <span className="text-2xl font-bold text-foreground">68%</span>
                                            <span className="text-xs text-muted-foreground mb-1">200L Capacity</span>
                                        </div>
                                        <Progress value={68} className="h-3 bg-muted" />
                                        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                                            <span>Range: 340 km</span>
                                            <span>Eff: 5.2 km/l</span>
                                        </div>
                                    </CardContent>
                                </Card>

                            </div>
                        </div>
                    </TabsContent>

                    {/* Tab: HISTORY (Reusing old Activity Table) */}
                    <TabsContent value="history">
                        <Card className="border-none shadow-none bg-transparent">
                            <CardHeader className="px-0 pt-0">
                                <CardTitle>Activity Log</CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {loading ? (
                                    <div className="p-12 text-center text-muted-foreground">Loading history...</div>
                                ) : (
                                    <ActivityTable data={activityData} />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                </Tabs>
            </div>
        </div>
    );
}

// ---------------------------
// Sub-components
// ---------------------------

function KPICard({ title, value, icon, trend, trendDown = false }: any) {
    return (
        <Card className="border-none shadow-sm bg-surface-card">
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    <div className="p-2 bg-muted rounded-lg">{icon}</div>
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", trendDown ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400" : "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400")}>
                        {trend}
                    </span>
                </div>
                <div className="mt-4">
                    <p className="text-sm font-medium text-muted-foreground">{title}</p>
                    <h3 className="text-2xl font-bold text-foreground mt-1">{value}</h3>
                </div>
            </CardContent>
        </Card>
    )
}

function DiagnosticItem({ label, value, status, icon }: any) {
    return (
        <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-md ${status === 'warning' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                    {icon}
                </div>
                <span className="text-sm text-muted-foreground">{label}</span>
            </div>
            <span className={`text-sm font-medium ${status === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {value}
            </span>
        </div>
    )
}

function TruckIcon({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <rect x="1" y="3" width="15" height="13"></rect>
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
            <circle cx="5.5" cy="18.5" r="2.5"></circle>
            <circle cx="18.5" cy="18.5" r="2.5"></circle>
        </svg>
    )
}

// Helper utility
import { cn } from "@/lib/utils";
