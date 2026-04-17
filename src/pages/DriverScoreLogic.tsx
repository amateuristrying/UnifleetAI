import { cn } from "@/lib/utils";
import { Trophy, Zap, ArrowRight, ShieldCheck, Clock, Truck, Target, Info, Moon } from "lucide-react";

export function DriverScoreLogic() {
    return (
        <div className="flex flex-col h-full bg-surface-main overflow-y-auto scrollbar-thin">
            <div className="flex flex-col p-8 gap-10 w-full max-w-6xl mx-auto pb-20">

                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="bg-primary/10 p-2 rounded-lg">
                                <ShieldCheck className="h-6 w-6 text-primary" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Governance & Policy</span>
                        </div>
                        <h1 className="text-4xl font-black tracking-tight">Driver Score Logic</h1>
                        <p className="text-lg text-muted-foreground font-medium max-w-xl">
                            The Unifleet Scoping engine evaluates driver safety, operational efficiency, and vehicle preservation on a daily basis.
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4 bg-surface-card p-4 rounded-2xl border border-border shadow-sm">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Fleet Threshold</span>
                            <span className="text-xl font-black text-emerald-500">85+ / 100</span>
                        </div>
                        <div className="w-px h-8 bg-border" />
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Status</span>
                            <span className="text-xl font-black text-foreground uppercase tracking-widest">Active</span>
                        </div>
                    </div>
                </div>

                {/* The Formula / Core Concept */}
                <section className="relative overflow-hidden bg-primary/5 rounded-3xl border border-primary/20 p-8 shadow-sm">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Target className="w-64 h-64 text-primary" />
                    </div>
                    
                    <div className="relative z-10 flex flex-col gap-8">
                        <div>
                            <h2 className="text-xl font-black flex items-center gap-2 mb-2">
                                <Trophy className="h-5 w-5 text-primary" />
                                Scoring Architecture
                            </h2>
                            <p className="text-sm text-muted-foreground font-medium">
                                Every vehicle starts at 100 points each day. Points are deducted for violations and added for discipline milestones.
                            </p>
                        </div>
                        
                        <div className="flex flex-col lg:flex-row items-center justify-between gap-4 p-8 bg-surface-card rounded-2xl border border-border shadow-xl">
                            <FormulaComponent label="Daily Baseline" value="100" sub="Starting Points" color="text-blue-500" />
                            <FormulaSymbol icon={<ArrowRight className="h-6 w-6" />} />
                            <FormulaComponent label="Deductions" value="- P" sub="Risk Penalties" color="text-red-500" />
                            <FormulaSymbol icon={<ArrowRight className="h-6 w-6" />} />
                            <FormulaComponent label="Additions" value="+ B" sub="Behavior Bonus" color="text-emerald-500" />
                            <FormulaSymbol icon={<ArrowRight className="h-6 w-6" />} />
                            <FormulaComponent label="Final Result" value="0 - 100" sub="Safety Index" color="text-primary" />
                        </div>
                    </div>
                </section>

                {/* Deep Dive Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Penalties Section */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-3">
                            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest">Penalties</span>
                            <h3 className="text-lg font-black tracking-tight">Deduction Rules</h3>
                        </div>
                        
                        <div className="grid gap-4">
                            <PenaltyCard 
                                icon={<Zap className="h-5 w-5" />} 
                                title="Speeding Violation" 
                                desc="Recorded event where vehicle speed exceeds established corridor limits."
                                penalty="-5"
                                sub="per violation"
                            />
                            <PenaltyCard 
                                icon={<Clock className="h-5 w-5" />} 
                                title="Excessive Idling" 
                                desc="Engine running while stationary for >30 minutes cumulatively in the trip window."
                                penalty="-2"
                                sub="per day"
                            />
                            <PenaltyCard 
                                icon={<Moon className="h-5 w-5" />} 
                                title="Night Driving" 
                                desc="Unauthorized operation during high-risk night hours (22:00 - 04:00)."
                                penalty="-10"
                                sub="at night"
                            />
                        </div>
                    </div>

                    {/* Rewards Section */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-3">
                            <span className="bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest">Rewards</span>
                            <h3 className="text-lg font-black tracking-tight">Bonus Milestones</h3>
                        </div>
                        
                        <div className="grid gap-4">
                            <BonusCard 
                                icon={<Truck className="h-5 w-5" />} 
                                title="Operational Reach" 
                                desc="Daily utilization exceeding 50km total distance with valid task assignment."
                                bonus="+1"
                                sub="at 50km"
                            />
                            <BonusCard 
                                icon={<ShieldCheck className="h-5 w-5" />} 
                                title="Perfect Safety Day" 
                                desc="ZERO speed violations and zero safety alerts recorded over entire operational window."
                                bonus="+2"
                                sub="per day"
                            />
                        </div>
                    </div>
                </div>

                {/* Operational Constraints */}
                <div className="bg-muted/30 rounded-3xl p-8 border border-border">
                    <h3 className="text-lg font-black flex items-center gap-2 mb-6">
                        <Info className="h-5 w-5 text-muted-foreground" />
                        Operational Guardrails
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <RuleItem 
                            label="Inactive Threshold" 
                            rule="Movement <5km is considered 'Inactive'. No scores are computed for these days to maintain history integrity."
                        />
                        <RuleItem 
                            label="Hard Clamping" 
                            rule="Scores are strictly clamped between 0 and 100. Bonus points cannot push index beyond theoretical maximum."
                        />
                        <RuleItem 
                            label="Sunday Policy" 
                            rule="Sundays are marked as 'Maintenance Reset'. Scoring algorithms are paused unless specialized shifts are defined."
                        />
                    </div>
                </div>

                {/* Risk Buckets Logic */}
                <div className="space-y-6">
                    <h3 className="text-lg font-black tracking-tight">UI Classification (Risk Buckets)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <BucketInfo color="bg-red-500" label="Critical" range="0 - 45" />
                        <BucketInfo color="bg-amber-500" label="Watchlist" range="46 - 75" />
                        <BucketInfo color="bg-emerald-500" label="Stable" range="76 - 94" />
                        <BucketInfo color="bg-indigo-500" label="Elite" range="95 - 100" />
                    </div>
                </div>

            </div>
        </div>
    );
}

function FormulaComponent({ label, value, sub, color }: any) {
    return (
        <div className="flex flex-col items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">{label}</span>
            <span className={cn("text-4xl font-black tracking-tighter", color)}>{value}</span>
            <span className="text-[10px] font-bold text-muted-foreground/40 mt-1">{sub}</span>
        </div>
    );
}

function FormulaSymbol({ icon }: any) {
    return <div className="hidden lg:block text-muted-foreground/30">{icon}</div>;
}

function PenaltyCard({ icon, title, desc, penalty, sub }: any) {
    return (
        <div className="bg-surface-card p-6 rounded-2xl border border-border flex items-start gap-4 transition-all hover:border-red-500/20 hover:shadow-md">
            <div className="bg-red-500/10 p-2.5 rounded-xl text-red-500 shrink-0">
                {icon}
            </div>
            <div className="flex-1">
                <h4 className="font-black text-foreground mb-1 leading-none">{title}</h4>
                <p className="text-xs text-muted-foreground font-medium leading-relaxed">{desc}</p>
            </div>
            <div className="flex flex-col items-end">
                <span className="text-2xl font-black text-red-500 tracking-tighter">{penalty}</span>
                <span className="text-[9px] font-black uppercase text-muted-foreground/40">{sub}</span>
            </div>
        </div>
    );
}

function BonusCard({ icon, title, desc, bonus, sub }: any) {
    return (
        <div className="bg-surface-card p-6 rounded-2xl border border-border flex items-start gap-4 transition-all hover:border-emerald-500/20 hover:shadow-md">
            <div className="bg-emerald-500/10 p-2.5 rounded-xl text-emerald-500 shrink-0">
                {icon}
            </div>
            <div className="flex-1">
                <h4 className="font-black text-foreground mb-1 leading-none">{title}</h4>
                <p className="text-xs text-muted-foreground font-medium leading-relaxed">{desc}</p>
            </div>
            <div className="flex flex-col items-end">
                <span className="text-2xl font-black text-emerald-500 tracking-tighter">{bonus}</span>
                <span className="text-[9px] font-black uppercase text-muted-foreground/40">{sub}</span>
            </div>
        </div>
    );
}

function RuleItem({ label, rule }: any) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-xs font-black uppercase tracking-widest text-foreground">{label}</span>
            <p className="text-xs text-muted-foreground font-medium leading-relaxed">{rule}</p>
        </div>
    );
}

function BucketInfo({ color, label, range }: any) {
    return (
        <div className="bg-surface-card p-4 rounded-xl border border-border flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", color)} />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
            </div>
            <span className="text-sm font-black text-foreground tracking-tight">{range} pts</span>
        </div>
    );
}

