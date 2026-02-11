import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder';

/**
 * Supabase client instance.
 * Note: If the environment variables are missing, this will fail to authenticate,
 * but will at least allow the application to boot and display an error message.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

