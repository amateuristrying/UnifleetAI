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
  
  // Find the trip starting in late Jan
  const trip = data?.data?.find(t => t.kurasini_entry?.startsWith('2026-01-22') || t.kurasini_entry?.startsWith('2026-01-23'));
  console.log("Trip loading start:", trip?.loading_start);
  console.log("Trip wait hours:", trip?.waiting_for_orders_hrs);
  console.log("Trip loading hours:", trip?.loading_phase_hrs);
  
  if (trip?.visit_chain) {
    console.log("Visit chain length:", trip.visit_chain.length);
    console.log("First stop:", trip.visit_chain[0]);
    console.log("Second stop:", trip.visit_chain[1]);
  }
}

run();
