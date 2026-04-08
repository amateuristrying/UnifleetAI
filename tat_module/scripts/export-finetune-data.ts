
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// 1. Load env
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// The System Prompt used in production (Simplified for training if needed, but usually we keep it)
// Ideally, for fine-tuning, we might want a SHORTER system prompt, but let's start with the full one 
// or a slightly reduced version to save tokens. 
// For now, I will include a placeholder that should match what we want the model to learn.
const SYSTEM_PROMPT_TEMPLATE = `
You are an intelligent data analyst for Unifleet.
Your goal is to answer user questions by querying the PostgreSQL database.
Return a JSON object with: "sql" and "explanation".
`;

async function main() {
    console.log('Fetching verified training examples...');

    const { data: examples, error } = await supabase
        .from('ai_training_examples')
        .select('*')
        .eq('is_verified', true);

    if (error) {
        console.error('Error fetching data:', error.message);
        return;
    }

    if (!examples || examples.length === 0) {
        console.warn('No verified examples found. Have you clicked "Thumbs Up" on any chat messages?');
        return;
    }

    console.log(`Found ${examples.length} verified examples. Generating JSONL...`);

    const jsonlLines = examples.map(ex => {
        // Construct the expected AI response JSON
        const aiResponse = JSON.stringify({
            sql: ex.generated_sql,
            explanation: ex.explanation
        });

        // OpenAI Chat Format
        const chatObject = {
            messages: [
                { role: "system", content: SYSTEM_PROMPT_TEMPLATE.trim() },
                { role: "user", content: ex.user_question },
                { role: "assistant", content: aiResponse }
            ]
        };

        return JSON.stringify(chatObject);
    });

    const outputPath = path.resolve(__dirname, '..', 'finetune_dataset.jsonl');
    fs.writeFileSync(outputPath, jsonlLines.join('\n'));

    console.log(`Successfully exported to: ${outputPath}`);
    console.log('You can now upload this file to OpenAI for fine-tuning.');
}

main();
