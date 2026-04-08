const fs = require('fs');

try {
    const raw = fs.readFileSync('trackers.json', 'utf8');
    const data = JSON.parse(raw);
    const list = data.list || [];

    const targetIds = [672054, 672052]; // One has dwell time, one has "Just now"

    // Also search by source.id in case of mismatch
    const found = list.filter(t =>
        targetIds.includes(t.id) ||
        (t.source && targetIds.includes(t.source.id))
    );

    console.log(JSON.stringify(found, null, 2));
} catch (e) {
    console.error(e);
}
