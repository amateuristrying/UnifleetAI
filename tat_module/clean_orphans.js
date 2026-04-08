const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function cleanOrphans() {
  console.log('Running Phase 66c Orphan Cleanup... (DRY RUN)');
  
  // 1. First run as DRY RUN
  const { data: dryRunData, error: dryRunErr } = await supabase.rpc('cleanup_orphan_trip_keys_v2', {
    p_start: '2020-01-01T00:00:00Z',
    p_end: '2030-01-01T00:00:00Z',
    p_tracker_id: null,
    p_dry_run: true
  });
  
  if (dryRunErr) {
    console.error('Dry run failed:', dryRunErr);
    return;
  }
  
  console.log(`Found ${dryRunData?.length || 0} orphans.`);
  if (dryRunData && dryRunData.length > 0) {
    console.log('Sample orphans:', dryRunData.slice(0, 5));
    
    // 2. Now execute the real cleanup
    console.log('\nExecuting actual cleanup...');
    const { data, error } = await supabase.rpc('cleanup_orphan_trip_keys_v2', {
      p_start: '2020-01-01T00:00:00Z',
      p_end: '2030-01-01T00:00:00Z',
      p_tracker_id: null,
      p_dry_run: false
    });
    
    if (error) {
      console.error('Cleanup failed:', error);
    } else {
      console.log(`Successfully cleaned ${data?.length || 0} orphans from all tables.`);
    }
  } else {
    console.log('No orphans found, skipping actual cleanup execution.');
  }
}

cleanOrphans();
