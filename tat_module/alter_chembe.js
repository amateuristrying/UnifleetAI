const { Client } = require('pg');

async function alterTable() {
    const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

    try {
        await client.connect();
        console.log("Adding Chembe columns...");
        await client.query(`
      ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS border_chembe_entry TIMESTAMPTZ;
      ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS border_chembe_exit TIMESTAMPTZ;
      ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS return_border_chembe_entry TIMESTAMPTZ;
      ALTER TABLE tat_trips_data ADD COLUMN IF NOT EXISTS return_border_chembe_exit TIMESTAMPTZ;
    `);
        console.log("checking chembe geofence name...");
        const res = await client.query("SELECT DISTINCT geofence_name FROM public.geofence_visits WHERE geofence_name ILIKE '%chembe%' LIMIT 5;");
        console.log(res.rows);
    } catch (err) {
        console.error(err.message);
    } finally {
        await client.end();
    }
}
alterTable();
