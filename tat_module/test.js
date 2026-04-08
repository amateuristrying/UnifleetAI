const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('tat_trips_data')
    .select('*')
    .like('tracker_name', 'T 272%')
    .order('loading_entry', { ascending: false })
    .limit(10);
  console.dir(data, {depth: null});
  
  const { data: d2 } = await supabase.from('tat_trips_data')
    .select('*')
    .like('tracker_name', 'T 288%')
    .order('loading_entry', { ascending: false })
    .limit(10);
  console.dir(d2, {depth: null});
}
run();
