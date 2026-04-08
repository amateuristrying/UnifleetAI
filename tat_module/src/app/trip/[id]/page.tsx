'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TripDetail } from '@/types/telemetry';
import type { RouteAnalysisResult, SecurityAnalysisPayload, SeverityLevel } from '@/types/security';
import Scorecard from '@/components/Scorecard';
import { format } from 'date-fns';
import { ArrowLeft, Truck, Calendar } from 'lucide-react';
import dynamic from 'next/dynamic';

const TripMap = dynamic(() => import('@/components/TripMap'), {
  ssr: false,
  loading: () => <div className="h-[400px] bg-slate-50 rounded-xl animate-pulse" />
});

const RouteAnomaliesMap = dynamic(() => import('@/components/RouteAnomaliesMap'), {
  ssr: false,
  loading: () => <div className="h-[400px] bg-slate-50 rounded-xl animate-pulse" />
});

export default function TripDetails() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params?.id[0] : params?.id;

  const [data, setData] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<RouteAnalysisResult | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!id) return;

      console.log("Fetching details for trip:", id);

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

  const handleAnalysisComplete = useCallback(async (res: RouteAnalysisResult) => {
    setAnalysisResults(res);

    // Persist analysis to Supabase via server API route
    if (!id || !data?.trip) return;

    const dsr = res.actualKm > 0 ? (res.deviationKm / res.actualKm) * 100 : 0;
    const severityLevel: SeverityLevel = dsr > 15 ? 'CRITICAL' : dsr > 5 ? 'WARNING' : 'MINOR';

    const payload: SecurityAnalysisPayload = {
      trip_id: id,
      tracker_id: data.trip.tracker_id,
      tracker_name: data.trip.tracker_name,
      proposed_km: parseFloat(res.proposedKm.toFixed(2)),
      actual_km: parseFloat(res.actualKm.toFixed(2)),
      deviation_km: parseFloat(res.deviationKm.toFixed(2)),
      deviation_severity_ratio: parseFloat(dsr.toFixed(2)),
      severity_level: severityLevel,
      route_breaches: res.routeBreaches,
      unauthorized_stops: res.unauthorizedStops,
      deviation_segments: res.deviationSegments,
      stop_events: res.stopEvents,
      risk_score: res.riskScore ?? 0,
      risk_reasons: res.riskReasons ?? [],
    };

    try {
      const response = await fetch('/api/security/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error(`[TripDetail] Failed to persist security analysis (HTTP ${response.status}):`, errData);
      } else {
        console.log('[TripDetail] Security analysis persisted for trip:', id);
      }
    } catch (err) {
      console.error('[TripDetail] Error persisting security analysis:', err);
    }
  }, [id, data]);

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

      {/* 1. Back Navigation */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-blue-600 mb-6 transition-colors font-medium group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Back to Fleet Dashboard
      </button>

      {/* 2. Trip Header */}
      <header className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="bg-blue-50 text-blue-600 p-2.5 rounded-lg">
              <Truck size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{trip.tracker_name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded uppercase tracking-wide">
                  {trip.tracker_brand}
                </span>
                <span className="text-[10px] text-gray-400">ID: {trip.tracker_id}</span>
                {analysisResults?.terrainType && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ml-2 ${analysisResults.terrainType === 'WINDING' ? 'bg-purple-100 text-purple-600' :
                    analysisResults.terrainType === 'HILLY' ? 'bg-orange-100 text-orange-600' :
                      'bg-green-100 text-green-600'
                    }`}>
                    {analysisResults.terrainType} TERRAIN
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="text-right border-l border-gray-100 pl-6 hidden md:block">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center justify-end gap-1">
            <Calendar size={14} /> Trip Date
          </p>
          <p className="text-lg font-bold text-gray-900">
            {trip.start_time ? format(new Date(trip.start_time), 'EEEE, MMM dd yyyy') : 'Unknown Date'}
          </p>
        </div>
      </header>

      {/* 3. Scorecard Component */}
      <div className="mb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          Safety & Efficiency Scorecard
        </h2>
        <Scorecard data={data} analysisResults={analysisResults} />
      </div>

      {/* 4. Route Timeline Details */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Route Timeline</h3>

        <div className="flex flex-col md:flex-row gap-10">

          {/* Visual Timeline */}
          <div className="flex-1 space-y-0">
            {/* Start Node */}
            <div className="flex gap-4 relative">
              {/* Line Connector */}
              <div className="absolute left-[19px] top-4 bottom-[-40px] w-0.5 bg-gray-200"></div>

              <div className="flex flex-col items-center z-10">
                <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center border-4 border-white shadow-sm">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                </div>
              </div>
              <div className="pt-2 pb-8">
                <p className="text-xs font-bold text-gray-400 mb-0.5">START • {trip.start_time ? format(new Date(trip.start_time), 'HH:mm') : '--:--'}</p>
                <p className="font-medium text-gray-900 text-lg">{trip.start_address || 'Unknown Start Point'}</p>
              </div>
            </div>

            {/* End Node */}
            <div className="flex gap-4 relative z-10">
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center border-4 border-white shadow-sm">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                </div>
              </div>
              <div className="pt-2">
                <p className="text-xs font-bold text-gray-400 mb-0.5">END • {trip.end_time ? format(new Date(trip.end_time), 'HH:mm') : '--:--'}</p>
                <p className="font-medium text-gray-900 text-lg">{trip.end_address || 'Unknown Destination'}</p>
              </div>
            </div>
          </div>

          {/* Raw Stats Grid */}
          <div className="flex-1 grid grid-cols-2 gap-4">
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="block text-xs font-bold text-slate-400 uppercase mb-1">Total Duration</span>
              <span className="text-2xl font-bold text-slate-900">{trip.duration_hours.toFixed(2)} <span className="text-sm font-normal text-slate-500">hours</span></span>
            </div>
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="block text-xs font-bold text-slate-400 uppercase mb-1">Distance Driven</span>
              <span className="text-2xl font-bold text-slate-900">{trip.distance_km} <span className="text-sm font-normal text-slate-500">km</span></span>
            </div>
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="block text-xs font-bold text-slate-400 uppercase mb-1">Max Speed</span>
              <span className="text-2xl font-bold text-slate-900">{trip.max_speed_kmh} <span className="text-sm font-normal text-slate-500">km/h</span></span>
            </div>
            <div className="p-5 bg-slate-50 rounded-xl border border-slate-100">
              <span className="block text-xs font-bold text-slate-400 uppercase mb-1">Avg Speed</span>
              <span className="text-2xl font-bold text-slate-900">{trip.avg_speed_kmh} <span className="text-sm font-normal text-slate-500">km/h</span></span>
            </div>
            {analysisResults?.sinuosity && (
              <div className="px-5 py-3 bg-purple-50 rounded-xl border border-purple-100 col-span-2">
                <span className="block text-xs font-bold text-purple-400 uppercase mb-1">Route Sinuosity</span>
                <span className="text-2xl font-bold text-purple-900">{analysisResults.sinuosity}x <span className="text-sm font-normal text-purple-500">efficiency factor</span></span>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 5. Route Map */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          Route Visualization
        </h2>
        {/* Pass efficiency score to trigger Red/Green path coloring */}
        <RouteAnomaliesMap
          key={id}
          startGeom={trip.start_geom}
          endGeom={trip.end_geom}
          efficiencyRatio={trip.crow_flight_ratio ?? 1.0}
          trackerId={trip.tracker_id}
          startTime={trip.start_time}
          endTime={trip.end_time}
          sessionKey={process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY}
          onAnalysisComplete={handleAnalysisComplete}
        />
      </div>

      {/* 6. Data Inspector */}
      {analysisResults && (
        <div className="mt-8 bg-slate-900 rounded-xl p-6 shadow-sm overflow-hidden text-slate-300">
          <details>
            <summary className="cursor-pointer font-bold text-slate-100 mb-2 flex items-center gap-2 select-none hover:text-white transition-colors">
              <span>📊 Raw Data Inspector</span>
              <span className="text-xs font-normal text-slate-500">(Click to expand)</span>
            </summary>
            <div className="mt-4 space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800 p-4 rounded">
                  <h4 className="text-slate-400 mb-2 font-bold uppercase">Analysis Params</h4>
                  <p>Profile: <span className="text-green-400">mapbox/driving</span></p>
                  <p>Map Matching: <span className="text-green-400">Enabled</span></p>
                  <p>Adaptive Tolerance: <span className="text-green-400">Active</span></p>
                </div>
                <div className="bg-slate-800 p-4 rounded">
                  <h4 className="text-slate-400 mb-2 font-bold uppercase">Segments</h4>
                  <p>Routes Breached: <span className="text-red-400">{analysisResults.routeBreaches}</span></p>
                  <p>Speed Segments: <span className="text-blue-400">{analysisResults.speedLimitSegments?.features.length || 0}</span></p>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded overflow-x-auto">
                <h4 className="text-slate-400 mb-2 font-bold uppercase">Raw Result JSON</h4>
                <pre>{JSON.stringify({
                  ...analysisResults,
                  deviationSegments: `[FeatureCollection: ${analysisResults.deviationSegments?.features.length || 0} features]`,
                  speedLimitSegments: `[FeatureCollection: ${analysisResults.speedLimitSegments?.features.length || 0} features]`
                }, null, 2)}</pre>
              </div>
            </div>
          </details>
        </div>
      )}

    </div>
  );
}
