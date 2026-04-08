
const dotenv = require('dotenv');
const path = require('path');

// Load environment
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const NAVIXY_SESSION_KEY = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
const NAVIXY_BASE = 'https://api.navixy.com/v2';

async function listTrackers() {
    console.log('Using Session Key:', NAVIXY_SESSION_KEY ? 'FOUND' : 'MISSING');

    if (!NAVIXY_SESSION_KEY || NAVIXY_SESSION_KEY === 'replace_with_your_session_key') {
        console.error('Session key is invalid.');
        return;
    }

    const url = `${NAVIXY_BASE}/tracker/list?hash=${NAVIXY_SESSION_KEY}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error('Fetch failed:', res.status, res.statusText);
            return;
        }
        const data = await res.json();
        if (data.success) {
            console.log(`Found ${data.list.length} trackers.`);
            console.log('--- First 3 Trackers (Raw Data) ---');
            data.list.slice(0, 3).forEach((t: any, idx: any) => {
                console.log(`\n[Tracker #${idx + 1}]`);
                console.log(JSON.stringify(t, null, 2));
            });
        } else {
            console.error('API Error:', data);
        }
    } catch (err) {
        console.error('Script error:', err);
    }
}

listTrackers();
export {};
