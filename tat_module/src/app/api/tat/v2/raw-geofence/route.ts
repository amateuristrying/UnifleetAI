import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const DEFAULT_LIMIT = 1500;
const MAX_LIMIT = 5000;

function toPositiveInt(value: string | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const trackerIdRaw = sp.get('trackerId');
        const startRaw = sp.get('start');
        const endRaw = sp.get('end');
        const limitRaw = sp.get('limit');

        if (!trackerIdRaw || !startRaw || !endRaw) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Missing required query params: trackerId, start, end',
                },
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

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set.',
                },
                { status: 503 }
            );
        }

        const limit = Math.min(toPositiveInt(limitRaw, DEFAULT_LIMIT), MAX_LIMIT);
        const supabaseAdmin = getSupabaseAdmin();
        const startIso = start.toISOString();
        const endIso = end.toISOString();

        // Overlap window:
        //   visit starts before window end AND visit ends after window start
        // For open rows (out_time_dt is null), keep them if their start is before window end.
        // This catches midnight-split continuation rows, open visits, and partial overlaps.
        const { data, error } = await supabaseAdmin
            .from('geofence_visits')
            .select(
                'id, tracker_id, tracker_name, geofence_name, zone_name, in_time_dt, out_time_dt, visit_date, duration_seconds, in_address, out_address, source_file, created_at'
            )
            .eq('tracker_id', trackerId)
            .lte('in_time_dt', endIso)
            .or(`out_time_dt.gte.${startIso},out_time_dt.is.null`)
            .order('in_time_dt', { ascending: true })
            .limit(limit);

        if (error) {
            return NextResponse.json(
                {
                    success: false,
                    error: error.message,
                    code: error.code,
                    details: error.details,
                    hint: error.hint,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: data ?? [],
            meta: {
                tracker_id: trackerId,
                start: start.toISOString(),
                end: end.toISOString(),
                rows: (data ?? []).length,
                limit,
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
