import React from 'react';

interface TooltipProps {
    active?: boolean;
    payload?: Array<{ dataKey: string; value: number; name?: string; color?: string }>;
    label?: string;
}

export const CustomTooltip: React.FC<TooltipProps> = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg">
                <p className="text-gray-900 font-semibold text-sm mb-1">{`Date: ${label}`}</p>
                {payload.map((entry, index) => (
                    <p key={index} className="text-gray-600 text-sm">
                        <span className="font-medium" style={{ color: entry.color || '#374151' }}>
                            {entry.name || entry.dataKey}:
                        </span>{' '}
                        {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};
