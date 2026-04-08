'use client';

import React from 'react';
import {
    CheckCircle2,
    Clock,
    MapPin,
    ArrowRight,
    ShieldCheck,
    Terminal,
    Flag,
    Home
} from 'lucide-react';

interface Milestone {
    event_code: string;
    event_time: string;
    confidence: number;
}

interface V2MilestoneTimelineProps {
    milestones: Milestone[];
}

const MILESTONE_CONFIG: Record<string, { label: string; icon: any; color: string; desc: string }> = {
    loading_start: { label: 'Loading Operations', icon: Terminal, color: 'text-orange-400', desc: 'Terminal arrival detect.' },
    loading_end: { label: 'Loading Departure', icon: Flag, color: 'text-indigo-400', desc: 'Exit from loading domain.' },
    border_entry: { label: 'Border Sequence', icon: ShieldCheck, color: 'text-blue-400', desc: 'Frontier checkpoint entry.' },
    destination_entry: { label: 'Final Destination', icon: MapPin, color: 'text-emerald-400', desc: 'Delivery site confirmed.' },
    trip_closed: { label: 'Return Origin', icon: Home, color: 'text-indigo-400', desc: 'Fleet gateway return.' },
};

export default function V2MilestoneTimeline({ milestones }: V2MilestoneTimelineProps) {
    if (!milestones || milestones.length === 0) {
        return <div className="text-white/20 text-center py-20 font-bold border border-white/5 rounded-3xl">No milestones inferred.</div>;
    }

    return (
        <div className="relative pl-10 space-y-12">
            {/* The vertical connector line */}
            <div className="absolute left-4 top-2 bottom-2 w-px bg-gradient-to-b from-indigo-500/50 via-emerald-500/50 to-white/10" />

            {milestones.map((m, i) => {
                const config = MILESTONE_CONFIG[m.event_code] || { label: m.event_code, icon: CheckCircle2, color: 'text-white/40', desc: 'Inferred milestone.' };
                return (
                    <div key={i} className="relative group animate-in slide-in-from-bottom duration-500" style={{ animationDelay: `${i * 100}ms` }}>
                        {/* The node */}
                        <div className={`absolute -left-10 top-1.5 w-8 h-8 rounded-xl bg-[#0a0a0a] border border-white/10 flex items-center justify-center shadow-lg transition-all group-hover:scale-110 group-hover:border-white/40 ${config.color}`}>
                            <config.icon className="w-4 h-4" />
                            {/* Inner glow dot */}
                            <div className={`absolute top-0 right-0 w-2 h-2 rounded-full blur-[2px] ${config.color.replace('text', 'bg')}`} />
                        </div>

                        {/* Content */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <h4 className={`text-sm font-black uppercase tracking-widest ${config.color}`}>
                                    {config.label}
                                </h4>
                                <span className={`text-[10px] font-black ${(m.confidence || 0) > 0.9 ? 'text-emerald-500' : 'text-orange-400'}`}>
                                    {((m.confidence || 0) * 100).toFixed(0)}% CONF
                                </span>
                            </div>

                            <p className="text-white/40 text-[10px] leading-relaxed uppercase tracking-tighter">
                                {config.desc}
                            </p>

                            <div className="flex items-center gap-2 mt-2">
                                <Clock className="w-3 h-3 text-white/20" />
                                <span className="text-xs font-mono font-medium text-white/60">
                                    {new Date(m.event_time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
