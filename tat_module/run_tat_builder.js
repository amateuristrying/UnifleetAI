const { Client } = require('pg');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function rebuildTAT(dbUrl) {
  // Use the exact string provided by the user (which Supabase guarantees will work)
  const connectionString = dbUrl.trim();

  if (!connectionString.includes('supabase.com')) {
    console.error("❌ Invalid URL. Please paste the full 'postgresql://...' string from your Supabase Dashboard.");
    process.exit(1);
  }

  console.log("\n🔌 Connecting directly to your Supabase Transaction Pooler...");

  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0, // No timeouts
    query_timeout: 0
  });

  try {
    await client.connect();
    console.log("✅ Successfully authenticated and connected!");

    console.log("🧹 1. Truncating old TAT data (cleaning slate)...");
    await client.query('TRUNCATE TABLE tat_trips_data;');
    console.log("✅ Wiped correctly.");

    console.log("⏳ 2. Building Historical TAT from Oct 2025 to Mar 2026...");
    console.log("   (This takes a few minutes, please wait... DO NOT CLOSE)");

    const startTime = Date.now();
    await client.query(`SET statement_timeout = 0;`);
    await client.query(`SELECT build_historical_tat('2025-10-01', '2026-03-31');`);
    const endTime = Date.now();

    console.log(`✅ Success! Historical data completely rebuilt in ${((endTime - startTime) / 1000).toFixed(1)} seconds.`);

  } catch (error) {
    if (error.message.includes('password authentication failed')) {
      console.error("❌ Invalid Password. Make sure the password inside your pasted URL is correct.");
    } else {
      console.error("❌ SQL Error encountered:", error.message);
    }
  } finally {
    await client.end();
    console.log("👋 Disconnected.");
    rl.close();
  }
}

console.log("");
console.log("To bypass all the connection issues, we need the EXACT connection pooler string from your dashboard.");
console.log("1. Go to Supabase Dashboard > Settings > Database");
console.log("2. Under 'Connection string', choose the NodeJS tab and 'Transaction pooler' dropdown.");
console.log("3. Copy that exact string (replace [YOUR-PASSWORD] with your actual password inside the URL itself!)");
console.log("");
rl.question('📋 Paste your full PostgreSQL URL here: ', (answer) => {
  rebuildTAT(answer);
});
