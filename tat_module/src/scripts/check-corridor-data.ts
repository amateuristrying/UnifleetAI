
import { getSupabaseAdmin } from '../lib/supabase-server';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function check() {
    console.log('🔍 Checking for directional corridor data...');
    const supabase = getSupabaseAdmin();

    // 1. Check total corridors
    const { count: total, error: err1 } = await supabase
        .from('fleet_corridors')
        .select('*', { count: 'exact', head: true });

    if (err1) {
        console.error('❌ Error assessing table:', err1.message);
        return;
    }

    // 2. Check corridors WITH bearing
    const { count: directional, error: err2 } = await supabase
        .from('fleet_corridors')
        .select('*', { count: 'exact', head: true })
        .not('bearing_bucket', 'is', null);

    console.log(`\n📊 Status:`);
    console.log(`   Total Corridors:       ${total}`);
    console.log(`   Directional Corridors: ${directional}`);

    if ((directional || 0) > 0) {
        console.log(`\n✅ SUCCESS: You have ${directional} corridors with direction data.`);
        console.log(`   -> Open Security Map`);
        console.log(`   -> Select "Corridors" layer`);
        console.log(`   -> ZOOM IN to level 13+ (Street View level)`);
        console.log(`   -> You should see "▲" arrows indicating flow.`);
    } else {
        console.log(`\n⚠️  WARNING: No directional data found.`);
        console.log(`   You must run the analysis script to populate bearings:`);
        console.log(`   npx tsx src/scripts/run-batch-manual.ts`);
    }
}

check();
