import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('get_tat_trip_details', {
    p_start_date: '2026-01-01',
    p_end_date: '2026-03-31',
    p_limit: 100,
    p_offset: 0,
    p_trip_type: null,
    p_status: null,
    p_destination: null,
    p_tracker_id: 3429967
  });
  console.log(JSON.stringify(data?.data?.map(t => ({
    tracker_id: t.tracker_id,
    dar_arrival: t.dar_arrival,
    loading_start: t.loading_start,
    loading_end: t.loading_end,
    dest_name: t.dest_name
  })), null, 2));
}

run();
