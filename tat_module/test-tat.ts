import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('get_tat_trip_details', {
    p_start_date: '2026-01-01',
    p_end_date: '2026-02-28',
    p_limit: 10,
    p_offset: 0,
    p_trip_type: null,
    p_status: null,
    p_destination: null,
    p_tracker_id: 3429967
  });
  console.log(JSON.stringify(data?.data?.map(t => ({
    departure: t.departure_time,
    loading_start: t.loading_start,
    loading_end: t.loading_end,
    dar_arrival: t.dar_arrival,
    dar_exit: t.dar_exit,
    wait_time: t.waiting_for_orders_hrs
  })), null, 2));
}

run();
