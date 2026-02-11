import { useState, useRef, useEffect } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Send, Bot, User, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VEHICLES } from "@/data/mock";

// Interface for chat messages
interface Message {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: Date;
}

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export function FleetAI() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'model',
            text: "Welcome to Unifleet AI Command. I am ready to assist with fleet operations, vehicle tracking, and logistics. How can I help you today?",
            timestamp: new Date()
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const [fleetContextData, setFleetContextData] = useState<string>('');

    useEffect(() => {
        const loadFleetData = async () => {
            try {
                const { getAllVehicles } = await import("@/services/database");
                const vehicles = await getAllVehicles();

                if (vehicles.length > 0) {
                    const context = vehicles.map(v =>
                        `ID:${v.source_id}|Name:${v.label}|Status:${v.state?.movement || 'Unknown'}|Speed:${v.state?.speed || 0}km/h|Bat:${v.state?.battery || 0}%|Loc:${v.state?.lat},${v.state?.lng}|LastUpd:${v.state?.last_updated || 'N/A'}`
                    ).join('\n');
                    setFleetContextData(context);
                } else {
                    // Fallback to mock if DB is empty (e.g. first load)
                    const mockContext = VEHICLES.map(v =>
                        `ID:${v.id}|Name:${v.name}|Status:${v.status}|Driver:${v.driver}|Speed:${v.speed}km/h|Loc:${v.address || 'Unknown'}`
                    ).join('\n');
                    setFleetContextData(mockContext);
                }
            } catch (error) {
                console.error("Failed to load fleet data for AI:", error);
            }
        };
        loadFleetData();
    }, []);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;

        const userMessageText = inputValue.trim();
        const newUserMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            text: userMessageText,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, newUserMessage]);
        setInputValue('');
        setIsLoading(true);
        setError(null);

        try {
            if (!API_KEY) {
                throw new Error("API Key not found. Please configure VITE_GEMINI_API_KEY in your environment.");
            }

            const SYSTEM_INSTRUCTION = `
You are a helpful and intelligent Fleet Management Assistant for Unifleet.
Your goal is to assist users in understanding their fleet's status, logistics, and operations using the provided data.

Guidelines:
- You have access to real-time fleet data (summary below). Use it to answer questions accurately.
- You can answer follow-up questions (e.g., "Which ones?", "How many are stopped?").
- If the user asks something slightly off-topic but related (e.g., "What is the best route?"), try to provide a general helpful answer or relate it back to the fleet context.
- Only refuse queries that are completely unrelated (e.g., "Write a poem", "Politics", "General Math homework").
- Be concise and professional.
- Current Time: ${new Date().toLocaleString()}

Real-time Fleet Data:
${fleetContextData}
            `;

            const genAI = new GoogleGenerativeAI(API_KEY);
            // Using the model user requested/implied or the reliable lite version
            const model = genAI.getGenerativeModel({
                model: "gemini-flash-lite-latest", // Using specific preview model as requested/safest
                systemInstruction: SYSTEM_INSTRUCTION,
                generationConfig: {
                    temperature: 0.1,
                }
            });

            const chat = model.startChat({
                history: messages.filter(m => m.id !== 'welcome').map(m => ({
                    role: m.role,
                    parts: [{ text: m.text }]
                })),
            });

            const result = await chat.sendMessage(userMessageText);
            const responseText = result.response.text();

            const newAiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: responseText,
                timestamp: new Date()
            };

            setMessages(prev => [...prev, newAiMessage]);
        } catch (err: any) {
            console.error("AI Error:", err);
            setError(err.message || "Failed to generate response. Please try again.");

            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: "I apologize, but I encountered an error processing your request.",
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="flex flex-1 flex-col overflow-hidden h-full">
            <main className="flex-1 overflow-hidden p-6 flex justify-center items-center">
                <div className="w-full max-w-4xl flex flex-col bg-surface-card rounded-[24px] shadow-sm border border-border overflow-hidden h-[85vh]">
                    {/* Chat Header */}
                    <div className="p-4 border-b border-border bg-muted/50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-white shadow-md">
                                <Sparkles className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="font-bold text-foreground">Unifleet AI Agent</h2>
                            </div>
                        </div>
                    </div>

                    {/* Chat Area */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-opacity-5">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                            >
                                {/* Avatar */}
                                <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${message.role === 'user'
                                    ? 'bg-foreground text-background'
                                    : 'bg-primary/10 text-primary'
                                    }`}>
                                    {message.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                </div>

                                {/* Bubble */}
                                <div className={`flex flex-col max-w-[80%] ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`px-5 py-3.5 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${message.role === 'user'
                                        ? 'bg-foreground text-background rounded-tr-sm'
                                        : 'bg-surface-card border border-border text-foreground rounded-tl-sm'
                                        }`}>
                                        {message.text}
                                    </div>
                                    <span className="text-[10px] text-muted-foreground mt-1 px-1">
                                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        ))}

                        {/* Loading State */}
                        {isLoading && (
                            <div className="flex gap-4">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <Bot className="h-4 w-4" />
                                </div>
                                <div className="bg-surface-card border border-border px-5 py-4 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                    <span className="text-xs text-muted-foreground">Analysing fleet data...</span>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-4 border-t border-border bg-surface-card">
                        {error && (
                            <div className="mb-2 flex items-center gap-2 text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">
                                <AlertTriangle className="h-3 w-3" />
                                {error}
                            </div>
                        )}
                        <div className="relative flex items-center gap-2">
                            <Input
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask about vehicle locations, status, or fleet insights..."
                                className="h-12 pl-4 pr-12 rounded-full border-border bg-muted focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:border-primary transition-all font-medium placeholder:text-muted-foreground text-foreground"
                                disabled={isLoading}
                            />
                            <Button
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim() || isLoading}
                                className="absolute right-1.5 top-1.5 h-9 w-9 rounded-full bg-primary hover:bg-primary/90 p-0 shadow-sm transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                            >
                                <Send className="h-4 w-4 text-white" />
                            </Button>
                        </div>
                        <div className="text-center mt-2">
                            <span className="text-[10px] text-muted-foreground">AI can make mistakes. Verify important fleet information.</span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
