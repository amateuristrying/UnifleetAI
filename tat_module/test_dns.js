const dns = require('dns');
dns.lookup('aws-0-eu-central-1.pooler.supabase.com', (err, address, family) => {
  console.log('Pooler IP:', address, err ? err.message : '');
});
dns.lookup('db.motfpmjtunyelvwsmyyp.supabase.co', (err, address, family) => {
  console.log('Direct IP:', address, err ? err.message : '');
});
