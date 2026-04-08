-- Table for storing fine-tuning data
CREATE TABLE IF NOT EXISTS ai_training_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_question TEXT NOT NULL,
    generated_sql TEXT NOT NULL,
    explanation TEXT,
    is_verified BOOLEAN DEFAULT FALSE, -- TRUE = Thumbs Up
    feedback_notes TEXT, -- Optional user correction or "Bad SQL" note
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster export
CREATE INDEX IF NOT EXISTS idx_ai_training_verified ON ai_training_examples(is_verified);

-- RLS (Optional, but good practice if exposed)
ALTER TABLE ai_training_examples ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (or service role) to insert
CREATE POLICY "Allow insert for authenticated" ON ai_training_examples
    FOR INSERT WITH CHECK (true);

-- Allow service role full access
CREATE POLICY "Allow full access for service role" ON ai_training_examples
    USING (auth.role() = 'service_role');
