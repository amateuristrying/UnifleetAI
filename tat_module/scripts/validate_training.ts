
import * as dotenv from 'dotenv';
import * as path from 'path';

// 1. Load env BEFORE importing anything else
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function main() {
    // 2. Dynamic import
    const { AIService } = await import('../src/services/ai');

    console.log('Validating Advanced Training...');

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY missing');
        return;
    }

    const scenarios = [
        {
            name: "Risk Zones (Geospatial)",
            question: "Show me stops in high risk theft zones."
        },
        {
            name: "Vehicle Model (fussy match)",
            question: "List all Scania trucks with unauthorized stops."
        },
        {
            name: "Corridors (Business Logic)",
            question: "How many times were night corridors used?"
        }
    ];

    for (const scenario of scenarios) {
        console.log(`\n--- Test: ${scenario.name} ---`);
        console.log(`Q: "${scenario.question}"`);
        try {
            const result = await AIService.generateAnswer([{ role: 'user', content: scenario.question }]);
            console.log('SQL:', result.sql);
            console.log('Explanation:', result.explanation);
        } catch (err: any) {
            console.error('FAILED:', err.message);
        }
    }
}

main();
export { };
