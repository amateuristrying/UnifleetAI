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
    p_limit: 50,
    p_offset: 0,
    p_trip_type: null,
    p_status: null,
    p_destination: null,
    p_tracker_id: 3429967
  });
  
  if (data?.data) {
     for (const t of data.data) {
         console.log("Trip Loading Start:", t.loading_start, "Dar Arrival:", t.dar_arrival, "Waiting:", t.waiting_for_orders_hrs);
     }
  }
}

run();
