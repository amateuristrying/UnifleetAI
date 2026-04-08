import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabaseAdmin: SupabaseClient | null = null;

/**
 * Returns a server-only Supabase client with elevated privileges for write operations.
 * Lazily initialized to avoid build errors when the env var isn't set.
 * IMPORTANT: Never import this in client components.
 */
export function getSupabaseAdmin(): SupabaseClient {
    if (_supabaseAdmin) return _supabaseAdmin;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error(
            'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL. ' +
            'Add SUPABASE_SERVICE_ROLE_KEY to .env.local (without NEXT_PUBLIC_ prefix).'
        );
    }

    _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    return _supabaseAdmin;
}
