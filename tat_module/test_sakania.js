async function run() {
  require('dotenv').config({ path: '.env.local' });
  const hash = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
  const res = await fetch(`https://api.navixy.com/v2/zone/list?hash=${hash}&with_points=true`);
  const data = await res.json();
  if(data.success && data.list) {
    const sakania = data.list.filter(z => z.label && z.label.toLowerCase().includes('sakania'));
    console.log("Sakania Zones:", JSON.stringify(sakania, null, 2));
    
    // Check if any zone matches exact name "SAKANIA ZMB SIDE"
    const exact = data.list.find(z => z.label === 'SAKANIA ZMB SIDE');
    console.log("Exact Match:", exact ? "Yes" : "No");
  }
}
run();
