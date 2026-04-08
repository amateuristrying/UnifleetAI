// apply_migrations.js
// Applies one or more SQL migration files to Supabase via the Management API.
// This bypasses the service-role statement_timeout because the Management API
// uses a privileged connection with no timeout restrictions on DDL.
//
// SETUP (one time):
//   1. Go to https://supabase.com/dashboard/account/tokens
//   2. Create a new personal access token
//   3. Add to .env.local:  SUPABASE_ACCESS_TOKEN=sbp_xxxx
//
// USAGE:
//   node apply_migrations.js <file1.sql> [file2.sql] ...
//
// Examples:
//   node apply_migrations.js supabase/migrations/tat_v2_refactor_phase_2_fix.sql
//   node apply_migrations.js supabase/migrations/tat_v2_refactor_phase_2_fix.sql \
//                             supabase/migrations/tat_v2_refactor_phase_3_fix.sql \
//                             supabase/migrations/tat_v2_refactor_phase_4_fix.sql \
//                             supabase/migrations/tat_v2_refactor_phase_7.sql
//
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const SUPABASE_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ACCESS_TOKEN    = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local');
    process.exit(1);
}
if (!ACCESS_TOKEN) {
    console.error('Missing SUPABASE_ACCESS_TOKEN in .env.local');
    console.error('');
    console.error('To create one:');
    console.error('  1. Visit https://supabase.com/dashboard/account/tokens');
    console.error('  2. Generate a personal access token');
    console.error('  3. Add to .env.local:  SUPABASE_ACCESS_TOKEN=sbp_xxxx');
    process.exit(1);
}

// Extract project ref from URL: https://PROJREF.supabase.co
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
if (!projectRef || projectRef.length < 10) {
    console.error('Could not parse project ref from SUPABASE_URL:', SUPABASE_URL);
    process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('Usage: node apply_migrations.js <file1.sql> [file2.sql] ...');
    process.exit(1);
}

async function applySql(sql, label) {
    const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ query: sql }),
        signal: AbortSignal.timeout(120_000), // 2 minutes for DDL
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
    }

    const result = await res.json();
    if (result.error) {
        throw new Error(result.error.message || JSON.stringify(result.error));
    }
    return result;
}

async function main() {
    console.log(`Project ref: ${projectRef}`);
    console.log('');

    for (const file of files) {
        if (!fs.existsSync(file)) {
            console.error(`File not found: ${file}`);
            process.exit(1);
        }

        const sql = fs.readFileSync(file, 'utf8');
        console.log(`Applying: ${file} (${(sql.length / 1024).toFixed(1)} KB)`);

        try {
            await applySql(sql, file);
            console.log(`  ✓ Applied`);
        } catch (err) {
            console.error(`  ❌ Error: ${err.message}`);
            process.exit(1);
        }
    }

    console.log('');
    console.log('All migrations applied. Now run:');
    console.log('  node rebuild_v2_historical.js');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
