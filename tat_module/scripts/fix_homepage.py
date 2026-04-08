import os

# Ensure directories exist
os.makedirs("src/app", exist_ok=True)
os.makedirs("src/components", exist_ok=True)

print("🛠️  Repairing Next.js Structure...")

# ==========================================
# 1. FIX: Root Layout (CRITICAL)
# ==========================================
layout_content = """import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unifleet | AI Fleet Intelligence",
  description: "Advanced Telemetrics Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#F8F9FB] text-slate-900">
        {children}
      </body>
    </html>
  );
}
"""
with open("src/app/layout.tsx", "w") as f:
    f.write(layout_content)
print("✅ Restored src/app/layout.tsx")

# ==========================================
# 2. FIX: Globals CSS (Tailwind)
# ==========================================
css_content = """@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #ffffff;
  --foreground: #171717;
}

body {
  color: var(--foreground);
  background: var(--background);
}
"""
with open("src/app/globals.css", "w") as f:
    f.write(css_content)
print("✅ Restored src/app/globals.css")

# ==========================================
# 3. FIX: FilterBar Component
# ==========================================
filter_content = """import { Search, Calendar } from 'lucide-react';

interface FilterBarProps {
  onSearch: (term: string) => void;
  onDateChange: (start: string, end: string) => void;
}

export default function FilterBar({ onSearch, onDateChange }: FilterBarProps) {
  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex flex-wrap gap-4 items-center justify-between">
      <div className="relative w-full md:w-96">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search size={18} className="text-gray-400" />
        </div>
        <input
          type="text"
          placeholder="Search Vehicle (e.g. CAG 9240)..."
          className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 font-medium mr-2 flex items-center gap-1">
          <Calendar size={16}/> Filter:
        </span>
        <select 
          className="border border-gray-300 rounded-lg py-2 px-3 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none"
          onChange={(e) => {
            const val = e.target.value;
            const now = new Date();
            let start = new Date();
            if (val === 'today') start.setDate(now.getDate());
            if (val === '7days') start.setDate(now.getDate() - 7);
            if (val === '30days') start.setDate(now.getDate() - 30);
            if (val === 'all') start = new Date('2000-01-01');
            onDateChange(start.toISOString().split('T')[0], now.toISOString().split('T')[0]);
          }}
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="7days">Last 7 Days</option>
          <option value="30days">Last 30 Days</option>
        </select>
      </div>
    </div>
  );
}
"""
with open("src/components/FilterBar.tsx", "w") as f:
    f.write(filter_content)
print("✅ Restored src/components/FilterBar.tsx")

# ==========================================
# 4. FIX: SummaryCards Component
# ==========================================
cards_content = """import { Truck, Activity, Moon, Zap } from 'lucide-react';

interface Stats {
  total_trips: number;
  total_distance_km: number;
  total_night_km: number;
  avg_speed_kmh: number;
}

export default function SummaryCards({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Trips</p><h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.total_trips.toLocaleString()}</h3></div>
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Truck size={20} /></div>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Distance</p><h3 className="text-3xl font-bold text-gray-900 mt-2">{Math.round(stats.total_distance_km).toLocaleString()} <span className="text-base font-normal text-gray-400">km</span></h3></div>
        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Activity size={20} /></div>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Night Driving</p><h3 className="text-3xl font-bold text-indigo-900 mt-2">{Math.round(stats.total_night_km).toLocaleString()} <span className="text-base font-normal text-gray-400">km</span></h3></div>
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Moon size={20} /></div>
      </div>
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
        <div><p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Fleet Speed</p><h3 className="text-3xl font-bold text-gray-900 mt-2">{Math.round(stats.avg_speed_kmh)} <span className="text-base font-normal text-gray-400">km/h</span></h3></div>
        <div className="p-2 bg-orange-50 text-orange-600 rounded-lg"><Zap size={20} /></div>
      </div>
    </div>
  );
}
"""
with open("src/components/SummaryCards.tsx", "w") as f:
    f.write(cards_content)
print("✅ Restored src/components/SummaryCards.tsx")

# ==========================================
# 5. FIX: Homepage (page.tsx)
# ==========================================
page_content = """'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { TripLog } from '@/types/telemetry';
import TripTable from '@/components/TripTable';
import SummaryCards from '@/components/SummaryCards';
import FilterBar from '@/components/FilterBar';
import { LayoutDashboard, Calendar, ArrowDown } from 'lucide-react';

export default function Dashboard() {
  const [trips, setTrips] = useState<TripLog[]>([]);
  const [stats, setStats] = useState({
    total_trips: 0,
    total_distance_km: 0,
    total_night_km: 0,
    avg_speed_kmh: 0
  });
  
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // 1. Fetch Global Stats
  const fetchStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_fleet_stats', {
      start_date_input: dateRange.start || null,
      end_date_input: dateRange.end || null,
      vehicle_filter: searchTerm || null
    });
    if (!error && data) setStats(data);
  }, [searchTerm, dateRange]);

  // 2. Fetch Trips List
  const fetchTrips = useCallback(async (pageIndex: number, isNew: boolean = false) => {
    if (isNew) setLoading(true);
    const from = pageIndex * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('v_ai_trip_logs')
      .select('*')
      .order('start_time', { ascending: false })
      .range(from, to);

    if (dateRange.start) query = query.gte('trip_date', dateRange.start);
    if (dateRange.end) query = query.lte('trip_date', dateRange.end);
    if (searchTerm) query = query.ilike('tracker_name', `%${searchTerm}%`);

    const { data, error } = await query;

    if (!error) {
      setTrips(prev => isNew ? (data || []) : [...prev, ...(data || [])]);
    }
    setLoading(false);
  }, [searchTerm, dateRange]);

  // Initial & Filter Change
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      fetchStats();
      fetchTrips(0, true);
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchStats, fetchTrips]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchTrips(nextPage, false);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FB] p-8 font-sans">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <LayoutDashboard className="text-blue-600" /> 
            Unifleet Intelligence
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Real-time AI Telemetrics</p>
        </div>
      </header>

      <FilterBar onSearch={setSearchTerm} onDateChange={(start, end) => setDateRange({ start, end })} />
      <SummaryCards stats={stats} />

      <main className="pb-20">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Calendar size={18} className="text-gray-400"/> Recent Activity Log
          </h2>
        </div>

        {loading && trips.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl bg-white border border-gray-200">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          </div>
        ) : (
          <>
            <TripTable trips={trips} />
            <div className="mt-6 flex justify-center">
                <button onClick={handleLoadMore} className="flex items-center gap-2 px-6 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-full shadow-sm hover:bg-gray-50">
                  <ArrowDown size={16} /> Load More
                </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
"""
with open("src/app/page.tsx", "w") as f:
    f.write(page_content)
print("✅ Restored src/app/page.tsx")

print("\n🎉 REPAIR COMPLETE. Please restart your server now.")
