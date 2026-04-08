import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('get_tat_trip_details', {
    p_start_date: '2026-01-01',
    p_end_date: '2026-02-28',
    p_tracker_id: 3429967,
    p_limit: 5
  });

  if (error) {
     console.error("RPC Error:", error);
     return;
  }
  
  const trip = data.data.find((t: any) => 
     t.loading_start.startsWith('2026-01-22') || t.loading_start.startsWith('2026-01-21') || t.kurasini_entry.startsWith('2026-01-22')
  );

  console.log("Trip Start Time:", trip?.loading_start);
  console.log("Dar Arrival:", trip?.dar_arrival);
  console.log("Waiting for Orders (hrs):", trip?.waiting_for_orders_hrs);
  console.log("Loading Station:", trip?.loading_terminal);
  console.log("Loading Phase (hrs):", trip?.loading_phase_hrs);
  console.log("Visit Chain items:", trip?.visit_chain?.slice(0, 3) || trip?.visit_chain);
}
run();
