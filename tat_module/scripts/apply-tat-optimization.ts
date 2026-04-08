import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function deploy() {
    const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error("Missing DB URL in .env.local (checked SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL)");
        console.log("Available Env Keys:", Object.keys(process.env).filter(k => k.includes('URL') || k.includes('DB')));
        process.exit(1);
    }

    const client = new Client({ connectionString });
    await client.connect();

    try {
        const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', 'tat_optimization.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log("Applying migration:", sqlPath);
        await client.query(sql);
        console.log("Migration applied successfully.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await client.end();
    }
}

deploy();
