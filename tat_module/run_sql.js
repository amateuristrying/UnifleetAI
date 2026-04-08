const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const sql = fs.readFileSync('supabase/migrations/tat_optimization_incremental.sql', 'utf8');
  
  // Try using the internal RPC to execute raw SQL (some Supabase projects have an exec_sql wrapper)
  console.log('Sending SQL migration via REST...');
  // Usually migrations are applied via the Postgres connection. Since we can't pg connect easily,
  // we can use the CLI pushing to a linked project
  // Wait, let's just see if executing `process_tat_chunk` alone fixes dupes first.
  let { data, error } = await supabase.rpc('process_tat_chunk', { p_start: '2025-12-01T00:00:00Z', p_end: new Date().toISOString() });
  console.log(error || data);
}
run();
