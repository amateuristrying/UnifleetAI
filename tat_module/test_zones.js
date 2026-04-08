async function run() {
  require('dotenv').config({ path: '.env.local' });
  const hash = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
  const res = await fetch(`https://api.navixy.com/v2/zone/list?hash=${hash}&with_points=true`);
  const data = await res.json();
  if(data.success && data.list) {
    console.log("Found", data.list.length, "zones");
    const chirundu = data.list.find(z => z.label && z.label.toLowerCase().includes('chirundu'));
    console.log("Example:", JSON.stringify(chirundu, null, 2));
  } else {
    console.error(data);
  }
}
run();
