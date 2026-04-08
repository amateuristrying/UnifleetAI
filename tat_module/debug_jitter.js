
const sessionKey = '7ec319317abad720dd5be071c0512d98'; // From .env.local
const BASE_URL = 'https://api.navixy.com/v2';
// Using one of the active trackers mentioned in the screenshot or found in previous logs
const TRACKER_ID = 1624446;

async function fetchJson(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) { return null; }
}

async function run() {
    console.log(`Analyzing jitter for Tracker ${TRACKER_ID} (last 24h)...`);

    const hours = 24;
    const to = new Date();
    const from = new Date(to.getTime() - (hours * 60 * 60 * 1000));
    const fromStr = from.toISOString().replace('T', ' ').split('.')[0];
    const toStr = to.toISOString().replace('T', ' ').split('.')[0];
    const eventsFilter = encodeURIComponent(JSON.stringify(['inzone', 'outzone']));

    const url = `${BASE_URL}/history/tracker/list?tracker_id=${TRACKER_ID}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&events=${eventsFilter}&hash=${sessionKey}`;

    const data = await fetchJson(url);
    if (!data || !data.success || !data.list) {
        console.error("Failed to fetch events.");
        return;
    }

    const events = data.list;
    console.log(`Total Events: ${events.length}`);
    if (events.length === 0) return;

    // Sort by time ascending
    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    let flickerCount = 0;
    let maxDeltaSec = 0;
    let minDeltaSec = 999999;
    const durationBuckets = {
        '<10s': 0,
        '<1m': 0,
        '<5m': 0,
        '>5m': 0
    };

    console.log("\n--- Event Sequence Sample (First 20) ---");
    for (let i = 0; i < events.length; i++) {
        const curr = events[i];

        if (i < 20) {
            console.log(`[${curr.time}] ${curr.event} (Zone: ${curr.extra?.zone_labels?.[0]})`);
        }

        if (i > 0) {
            const prev = events[i - 1];
            // Check if it's the same zone and alternating types
            if (curr.extra?.zone_ids?.[0] === prev.extra?.zone_ids?.[0] && curr.event !== prev.event) {
                const diffMs = new Date(curr.time).getTime() - new Date(prev.time).getTime();
                const diffSec = diffMs / 1000;

                if (diffSec < 60) flickerCount++; // Arbitrary 1 min threshold for "flicker"

                if (diffSec < 10) durationBuckets['<10s']++;
                else if (diffSec < 60) durationBuckets['<1m']++;
                else if (diffSec < 300) durationBuckets['<5m']++;
                else durationBuckets['>5m']++;

                maxDeltaSec = Math.max(maxDeltaSec, diffSec);
                minDeltaSec = Math.min(minDeltaSec, diffSec);
            }
        }
    }

    console.log("\n--- Jitter Analysis ---");
    console.log(`Potential Flickers (<1min intervals): ${flickerCount} (${Math.round(flickerCount / events.length * 100)}% of events)`);
    console.log("Duration Distribution (Time between In/Out):", durationBuckets);
}

run();
