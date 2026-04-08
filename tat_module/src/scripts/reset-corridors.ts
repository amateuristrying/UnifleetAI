import { getSupabaseAdmin } from '../lib/supabase-server';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function reset() {
    const supabase = getSupabaseAdmin();
    console.log('🗑️  Clearing fleet_corridors table (Batch Mode)...');

    let deletedTotal = 0;
    const BATCH_SIZE = 5000;

    while (true) {
        // 1. Fetch a batch of IDs (using the new surrogate key 'id')
        const { data: rows, error: fetchError } = await supabase
            .from('fleet_corridors')
            .select('id')
            .limit(BATCH_SIZE);

        if (fetchError) {
            console.error('❌ Error fetching IDs:', fetchError.message);
            break;
        }

        if (!rows || rows.length === 0) {
            console.log('✅ Table is empty.');
            break;
        }

        const ids = rows.map(r => r.id);

        // 2. Delete this batch
        const { error: deleteError } = await supabase
            .from('fleet_corridors')
            .delete()
            .in('id', ids);

        if (deleteError) {
            console.error('❌ Error deleting batch:', deleteError.message);
            // Try smaller batch? Or just abort.
            break;
        }

        deletedTotal += ids.length;
        process.stdout.write(`\r   Deleted ${deletedTotal} rows...`);
    }

    console.log(`\n🎉 Done! Deleted ${deletedTotal} rows.`);
    console.log('   You can now run the analysis script safely.');
}

reset();
