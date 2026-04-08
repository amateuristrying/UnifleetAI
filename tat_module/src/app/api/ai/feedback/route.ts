
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { question, sql, explanation, isVerified, feedback } = body;

        if (!question || !sql) {
            return NextResponse.json({ error: 'Question and SQL are required' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('ai_training_examples')
            .insert([
                {
                    user_question: question,
                    generated_sql: sql,
                    explanation: explanation,
                    is_verified: isVerified,
                    feedback_notes: feedback
                }
            ])
            .select();

        if (error) {
            throw error;
        }

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Feedback API Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
