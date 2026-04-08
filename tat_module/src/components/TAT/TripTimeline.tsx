import React from 'react';
import { MapPin, CheckCircle2 } from 'lucide-react';

interface VisitEvent {
    geofence_name: string;
    in_time: string;
    out_time: string | null;
    event_type: 'loading' | 'unloading' | 'border' | 'transit';
}

interface TripTimelineProps {
    visitChain: VisitEvent[];
}

// Broad regional geofences that contain smaller, more specific ones
const BROAD_GEOFENCES = new Set([
    'Dar Geofence',
    'Kiluvya to Mbezi Geofence',
    'Kiluvya to Mbezi  Geofence',
    'Tanga GF',
    'Mtwara GF',
    'Beira Geofence',
    'Beira GF',
    'Mombasa GF',
    'Tanga Parking',
    'KURASINI ALL TOGETHER'
]);

const SYNONYMOUS_SITES: Record<string, string> = {
    'Loading Operations (Kurasini)': 'Loading Operations (Kurasini)',
    'TIPER DEPOT': 'Loading Operations (Kurasini)',
    'Puma Depo Kurasini': 'Loading Operations (Kurasini)',
    'Oryx Loading Depo (Kigamboni)': 'Loading Operations (Kurasini)',
    'Oryx Dar Depo': 'Loading Operations (Kurasini)',
    'Oilcom Dar Depo': 'Loading Operations (Kurasini)',
    'OILCOM LIMITED TERMINAL DEPOT': 'Loading Operations (Kurasini)',
    'MERU TERMINAL DEPOT': 'Loading Operations (Kurasini)',
    'MOGAS OIL DEPOT': 'Loading Operations (Kurasini)',
    'SUPERSTAR FUEL DEPOT': 'Loading Operations (Kurasini)',
    'GBP DRS DEPOT': 'Loading Operations (Kurasini)',
    'ORYX FUEL DEPOT': 'Loading Operations (Kurasini)',
    'WORLD OIL DEPOT': 'Loading Operations (Kurasini)',
    'GBP TANGA TERMINAL': 'Loading Operations (Kurasini)',
    'Oryx FUEL DEPOT': 'Loading Operations (Kurasini)',
    'KURASINI ALL TOGETHER': 'Loading Operations (Kurasini)',

    // Beira terminal grouping
    'Loading Operations (Beira)': 'Loading Operations (Beira)',        // >>>FIX #1: self-reference for consistency
    'Camel Oil': 'Loading Operations (Beira)',
    'Petrobeira': 'Loading Operations (Beira)',
    'Petroda': 'Loading Operations (Beira)',
    'Lake Oil': 'Loading Operations (Beira)',
    'Inpetro': 'Loading Operations (Beira)',
    'Xstorage': 'Loading Operations (Beira)',
    'Mount Meru': 'Loading Operations (Beira)',

    // Mtwara terminal grouping
    'Loading Operations (Mtwara)': 'Loading Operations (Mtwara)',      // >>>FIX #1: self-reference
    'Oryx Mtwara Depot': 'Loading Operations (Mtwara)',
    'Oilcom Mtwara Depot': 'Loading Operations (Mtwara)',

    // Mombasa terminal grouping
    'Loading Operations (Mombasa)': 'Loading Operations (Mombasa)',    // >>>FIX #1: self-reference
    'VIVO Energy Mombasa Terminal': 'Loading Operations (Mombasa)',

    'Asas Head Office Ipogolo  Yard -Iringa': 'Asas Head Office (Ipogoro)',
    'Asas Head Office Ipogolo Yard -Iringa': 'Asas Head Office (Ipogoro)',
    'IPOGORO': 'Asas Head Office (Ipogoro)',
    'ASAS Chapwa  Yard': 'ASAS Chapwa Yard',
    'ASAS Chapwa Yard': 'ASAS Chapwa Yard',
    'Tunduma Border 1': 'Tunduma Border',
    'Tanzania Tunduma Border': 'Tunduma Border',
    'TUNDUMA BORDER TZ SIDE': 'Tunduma Border',
    'NAKONDE BORDER ZMB SIDE': 'Nakonde Border',
    'Zambia Nakonde Border': 'Nakonde Border',
    'SAKANIA ZMB SIDE': 'Sakania Boundary',
    'Sakania border': 'Sakania Boundary',
    'SAKANIA DRC': 'Sakania Boundary',
    'Mokambo border': 'Sakania Boundary',
    'KASUMBALESA ZMB SIDE': 'Kasumbalesa Border',
    'KASUMBALESA BORDER  DRC SIDE': 'Kasumbalesa Border',
    'Kasumbalesa Border (DRC)': 'Kasumbalesa Border',
    'KASUMBALESA': 'Kasumbalesa Border'
};

// >>>FIX #2: Hoisted outside mergeVisitChain — avoids re-creating Set on every loop iteration
const LOADING_OPS_NAMES = new Set([
    'Loading Operations (Kurasini)',
    'Loading Operations (Beira)',
    'Loading Operations (Mtwara)',
    'Loading Operations (Mombasa)',
]);

export function mergeVisitChain(chain: VisitEvent[]): VisitEvent[] {
    if (!chain || chain.length === 0) return [];

    // Override event_type for Chapwa Yard to be 'border'
    const chapwaEventTypeNormalizedChain = chain.map(v => {
        if (v.geofence_name === 'ASAS Chapwa Yard' || v.geofence_name === 'ASAS Chapwa  Yard' || v.geofence_name === 'CHAPWA') {
            return { ...v, event_type: 'border' as const };
        }
        return v;
    });

    // Normalize names to canonical site names
    const nameNormalizedChain = chapwaEventTypeNormalizedChain.map(visit => ({
        ...visit,
        geofence_name: SYNONYMOUS_SITES[visit.geofence_name] || visit.geofence_name
    }));

    // Sort by arrival time
    const sorted = [...nameNormalizedChain].sort((a, b) => new Date(a.in_time).getTime() - new Date(b.in_time).getTime());

    // Step 1: Pre-filter broad geofences if they overlap with ANY specific ones
    const specificsOnly = sorted.filter(visit => {
        if (!BROAD_GEOFENCES.has(visit.geofence_name)) return true;

        const vStart = new Date(visit.in_time).getTime();
        const vEnd = visit.out_time ? new Date(visit.out_time).getTime() : vStart;

        // If this broad visit overlaps with anything that is NOT broad, suppress it
        const hasSpecificOverlap = sorted.some(other =>
            other !== visit &&
            !BROAD_GEOFENCES.has(other.geofence_name) &&
            new Date(other.in_time).getTime() <= vEnd &&
            (other.out_time ? new Date(other.out_time).getTime() : new Date(other.in_time).getTime()) >= vStart
        );
        return !hasSpecificOverlap;
    });

    // Step 2: Merge same-geofence visits with gaps ≤ 4 hours
    const GAP_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours
    const LOADING_OPS_GAP_MS = 36 * 60 * 60 * 1000; // 36h bridges overnight suppression gaps
    const dailyMerged: VisitEvent[] = [];
    for (const visit of specificsOnly) {
        let merged = false;
        for (let j = dailyMerged.length - 1; j >= 0; j--) {
            const prev = dailyMerged[j];

            const prevEnd = prev.out_time ? new Date(prev.out_time).getTime() : new Date(prev.in_time).getTime();
            const currStart = new Date(visit.in_time).getTime();

            const isSameGeo = prev.geofence_name === visit.geofence_name;

            // Allow merging of synonymous sites if they overlap or have tiny gaps
            const isSynonymous = isSameGeo; // SYNONYMOUS_SITES already handled in name normalization

            // Strictly control border merging to known pairs
            const isChapwaTunduma = (prev.geofence_name.includes('Chapwa')) &&
                (visit.geofence_name.includes('Tunduma') || visit.geofence_name.includes('Nakonde'));

            const isTundumaNakonde = (prev.geofence_name.includes('Tunduma') || prev.geofence_name.includes('Nakonde')) &&
                (visit.geofence_name.includes('Tunduma') || visit.geofence_name.includes('Nakonde'));

            const isBorderChain = (prev.event_type === 'border' && visit.event_type === 'border') ||
                (prev.geofence_name.includes('Boundary')) ||
                (visit.geofence_name.includes('Boundary'));

            // Loading unification window — uses hoisted LOADING_OPS_NAMES
            const isLoadingOps = LOADING_OPS_NAMES.has(prev.geofence_name) && prev.geofence_name === visit.geofence_name; // >>>FIX #3: removed double semicolon

            const isAdjacentChain = isChapwaTunduma || isTundumaNakonde || (isBorderChain && (prev.geofence_name === visit.geofence_name)) || isLoadingOps;

            const effectiveGapThreshold = isLoadingOps
                ? LOADING_OPS_GAP_MS
                : isAdjacentChain
                    ? 12 * 60 * 60 * 1000
                    : GAP_THRESHOLD_MS;

            if ((isSynonymous || isAdjacentChain) && (currStart - prevEnd <= effectiveGapThreshold)) {
                const currEnd = visit.out_time ? new Date(visit.out_time).getTime() : currStart;
                if (!prev.out_time || currEnd > prevEnd) {
                    prev.out_time = visit.out_time;
                }
                if (!isSynonymous && !isLoadingOps && isAdjacentChain && !prev.geofence_name.includes(visit.geofence_name)) {
                    prev.geofence_name = `${prev.geofence_name} -> ${visit.geofence_name}`;
                }
                merged = true;
                break;
            }
            if (!isSynonymous && !isAdjacentChain) {
                break;
            }
        }
        if (!merged) dailyMerged.push({ ...visit });
    }

    // Step 3: Cleanup redundant/simultaneous specific geofences
    const finalClean: VisitEvent[] = [];
    for (const visit of dailyMerged) {
        let isRedundant = false;
        for (let k = finalClean.length - 1; k >= 0; k--) {
            const prev = finalClean[k];
            const pStart = new Date(prev.in_time).getTime();
            const vStart = new Date(visit.in_time).getTime();
            const pEnd = prev.out_time ? new Date(prev.out_time).getTime() : pStart;
            const vEnd = visit.out_time ? new Date(visit.out_time).getTime() : vStart;

            // If overlap > 80% and names are similar, consider redundant
            if (Math.abs(pStart - vStart) < 15 * 60000 && Math.abs(pEnd - vEnd) < 15 * 60000) {
                isRedundant = true;
                break;
            }
        }
        if (!isRedundant) finalClean.push(visit);
    }

    return finalClean;
}

export default function TripTimeline({ visitChain }: TripTimelineProps) {
    if (!visitChain || visitChain.length === 0) {
        return <div className="text-gray-500 text-sm">No timeline events available.</div>;
    }

    // Merge the visit chain to clean up daily splits and overlapping geofences
    const mergedChain = mergeVisitChain(visitChain);

    return (
        <div className="flow-root">
            <ul role="list" className="-mb-8">
                {mergedChain.map((event, idx) => (
                    <li key={idx}>
                        <div className="relative pb-8">
                            {idx !== mergedChain.length - 1 ? (
                                <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                            ) : null}
                            <div className="relative flex space-x-3">
                                <div>
                                    <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-4 ring-gray-900 ${event.event_type === 'border' ? 'bg-yellow-500' :
                                        event.event_type === 'loading' ? 'bg-orange-500' :
                                            event.event_type === 'unloading' ? 'bg-emerald-500' :
                                                event.out_time ? 'bg-blue-600' : 'bg-blue-500/50'
                                        }`}>
                                        {event.out_time ? (
                                            <CheckCircle2 className="h-5 w-5 text-white" />
                                        ) : (
                                            <MapPin className="h-5 w-5 text-white" />
                                        )}
                                    </span>
                                </div>
                                <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                    <div>
                                        <p className="text-sm text-gray-100 font-bold">{event.geofence_name}</p>
                                        <div className="text-xs text-gray-500 mt-1 flex flex-col gap-1">
                                            <div className="flex items-center">
                                                <span className="w-20 font-medium">Arrived:</span>
                                                <span>
                                                    {event.in_time ? new Date(event.in_time).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}
                                                </span>
                                            </div>
                                            {event.out_time && (
                                                <div className="flex items-center">
                                                    <span className="w-20 font-medium">Departed:</span>
                                                    <span>
                                                        {new Date(event.out_time).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="whitespace-nowrap text-right text-sm text-gray-500">
                                        {event.event_type === 'loading' ? (
                                            <span className="inline-flex items-center rounded-md bg-orange-500/10 px-2 py-1 text-xs font-bold text-orange-400 ring-1 ring-inset ring-orange-500/20">
                                                Loading Ops
                                            </span>
                                        ) : event.event_type === 'unloading' ? (
                                            <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                                                Unloading Ops
                                            </span>
                                        ) : event.event_type === 'border' ? (
                                            <span className="inline-flex items-center rounded-md bg-yellow-500/10 px-2 py-1 text-xs font-bold text-yellow-400 ring-1 ring-inset ring-yellow-500/20">
                                                Border Entry
                                            </span>
                                        ) : event.out_time ? (
                                            <span className="inline-flex items-center rounded-md bg-white/5 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-white/10">
                                                Completed
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse">
                                                In Transit
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}