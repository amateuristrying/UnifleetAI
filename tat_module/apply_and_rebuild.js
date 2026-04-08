const { Client } = require('pg');
const fs = require('fs');

async function applyAndRebuild() {
  // Use port 5432 (session mode) instead of 6543 (transaction mode)
  // Transaction pooler drops connections during long-running queries
  const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,
    query_timeout: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  try {
    await client.connect();
    console.log("✅ Connected securely to Supabase Pooler.");

    // Forward PostgreSQL RAISE NOTICE to console (for step-by-step timing)
    client.on('notice', (msg) => console.log(`      🔔 ${msg.message}`));

    // Disable timeouts upfront + kill orphaned queries from aborted runs
    await client.query(`SET statement_timeout = 0;`);
    await client.query(`SET idle_in_transaction_session_timeout = 0;`);
    const orphans = await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE pid != pg_backend_pid()
        AND state = 'active'
        AND (query LIKE '%process_tat_chunk%' OR query LIKE '%build_historical%')
    `);
    if (orphans.rowCount > 0) {
      console.log(`🧹 Killed ${orphans.rowCount} orphaned query(s) from previous run.`);
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log("📜 1. Applying updated Beira GF SQL logic to database engine...");
    const sql = fs.readFileSync('./supabase/migrations/tat_optimization_incremental.sql', 'utf8');
    await client.query(sql);
    console.log("✅ New Logic Applied successfully.");

    console.log("🧹 2. Truncating old TAT data...");
    await client.query('TRUNCATE TABLE tat_trips_data;');
    console.log("✅ Wiped correctly.");

    console.log("⏳ 3. Re-running 6-month historical calculations...");
    const startTime = Date.now();
    const buildStart = new Date('2025-10-01');
    const buildEnd = new Date('2026-03-31');
    let chunkStart = new Date(buildStart);
    let monthNum = 0;
    const totalMonths = Math.ceil((buildEnd - buildStart) / (30.44 * 24 * 3600 * 1000));

    while (chunkStart < buildEnd) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + 30 * 24 * 3600 * 1000, buildEnd.getTime()));
      // Add 1 day buffer to avoid month-boundary edge cases
      const chunkEndAdj = new Date(Math.min(chunkEnd.getTime() + 1 * 24 * 3600 * 1000, buildEnd.getTime()));
      monthNum++;
      const label = chunkStart.toISOString().slice(0, 10);
      const labelEnd = chunkEndAdj.toISOString().slice(0, 10);
      const chunkTime = Date.now();
      process.stdout.write(`   📅 [${monthNum}/${totalMonths}] ${label} → ${labelEnd} ... `);
      await client.query(`SELECT process_tat_chunk($1::timestamptz, $2::timestamptz)`, [chunkStart.toISOString(), chunkEndAdj.toISOString()]);
      const elapsed = ((Date.now() - chunkTime) / 1000).toFixed(1);
      console.log(`✅ (${elapsed}s)`);
      chunkStart = chunkEnd;
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Success! Historical data rebuilt in ${totalElapsed} seconds.`);

  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}
applyAndRebuild();
