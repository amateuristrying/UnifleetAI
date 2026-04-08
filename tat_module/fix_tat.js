const fs = require('fs');

let sql = fs.readFileSync('supabase/migrations/tat_optimization.sql', 'utf8');

// 1. Fix the 3 days clipping window to 21 days
sql = sql.replace(/p_start_date - INTERVAL '3 days'/g, "p_start_date - INTERVAL '21 days'");

// 2. Fix the visit_chain merging by excluding background regions
sql = sql.replace(
    "WHERE m.geo_level NOT IN ('L3_DAR', 'L3_DAR_GATEWAY')",
    "WHERE m.geo_level NOT IN ('L3_DAR', 'L3_DAR_GATEWAY', 'L3_ORIGIN_REGION', 'L1_DRC_REGION')"
);

fs.writeFileSync('supabase/migrations/tat_optimization.sql', sql);
