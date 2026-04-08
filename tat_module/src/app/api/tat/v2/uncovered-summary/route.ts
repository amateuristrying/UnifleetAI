import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const DEFAULT_TRACKER_LIMIT = 200;
const MAX_TRACKER_LIMIT = 5000;
const DISABLED_ORPHAN_GAP_HOURS = 0;

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function describeRpcError(error: unknown): {
    message: string;
    code: string | null;
    details: string | null;
    hint: string | null;
    raw: string | null;
} {
    const errObj = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
    const message =
        (typeof errObj.message === 'string' && errObj.message) ||
        (typeof errObj.details === 'string' && errObj.details) ||
        (typeof errObj.hint === 'string' && errObj.hint) ||
        '';
    const raw = stringifyUnknown(error);
    return {
        message: message || 'RPC get_tat_uncovered_facts_summary_v2 failed.',
        code: typeof errObj.code === 'string' ? errObj.code : null,
        details: typeof errObj.details === 'string' ? errObj.details : null,
        hint: typeof errObj.hint === 'string' ? errObj.hint : null,
        raw: raw && raw !== '{}' ? raw : null,
    };
}

function toPositiveInt(value: string | null, fallback: number, max: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function isTimeoutLikeRpcError(message: string | null, details: string | null): boolean {
    const text = `${message || ''} ${details || ''}`.toLowerCase();
    return (
        text.includes('statement timeout') ||
        text.includes('canceling statement due to statement timeout') ||
        text.includes('canceling statement due to user request') ||
        text.includes('timeout')
    );
}

export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const startRaw = sp.get('start');
        const endRaw = sp.get('end');
        const trackerIdRaw = sp.get('trackerId');
        const trackerLimitRaw = sp.get('trackerLimit');

        if (!startRaw || !endRaw) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Missing required query params: start, end',
                },
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

        let trackerId: number | null = null;
        if (trackerIdRaw) {
            const parsedTracker = Number.parseInt(trackerIdRaw, 10);
            if (!Number.isFinite(parsedTracker)) {
                return NextResponse.json(
                    { success: false, error: 'trackerId must be a valid integer' },
                    { status: 400 }
                );
            }
            trackerId = parsedTracker;
        }

        const orphanGapHours = DISABLED_ORPHAN_GAP_HOURS;
        const trackerLimit = toPositiveInt(trackerLimitRaw, DEFAULT_TRACKER_LIMIT, MAX_TRACKER_LIMIT);

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set.',
                },
                { status: 503 }
            );
        }

        const supabaseAdmin = getSupabaseAdmin();
        const limitsToTry = [trackerLimit];
        if (trackerLimit > 200) limitsToTry.push(200);
        if (trackerLimit > 100) limitsToTry.push(100);

        let data: unknown = null;
        let lastErr: ReturnType<typeof describeRpcError> | null = null;
        let usedLimit = trackerLimit;

        for (const candidateLimit of limitsToTry) {
            const { data: attemptData, error: attemptError } = await supabaseAdmin.rpc('get_tat_uncovered_facts_summary_v2', {
                p_start_date: start.toISOString(),
                p_end_date: end.toISOString(),
                p_tracker_id: trackerId,
                p_orphan_gap_hours: orphanGapHours,
                p_tracker_limit: candidateLimit,
            });

            if (!attemptError) {
                data = attemptData ?? null;
                usedLimit = candidateLimit;
                lastErr = null;
                break;
            }

            const err = describeRpcError(attemptError);
            lastErr = err;

            if (!isTimeoutLikeRpcError(err.message, err.details)) {
                break;
            }
        }

        if (lastErr) {
            return NextResponse.json(
                {
                    success: false,
                    error: lastErr.message,
                    code: lastErr.code,
                    details: lastErr.details,
                    hint: lastErr.hint,
                    raw: lastErr.raw,
                    rpc: 'get_tat_uncovered_facts_summary_v2',
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: data ?? null,
            meta: {
                start: start.toISOString(),
                end: end.toISOString(),
                tracker_id: trackerId,
                orphan_gap_hours: orphanGapHours,
                tracker_limit: usedLimit,
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
