
import { NextResponse } from 'next/server';
import { AIService } from '@/services/ai';

export const runtime = 'edge'; // Optional: Use edge runtime if compatible with OpenAI SDK (usually is)
// Actually, 'openai' SDK might prefer nodejs runtime for full features, let's stick to default (nodejs) to be safe with Supabase client too.
// Unsetting runtime.

export async function POST(request: Request) {
    try {
        const body = await request.json();
        let { messages, message } = body;

        // Support both single message (legacy/simple) and full history
        if (message && !messages) {
            messages = [{ role: 'user', content: message }];
        }

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
        }

        const result = await AIService.generateAnswer(messages);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('AI Chat Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
