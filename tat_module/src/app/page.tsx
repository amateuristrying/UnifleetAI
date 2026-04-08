import React from 'react';
import TATDashboardV2 from '@/components/TAT/v2/TATDashboardV2';

export const metadata = {
    title: 'TAT Control Tower V2 | ASAS Unifleet',
    description: 'Next-generation turnaround intelligence built on the v2 state-stop engine.',
};

export default function TATV2Page() {
    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <TATDashboardV2 />
        </div>
    );
}
