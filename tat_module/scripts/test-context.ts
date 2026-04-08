
import * as dotenv from 'dotenv';
import * as path from 'path';

// 1. Load env BEFORE importing anything else
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function main() {
    // 2. Dynamic import
    const { AIService } = await import('../src/services/ai');

    console.log('Validating Context Awareness...');

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY missing');
        return;
    }

    // Simulate a conversation
    const history = [
        { role: 'user', content: 'Show me all Scania trucks.' },
        { role: 'assistant', content: 'Here are the Scania trucks found: T-123, T-456.' }
    ];

    const followUp = "Which of them had critical risk events?";

    console.log('\n--- Test: Contextual Follow-up ---');
    console.log('History:', JSON.stringify(history, null, 2));
    console.log('Follow-up Question:', followUp);

    try {
        // Pass full history + new question
        const fullConversation = [
            ...history,
            { role: 'user', content: followUp }
        ];

        const result = await AIService.generateAnswer(fullConversation);
        console.log('SQL:', result.sql);
        console.log('Explanation:', result.explanation);

        if (result.sql.includes('Scania')) {
            console.log('SUCCESS: AI used context to identify "them" as Scania trucks.');
        } else {
            console.log('WARNING: AI might have missed the context.');
        }

    } catch (err: any) {
        console.error('FAILED:', err.message);
    }
}

main();
