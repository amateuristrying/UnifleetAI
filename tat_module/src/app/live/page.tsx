import React from 'react';
import LiveTracker from '@/components/LiveTracker';

export default function LiveDashboardPage() {
    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                <header className="mb-6">
                    <h1 className="text-3xl font-bold text-slate-900">Real-time Operations</h1>
                    <p className="text-slate-500">Live fleet monitoring and telemetry status</p>
                </header>

                <LiveTracker />
            </div>
        </div>
    );
}
