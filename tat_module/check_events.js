require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function check() {
  const { data, error } = await supabase.rpc('get_active_queues_v2');
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  const trip = data?.data?.find(t => t.tracker_id === 3380709);
  console.log(trip);
}

check();
