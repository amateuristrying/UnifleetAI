
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runQuery() {
    let query = '';
    const arg = process.argv[2];

    if (!arg) {
        console.error('Please provide a query string or a path to a .sql file');
        process.exit(1);
    }

    if (arg.endsWith('.sql')) {
        const filePath = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
        if (fs.existsSync(filePath)) {
            query = fs.readFileSync(filePath, 'utf8');
        } else {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
        }
    } else {
        query = arg;
    }

    try {
        const { data, error } = await supabase.rpc('exec_sql', { query });

        if (error) {
            console.error('Error calling exec_sql:', error);
            process.exit(1);
        }

        console.log(JSON.stringify(data, null, 2));

    } catch (err) {
        console.error('Unexpected error:', err);
        process.exit(1);
    }
}

runQuery();
