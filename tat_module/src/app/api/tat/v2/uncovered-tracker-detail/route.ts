import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const DEFAULT_FACT_LIMIT = 3000;
const DEFAULT_UNCOVERED_LIMIT = 3000;
const MAX_FACT_LIMIT = 50000;
const MAX_UNCOVERED_LIMIT = 50000;
const DISABLED_ORPHAN_GAP_HOURS = 0;

function toPositiveInt(value: string | null, fallback: number, max: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function toNumberOrNull(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function durationHoursFromRange(startRaw: unknown, endRaw: unknown): number | null {
    if (typeof startRaw !== 'string' || typeof endRaw !== 'string') return null;
    const start = new Date(startRaw).getTime();
    const end = new Date(endRaw).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
    return Number(((end - start) / 3600000).toFixed(2));
}

function toEpochMsOrNull(value: string | null): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

function overlapsWindow(startA: number, endA: number, startB: number, endB: number): boolean {
    return startA < endB && endA > startB;
}

function toIsoUtc(ms: number | null): string | null {
    if (ms == null || !Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
}

function startsWithAny(value: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => value.startsWith(prefix));
}

type FactWindow = {
    startMs: number;
    endMs: number;
};

type FactOrderedWindow = {
    startMs: number;
    endMs: number;
    nextStartMs: number | null;
};

type OperationalVisitRow = {
    raw_visit_id: number;
    geofence_name: string;
    stop_state: string | null;
    visit_start_ms: number;
    visit_end_for_overlap_ms: number;
    is_open_geofence: boolean;
};

export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const startRaw = sp.get('start');
        const endRaw = sp.get('end');
        const trackerIdRaw = sp.get('trackerId');
        const factLimitRaw = sp.get('factLimit');
        const uncoveredLimitRaw = sp.get('uncoveredLimit');

        if (!startRaw || !endRaw || !trackerIdRaw) {
            return NextResponse.json(
                { success: false, error: 'Missing required query params: start, end, trackerId' },
                { status: 400 }
            );
        }

        const start = new Date(startRaw);
        const end = new Date(endRaw);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return NextResponse.json(
                { success: false, error: 'start/end must be valid ISO timestamps' },
                { status: 400 }
            );
        }
        if (start > end) {
            return NextResponse.json(
                { success: false, error: 'start must be before or equal to end' },
                { status: 400 }
            );
        }

        const trackerId = Number.parseInt(trackerIdRaw, 10);
        if (!Number.isFinite(trackerId)) {
            return NextResponse.json(
                { success: false, error: 'trackerId must be a valid integer' },
                { status: 400 }
            );
        }

        const orphanGapHours = DISABLED_ORPHAN_GAP_HOURS;
        const factLimit = toPositiveInt(factLimitRaw, DEFAULT_FACT_LIMIT, MAX_FACT_LIMIT);
        const uncoveredLimit = toPositiveInt(uncoveredLimitRaw, DEFAULT_UNCOVERED_LIMIT, MAX_UNCOVERED_LIMIT);

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json(
                { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set.' },
                { status: 503 }
            );
        }

        const supabaseAdmin = getSupabaseAdmin();

        const [factsRes, factsWindowRes, streamRes] = await Promise.all([
            supabaseAdmin.rpc('get_tat_trip_details_v2', {
                p_start_date: start.toISOString(),
                p_end_date: end.toISOString(),
                p_limit: factLimit,
                p_offset: 0,
                p_trip_type: null,
                p_status: null,
                p_search: null,
                p_sort: 'loading_start_desc',
                p_origin: null,
                p_destination: null,
                p_tracker_id: trackerId,
            }),
            supabaseAdmin
                .from('tat_trip_facts_v2')
                .select('dar_arrival,loading_start,trip_closed_at,next_loading_entry,loading_end')
                .eq('tracker_id', trackerId),
            supabaseAdmin.rpc('get_tat_operational_visit_stream_v2', {
                p_start_date: start.toISOString(),
                p_end_date: end.toISOString(),
                p_tracker_id: trackerId,
            }),
        ]);

        if (factsRes.error) {
            return NextResponse.json(
                {
                    success: false,
                    source: 'facts',
                    error: factsRes.error.message,
                    code: factsRes.error.code,
                    details: factsRes.error.details,
                    hint: factsRes.error.hint,
                },
                { status: 500 }
            );
        }

        if (factsWindowRes.error) {
            return NextResponse.json(
                {
                    success: false,
                    source: 'facts_window',
                    error: factsWindowRes.error.message,
                    code: factsWindowRes.error.code,
                    details: factsWindowRes.error.details,
                    hint: factsWindowRes.error.hint,
                },
                { status: 500 }
            );
        }

        if (streamRes.error) {
            return NextResponse.json(
                {
                    success: false,
                    source: 'operational_stream',
                    error: streamRes.error.message,
                    code: streamRes.error.code,
                    details: streamRes.error.details,
                    hint: streamRes.error.hint,
                },
                { status: 500 }
            );
        }

        const factsPayload =
            factsRes.data && typeof factsRes.data === 'object'
                ? factsRes.data as Record<string, unknown>
                : {};
        const factsRaw = Array.isArray(factsPayload.data) ? factsPayload.data : [];
        const factsWindowRaw = Array.isArray(factsWindowRes.data) ? factsWindowRes.data : [];
        const rawStream = Array.isArray(streamRes.data) ? streamRes.data : [];

        const factTrips = factsRaw.map((row, idx) => {
            const item = row as Record<string, unknown>;
            const tripStart =
                typeof item.dar_arrival === 'string' ? item.dar_arrival :
                    (typeof item.loading_start === 'string' ? item.loading_start : null);
            const tripEnd =
                typeof item.trip_closed_at === 'string' ? item.trip_closed_at :
                    (typeof item.next_loading_entry === 'string' ? item.next_loading_entry :
                        (typeof item.completion_time === 'string' ? item.completion_time :
                            (typeof item.loading_end === 'string' ? item.loading_end : null)));
            const derivedDuration = durationHoursFromRange(tripStart, tripEnd);
            const totalTat = toNumberOrNull(item.total_tat_hrs);

            return {
                trip_key: String(item.trip_key || `FACT:${trackerId}:${idx + 1}`),
                trip_status: String(item.trip_status || item.status || 'unknown'),
                loading_terminal: typeof item.loading_terminal === 'string' ? item.loading_terminal : null,
                destination_name:
                    (typeof item.destination_name === 'string' && item.destination_name) ? item.destination_name :
                        ((typeof item.dest_name === 'string' && item.dest_name) ? item.dest_name :
                            (typeof item.customer_name === 'string' ? item.customer_name : null)),
                trip_start_utc: tripStart,
                trip_end_utc: tripEnd,
                trip_duration_hours: totalTat ?? derivedDuration,
            };
        });

        const factWindows: FactWindow[] = factsWindowRaw
            .map((row) => {
                const item = row as Record<string, unknown>;
                const startMs =
                    toEpochMsOrNull(typeof item.dar_arrival === 'string' ? item.dar_arrival : null) ??
                    toEpochMsOrNull(typeof item.loading_start === 'string' ? item.loading_start : null);
                const endMs =
                    toEpochMsOrNull(typeof item.trip_closed_at === 'string' ? item.trip_closed_at : null) ??
                    toEpochMsOrNull(typeof item.next_loading_entry === 'string' ? item.next_loading_entry : null) ??
                    toEpochMsOrNull(typeof item.loading_end === 'string' ? item.loading_end : null) ??
                    toEpochMsOrNull(typeof item.loading_start === 'string' ? item.loading_start : null) ??
                    toEpochMsOrNull(typeof item.dar_arrival === 'string' ? item.dar_arrival : null);

                if (startMs == null || endMs == null) return null;
                if (startMs > end.getTime() || endMs < start.getTime()) return null;
                return { startMs, endMs };
            })
            .filter((w): w is FactWindow => w !== null)
            .sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs));

        const factOrdered: FactOrderedWindow[] = factWindows.map((w, idx) => ({
            startMs: w.startMs,
            endMs: w.endMs,
            nextStartMs: factWindows[idx + 1]?.startMs ?? null,
        }));

        const operationalRows: OperationalVisitRow[] = rawStream
            .map((row, idx) => {
                const item = row as Record<string, unknown>;
                const visitStartMs = toEpochMsOrNull(
                    typeof item.visit_start_utc === 'string' ? item.visit_start_utc : null
                );
                const visitEndForOverlapMs = toEpochMsOrNull(
                    typeof item.visit_end_for_overlap_utc === 'string' ? item.visit_end_for_overlap_utc : null
                );
                const geofenceName =
                    typeof item.geofence_name === 'string' && item.geofence_name
                        ? item.geofence_name
                        : '(null)';
                if (visitStartMs == null || visitEndForOverlapMs == null) return null;
                return {
                    raw_visit_id: idx + 1,
                    geofence_name: geofenceName,
                    stop_state: typeof item.stop_state === 'string' ? item.stop_state : null,
                    visit_start_ms: visitStartMs,
                    visit_end_for_overlap_ms: visitEndForOverlapMs,
                    is_open_geofence: Boolean(item.is_open_geofence),
                };
            })
            .filter((row): row is OperationalVisitRow => row !== null)
            .sort((a, b) => (a.visit_start_ms - b.visit_start_ms) || (a.visit_end_for_overlap_ms - b.visit_end_for_overlap_ms) || (a.raw_visit_id - b.raw_visit_id));

        const trueOrphanRows: OperationalVisitRow[] = [];
        const waitingStagePrefixes = ['ASAS TABATA', 'ASAS DAR OFFICE', 'ASAS KIBAHA'];

        for (const row of operationalRows) {
            const geofenceUpper = row.geofence_name.toUpperCase();
            const isWaitingStageRow =
                startsWithAny(geofenceUpper, waitingStagePrefixes) &&
                factOrdered.some((fo) => {
                    if (row.visit_start_ms < fo.endMs) return false;
                    if (fo.nextStartMs == null) return true;
                    return row.visit_end_for_overlap_ms <= fo.nextStartMs;
                });
            if (isWaitingStageRow) continue;

            const overlapsFact = factWindows.some((fw) => {
                return overlapsWindow(
                    row.visit_start_ms,
                    row.visit_end_for_overlap_ms,
                    fw.startMs,
                    fw.endMs
                );
            });
            if (!overlapsFact) trueOrphanRows.push(row);
        }

        const groupedOrphans: Array<{
            trip_key: string;
            trip_start_utc: string | null;
            trip_end_utc: string | null;
            trip_duration_hours: number | null;
            trip_raw_geofence_rows: number;
            trip_distinct_geofences: number;
            open_geofence_rows: number;
            trip_last_geofence_name: string | null;
            trip_stop_states: string[];
        }> = [];

        let currentGroup: OperationalVisitRow[] = [];
        let previousEndMs: number | null = null;
        let orphanSeq = 0;

        const flushGroup = () => {
            if (currentGroup.length === 0) return;
            orphanSeq += 1;
            const groupStart = currentGroup[0].visit_start_ms;
            const groupEnd = currentGroup.reduce(
                (max, row) => Math.max(max, row.visit_end_for_overlap_ms),
                currentGroup[0].visit_end_for_overlap_ms
            );
            const lastRow = currentGroup.reduce((latest, row) => {
                if (row.visit_start_ms > latest.visit_start_ms) return row;
                if (row.visit_start_ms === latest.visit_start_ms && row.raw_visit_id > latest.raw_visit_id) return row;
                return latest;
            }, currentGroup[0]);
            const geofenceSet = new Set(currentGroup.map((row) => row.geofence_name));
            const stopStateSet = new Set(
                currentGroup
                    .map((row) => row.stop_state)
                    .filter((value): value is string => typeof value === 'string' && value.length > 0)
            );
            const tripDuration =
                groupEnd >= groupStart
                    ? Number(((groupEnd - groupStart) / 3600000).toFixed(2))
                    : null;
            groupedOrphans.push({
                trip_key: `ORPHAN:${trackerId}:${String(orphanSeq).padStart(6, '0')}`,
                trip_start_utc: toIsoUtc(groupStart),
                trip_end_utc: toIsoUtc(groupEnd),
                trip_duration_hours: tripDuration,
                trip_raw_geofence_rows: currentGroup.length,
                trip_distinct_geofences: geofenceSet.size,
                open_geofence_rows: currentGroup.filter((row) => row.is_open_geofence).length,
                trip_last_geofence_name: lastRow.geofence_name,
                trip_stop_states: Array.from(stopStateSet),
            });
            currentGroup = [];
        };

        for (const row of trueOrphanRows) {
            const startsNewGroup =
                previousEndMs == null || row.visit_start_ms > previousEndMs;
            if (startsNewGroup) {
                flushGroup();
                currentGroup = [row];
            } else {
                currentGroup.push(row);
            }
            previousEndMs = Math.max(previousEndMs ?? row.visit_end_for_overlap_ms, row.visit_end_for_overlap_ms);
        }
        flushGroup();

        const filteredUncoveredTrips = groupedOrphans
            .sort((a, b) => {
                const aStart = toEpochMsOrNull(a.trip_start_utc);
                const bStart = toEpochMsOrNull(b.trip_start_utc);
                return (bStart ?? 0) - (aStart ?? 0);
            })
            .slice(0, uncoveredLimit);

        let trackerName = `(tracker ${trackerId})`;
        if (factsRaw.length > 0) {
            const t = factsRaw[0] as Record<string, unknown>;
            if (typeof t.tracker_name === 'string' && t.tracker_name) trackerName = t.tracker_name;
        } else if (rawStream.length > 0) {
            const t = rawStream[0] as Record<string, unknown>;
            if (typeof t.tracker_name === 'string' && t.tracker_name) trackerName = t.tracker_name;
        }

        return NextResponse.json({
            success: true,
            data: {
                tracker_id: trackerId,
                tracker_name: trackerName,
                fact_trip_count: Number(factsPayload.total_all || factTrips.length),
                uncovered_trip_count: filteredUncoveredTrips.length,
                fact_trips: factTrips,
                uncovered_trips: filteredUncoveredTrips,
            },
            meta: {
                start: start.toISOString(),
                end: end.toISOString(),
                tracker_id: trackerId,
                orphan_gap_hours: orphanGapHours,
                fact_limit: factLimit,
                uncovered_limit: uncoveredLimit,
                true_orphan_mode: 'raw_stream_row_no_overlap',
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
