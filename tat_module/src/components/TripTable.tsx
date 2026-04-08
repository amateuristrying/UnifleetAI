'use client';

import { TripLog } from '@/types/telemetry';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Truck, MapPin, Moon, Sun, Clock, Zap, ChevronRight } from 'lucide-react';

export default function TripTable({ trips }: { trips: TripLog[] }) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-xs uppercase font-semibold text-gray-500 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4">Vehicle Identity</th>
              <th className="px-6 py-4">Timeline</th>
              <th className="px-6 py-4">Route Info</th>
              <th className="px-6 py-4 text-center">Distance Breakdown</th>
              <th className="px-6 py-4 text-center">Duration</th>
              <th className="px-6 py-4 text-center">Safety (Speed)</th>
              <th className="px-6 py-4 text-center">Route Efficiency</th>
              <th className="px-4 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {trips.map((trip) => (
              <tr
                key={trip.trip_id}
                onClick={() => router.push(`/trip/${trip.trip_id}`)}
                className={`transition-colors duration-150 group cursor-pointer ${trip.trip_grade < 80
                  ? 'bg-red-50/70 hover:bg-red-100/80'
                  : 'hover:bg-blue-50/50'
                  }`}
              >

                {/* 1. Vehicle Info */}
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-50 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                      <Truck size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 line-clamp-1">{trip.tracker_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 uppercase tracking-wide border border-gray-200 group-hover:bg-white group-hover:border-blue-200">
                          {trip.tracker_brand}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>

                {/* 2. Timeline */}
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                      <span className="text-xs font-medium text-gray-900">
                        {trip.start_time ? format(new Date(trip.start_time), 'MMM dd, HH:mm') : '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400"></div>
                      <span className="text-xs text-gray-500">
                        {trip.end_time ? format(new Date(trip.end_time), 'MMM dd, HH:mm') : '-'}
                      </span>
                    </div>
                  </div>
                </td>

                {/* 3. Route Addresses */}
                <td className="px-6 py-4 max-w-[200px]">
                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex items-start gap-1.5" title={trip.start_address || 'Unknown'}>
                      <MapPin size={14} className="text-gray-400 shrink-0 mt-0.5" />
                      <span className="truncate text-gray-600">{trip.start_address || 'Unknown Location'}</span>
                    </div>
                    <div className="flex items-start gap-1.5" title={trip.end_address || 'Unknown'}>
                      <MapPin size={14} className="text-gray-400 shrink-0 mt-0.5" />
                      <span className="truncate text-gray-600">{trip.end_address || 'Unknown Location'}</span>
                    </div>
                  </div>
                </td>

                {/* 4. Distance (Day/Night + Variance) */}
                <td className="px-6 py-4">
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-bold text-gray-900">{trip.distance_km} <span className="text-xs font-normal text-gray-400">km</span></span>

                    {/* Day/Night Pill */}
                    <div className="flex mt-1 overflow-hidden rounded-full border border-gray-200 text-[10px] font-medium">
                      {trip.day_distance_km > 0 && (
                        <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 text-amber-700 border-r border-gray-200">
                          <Sun size={10} /> {trip.day_distance_km}
                        </div>
                      )}
                      {trip.night_distance_km > 0 && (
                        <div className="flex items-center gap-1 bg-indigo-50 px-2 py-0.5 text-indigo-700">
                          <Moon size={10} /> {trip.night_distance_km}
                        </div>
                      )}
                    </div>

                    {/* Variance Label (New AI Proxy) */}
                    {(() => {
                      const ratio = trip.crow_flight_ratio || 1.0;
                      if (ratio > 1.25) {
                        const straightDist = trip.distance_km / ratio;
                        const roadEst = straightDist * 1.15; // 15% winding allowance
                        const variance = Math.max(0, trip.distance_km - roadEst);
                        if (variance >= 1) {
                          return (
                            <div className="mt-1 flex items-center gap-1">
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${variance > 15 ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600'}`}>
                                +{variance.toFixed(0)}km EXTRA
                              </span>
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}
                  </div>
                </td>

                {/* 5. Duration */}
                <td className="px-6 py-4 text-center">
                  <div className="flex items-center justify-center gap-1 text-gray-700 font-medium">
                    <Clock size={14} className="text-gray-400" />
                    {trip.duration_hours.toFixed(2)} h
                  </div>
                </td>

                {/* 6. Speed */}
                <td className="px-6 py-4 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold border ${trip.max_speed_kmh > 85
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}>
                      <Zap size={12} />
                      {trip.max_speed_kmh} km/h
                    </div>
                    <span className="text-[10px] text-gray-400">Avg: {trip.avg_speed_kmh} km/h</span>
                  </div>
                </td>

                {/* 7. Arrow Icon */}
                {/* 7. Route Efficiency */}
                <td className="px-6 py-4 text-center">
                  {(() => {
                    const grade = trip.trip_grade || 100;
                    if (grade < 70) return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold border border-red-200">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                        Low Compliance
                      </span>
                    );
                    if (grade < 90) return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold border border-amber-200">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                        Review Needed
                      </span>
                    );
                    return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium border border-green-200">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                        High Integrity
                      </span>
                    );
                  })()}
                </td>

                <td className="px-4 py-4 text-gray-300">
                  <ChevronRight size={20} className="group-hover:text-blue-500 transition-colors" />
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
