
import * as dotenv from 'dotenv';
import * as path from 'path';

// 1. Load env BEFORE importing anything else
const envPath = path.resolve(__dirname, '..', '.env.local');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.warn('Dotenv error:', result.error);
}

console.log('Environment loaded.');
console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'FOUND' : 'MISSING');
console.log('OPENAI_KEY:', process.env.OPENAI_API_KEY ? 'FOUND' : 'MISSING');

async function main() {
    // 2. Dynamic import to respect env loading order
    const { AIService } = await import('../src/services/ai');

    console.log('Testing AI Service...');

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY missing from .env.local');
        return;
    }

    try {
        // The query that was failing
        const question = "Which vehicle has the most unauthorized stops?";
        console.log(`Question: "${question}"`);

        const result = await AIService.generateAnswer([{ role: 'user', content: question }]);

        console.log('\n--- Result ---');
        console.log('Explanation:', result.explanation);
        console.log('SQL:', result.sql); // This might still verify the 'clean' SQL if we changed the return, but checking the execution is key.
        console.log('Data Rows:', result.data.length);
        if (result.data.length > 0) {
            console.log('Sample Row:', result.data[0]);
        }

    } catch (err) {
        console.error('AI Service Test Failed:', err);
    }
}

main();
export { };
