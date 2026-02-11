import { GoogleGenAI } from '@google/genai';

export async function generateGeminiResponse(userPrompt: string, fleetContext: string): Promise<string> {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("Missing Gemini API Key in environment variables.");
    }

    const ai = new GoogleGenAI({
        apiKey: apiKey,
    });

    const tools = [
        {
            googleSearch: {}
        },
    ];

    const config = {
        thinkingConfig: {
            thinkingBudget: 0,
        },
        tools,
    };

    const model = 'gemini-2.5-flash-lite';

    const contents = [
        {
            role: 'user',
            parts: [
                {
                    text: `
You are a Fleet Management Assistant for 'Unifleet'.
CONTEXT:
${fleetContext}

User Query: ${userPrompt}
                    `,
                },
            ],
        },
    ];

    try {
        const response = await ai.models.generateContentStream({
            model: model,
            config,
            contents,
        });

        let fullText = "";
        for await (const chunk of response) {
            fullText += chunk.text;
        }
        return fullText;

    } catch (error) {
        console.error("Gemini SDK Error:", error);
        throw error;
    }
}
