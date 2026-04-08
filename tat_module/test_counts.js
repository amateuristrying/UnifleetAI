require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  const { data, error } = await supabase.rpc('get_active_queues_v2');
  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data.active_queue_counts, null, 2));
    
    // Check loading live logic
    const { data: raw } = await supabase.from('tat_trip_facts_v2').select('status, loading_start, loading_end').eq('status', 'pre_transit').limit(5);
    console.log('Sample pre_transit:');
    console.log(raw);
  }
}
run();
