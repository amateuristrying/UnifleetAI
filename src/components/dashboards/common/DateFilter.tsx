import React from 'react';
import { Calendar } from 'lucide-react';

interface DateFilterProps {
    title: string;
    dateFilter: string;
    setDateFilter: (filter: string) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({ title, dateFilter, setDateFilter }) => (
    <div className="flex items-center gap-3 mb-4">
        <Calendar className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-medium uppercase text-gray-500">{title}:</span>
        <div className="flex gap-1">
            {['1 day', '7 days', '30 days'].map((period) => (
                <button
                    key={period}
                    onClick={() => setDateFilter(period)}
                    className={`px-3 py-1.5 text-xs font-medium uppercase rounded-full transition-all ${dateFilter === period
                            ? 'bg-blue-500 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    {period}
                </button>
            ))}
        </div>
    </div>
);
