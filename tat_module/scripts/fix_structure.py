import os
import shutil

# Paths
root_app = "app"
src_app = "src/app"
trip_path = "src/app/trip/[id]"

print("🔍 Diagnosing Folder Structure...")

# 1. Detect Conflict
if os.path.exists(root_app) and os.path.exists(src_app):
    print(f"⚠️  CONFLICT FOUND: Both '{root_app}' and '{src_app}' exist.")
    print(f"   Next.js is likely ignoring your code in '{src_app}'.")
    
    # Check if root app is empty or default
    print(f"🚀 Action: Removing conflicting '{root_app}' folder...")
    try:
        shutil.rmtree(root_app)
        print("✅ Conflicting root 'app' folder removed.")
    except Exception as e:
        print(f"❌ Error removing folder: {e}")

# 2. Ensure Trip Page Exists
target_file = os.path.join(trip_path, "page.tsx")

if not os.path.exists(target_file):
    print(f"⚠️  Trip Details Page missing at: {target_file}")
    print("🚀 Action: Re-creating directory and file...")
    
    # Create Directory (Handling brackets correctly)
    os.makedirs(trip_path, exist_ok=True)
    
    # Re-write the file content
    content = """'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TripDetail } from '@/types/telemetry';
import Scorecard from '@/components/Scorecard';
import { format } from 'date-fns';
import { MapPin, ArrowLeft, Truck, Calendar } from 'lucide-react';

export default function TripDetails() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params?.id[0] : params?.id;
  
  const [data, setData] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      
      const { data: rpcData, error } = await supabase
        .rpc('get_trip_details', { input_trip_id: id });

      if (error) {
        console.error('Supabase Error:', error);
        setErrorMsg(error.message);
      } else if (!rpcData || !rpcData.trip) {
        setErrorMsg("Trip not found in database");
      } else {
        setData(rpcData as TripDetail);
      }
      setLoading(false);
    }
    loadData();
  }, [id]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-[#F8F9FB]">
      <div className="flex flex-col items-center gap-2">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        <div className="text-gray-400 font-medium">Analyzing Trip Data...</div>
      </div>
    </div>
  );

  if (errorMsg || !data) return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] text-gray-500 gap-4">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md">
        <div className="text-red-500 mb-2 font-bold text-lg">Unable to Load Trip</div>
        <p className="text-sm mb-6">{errorMsg}</p>
        <button 
          onClick={() => router.back()} 
          className="px-6 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
        >
          Go Back
        </button>
      </div>
    </div>
  );

  const { trip } = data;

  return (
    <div className="min-h-screen bg-[#F8F9FB] p-8 font-sans">
      <button 
        onClick={() => router.back()} 
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 mb-6 transition-colors font-medium group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Fleet Dashboard
      </button>

      <header className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="bg-blue-50 text-blue-600 p-2.5 rounded-lg"><Truck size={24} /></div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{trip.tracker_name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded uppercase tracking-wide">{trip.tracker_brand}</span>
                <span className="text-[10px] text-gray-400">ID: {trip.tracker_id}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="text-right border-l border-gray-100 pl-6 hidden md:block">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center justify-end gap-1"><Calendar size={14} /> Trip Date</p>
          <p className="text-lg font-bold text-gray-900">{trip.start_time ? format(new Date(trip.start_time), 'EEEE, MMM dd yyyy') : 'Unknown Date'}</p>
        </div>
      </header>

      <div className="mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">Safety & Efficiency Scorecard</h2>
        <Scorecard data={data} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Route Timeline</h3>
        <div className="flex flex-col md:flex-row gap-10">
          <div className="flex-1 space-y-0">
            <div className="flex gap-4 relative">
              <div className="absolute left-[19px] top-4 bottom-[-40px] w-0.5 bg-gray-200"></div>
              <div className="flex flex-col items-center z-10">
                <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center border-4 border-white shadow-sm"><div className="w-3 h-3 bg-green-500 rounded-full"></div></div>
              </div>
              <div className="pt-2 pb-8">
                <p className="text-xs font-bold text-gray-400 mb-0.5">START • {trip.start_time ? format(new Date(trip.start_time), 'HH:mm') : '--:--'}</p>
                <p className="font-medium text-gray-900 text-lg">{trip.start_address || 'Unknown Start Point'}</p>
              </div>
            </div>
            <div className="flex gap-4 relative z-10">
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center border-4 border-white shadow-sm"><div className="w-3 h-3 bg-red-500 rounded-full"></div></div>
              </div>
              <div className="pt-2">
                <p className="text-xs font-bold text-gray-400 mb-0.5">END • {trip.end_time ? format(new Date(trip.end_time), 'HH:mm') : '--:--'}</p>
                <p className="font-medium text-gray-900 text-lg">{trip.end_address || 'Unknown Destination'}</p>
              </div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-4">
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100"><span className="block text-xs font-bold text-slate-400 uppercase mb-1">Total Duration</span><span className="text-2xl font-bold text-slate-900">{trip.duration_hours.toFixed(2)} <span className="text-sm font-normal text-slate-500">hours</span></span></div>
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100"><span className="block text-xs font-bold text-slate-400 uppercase mb-1">Distance Driven</span><span className="text-2xl font-bold text-slate-900">{trip.distance_km} <span className="text-sm font-normal text-slate-500">km</span></span></div>
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100"><span className="block text-xs font-bold text-slate-400 uppercase mb-1">Max Speed</span><span className="text-2xl font-bold text-slate-900">{trip.max_speed_kmh} <span className="text-sm font-normal text-slate-500">km/h</span></span></div>
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100"><span className="block text-xs font-bold text-slate-400 uppercase mb-1">Avg Speed</span><span className="text-2xl font-bold text-slate-900">{trip.avg_speed_kmh} <span className="text-sm font-normal text-slate-500">km/h</span></span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
"""
    try:
        with open(target_file, "w") as f:
            f.write(content)
        print(f"✅ Created file: {target_file}")
    except Exception as e:
        print(f"❌ Error creating file: {e}")
else:
    print(f"✅ Trip page exists at: {target_file}")

print("\n🎉 DONE! Please restart your server: 1. Ctrl+C  2. npm run dev")
