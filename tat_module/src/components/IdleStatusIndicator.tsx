import React, { useState, useEffect } from 'react';
import { Activity, PlayCircle, StopCircle, Clock, ParkingCircle, Radio } from 'lucide-react';
import { cn, parseNavixyDate } from '@/lib/utils';
import { VehicleStatus } from '@/hooks/useTrackerStatusDuration';

interface IdleStatusIndicatorProps {
    status: VehicleStatus; // Use centralized status determination
    lastUpdate: string;
    statusStartTime?: number; // Timestamp when the current status began
    className?: string;
}

export default function IdleStatusIndicator({ status, lastUpdate, statusStartTime, className }: IdleStatusIndicatorProps) {
    const getStatusColor = (s: VehicleStatus) => {
        switch (s) {
            case 'moving': return 'text-green-600 bg-green-50 border-green-200';
            case 'stopped': return 'text-red-600 bg-red-50 border-red-200';
            case 'parked': return 'text-blue-600 bg-blue-50 border-blue-200';
            case 'idle-stopped': return 'text-orange-600 bg-orange-50 border-orange-200';
            case 'idle-parked': return 'text-purple-600 bg-purple-50 border-purple-200';
            case 'offline': return 'text-slate-400 bg-slate-50 border-slate-200';
        }
    };

    const getIcon = (s: VehicleStatus) => {
        switch (s) {
            case 'moving': return <PlayCircle size={16} />;
            case 'stopped': return <StopCircle size={16} />;
            case 'parked': return <ParkingCircle size={16} />;
            case 'idle-stopped': return <Radio size={16} />;
            case 'idle-parked': return <Radio size={16} />;
            case 'offline': return <Clock size={16} />;
        }
    };

    const getStatusLabel = (s: VehicleStatus) => {
        switch (s) {
            case 'moving': return 'MOVING';
            case 'stopped': return 'STOPPED';
            case 'parked': return 'PARKED';
            case 'idle-stopped': return 'IDLE-STOPPED';
            case 'idle-parked': return 'IDLE-PARKED';
            case 'offline': return 'OFFLINE';
        }
    };

    const formattedTime = parseNavixyDate(lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Duration Ticker
    const [durationString, setDurationString] = useState<string>('Calculating...');

    useEffect(() => {
        if (!statusStartTime) {
            setDurationString('Calculating...');
            return;
        }

        const updateDuration = () => {
            const now = Date.now();
            const diff = Math.max(0, now - statusStartTime);

            const seconds = Math.floor((diff / 1000) % 60);
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));

            const parts = [];
            if (days > 0) parts.push(`${days}d`);
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);
            parts.push(`${seconds}s`);

            setDurationString(parts.join(' ') || '0s');
        };

        updateDuration(); // Initial call
        const interval = setInterval(updateDuration, 1000);

        return () => clearInterval(interval);
    }, [statusStartTime]);

    return (
        <div className={cn("flex flex-col gap-1", className)}>
            <div className="flex items-center gap-2">
                <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border w-fit shadow-sm transition-colors", getStatusColor(status))}>
                    {getIcon(status)}
                    <span className="text-xs font-bold uppercase tracking-wider">{getStatusLabel(status)}</span>
                </div>

                {/* Duration Badge */}
                {durationString && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-100 rounded-md border border-slate-200 text-xs font-medium text-slate-600">
                        <Clock size={12} className="text-slate-400" />
                        <span>{durationString}</span>
                    </div>
                )}
            </div>

            <div className="text-[10px] text-gray-400 pl-1 flex items-center justify-between w-full">
                <span>Updated: {formattedTime}</span>
            </div>
        </div>
    );
}
