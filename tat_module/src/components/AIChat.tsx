
'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Database, Terminal, ThumbsUp, ThumbsDown, Check } from 'lucide-react';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    explanation?: string;
    data?: any[];
    sql?: string;
    feedbackStatus?: 'liked' | 'disliked';
}

interface ResearchCommand {
    repositoryUrl: string;
    objective?: string;
}

function parseResearchCommand(input: string): ResearchCommand | null {
    const match = input.trim().match(/^\/research\s+(\S+)(?:\s*\|\s*(.+))?$/i);
    if (!match) return null;

    const repositoryUrl = match[1].trim();
    if (!/^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(repositoryUrl)) {
        return null;
    }

    return {
        repositoryUrl,
        objective: match[2]?.trim() || undefined
    };
}

export function AIChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleFeedback = async (index: number, isLiked: boolean) => {
        const msg = messages[index];
        if (!msg || msg.role !== 'assistant' || msg.feedbackStatus) return;

        // Optimistic update
        const newMessages = [...messages];
        newMessages[index] = { ...msg, feedbackStatus: isLiked ? 'liked' : 'disliked' };
        setMessages(newMessages);

        // Find the user question (the message immediately before this one)
        const questionMsg = messages[index - 1];
        const userQuestion = questionMsg?.role === 'user' ? questionMsg.content : 'Unknown context';

        try {
            await fetch('/api/ai/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: userQuestion,
                    sql: msg.sql || '',
                    explanation: msg.explanation || msg.content,
                    isVerified: isLiked,
                    feedback: isLiked ? 'Positive user feedback' : 'User flagged as incorrect'
                })
            });
        } catch (err) {
            console.error('Failed to send feedback:', err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const userMsg = input.trim();
        const researchCommand = parseResearchCommand(userMsg);
        const isResearchIntent = /^\/research\b/i.test(userMsg);
        setInput('');

        // Optimistically update UI
        const newMessages = [...messages, { role: 'user', content: userMsg } as ChatMessage];
        setMessages(newMessages);
        setLoading(true);

        try {
            if (isResearchIntent && !researchCommand) {
                throw new Error('Usage: /research https://github.com/<owner>/<repo> | <objective>');
            }

            if (researchCommand) {
                const res = await fetch('/api/ai/autoresearch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        repositoryUrl: researchCommand.repositoryUrl,
                        objective: researchCommand.objective,
                        query: userMsg
                    })
                });

                const contentType = res.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error(`Server returned ${res.status} ${res.statusText}`);
                }

                const data = await res.json();
                if (data.error) throw new Error(data.error);

                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: data.explanation || 'AutoResearch model initialized.'
                }]);
                return;
            }

            // Prepare history for API (last 10 messages to keep context without hitting limits)
            const history = newMessages.slice(-10).map(m => ({
                role: m.role,
                content: m.content
            }));

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history })
            });

            // Handle non-JSON responses gracefully
            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`Server returned ${res.status} ${res.statusText}`);
            }

            const data = await res.json();

            if (data.error) throw new Error(data.error);

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.explanation || 'Here is the result:',
                explanation: data.explanation,
                data: data.data,
                sql: data.sql
            }]);
        } catch (err: any) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${err.message}`
            }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {/* Chat Window */}
            {isOpen && (
                <div className="mb-4 w-96 h-[32rem] bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-200">
                    {/* Header */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                            <div className="bg-blue-100 p-1 rounded-md dark:bg-blue-900/30">
                                <Database className="text-blue-600 dark:text-blue-400" size={16} />
                            </div>
                            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">Fleet Intelligence AI</h3>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/50">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 p-4 opacity-60">
                                <Database size={32} className="text-slate-300 dark:text-slate-600" />
                                <p className="text-sm text-slate-500 font-medium">Ask questions about your fleet data</p>
                                <div className="space-y-2 w-full">
                                    <button
                                        onClick={() => setInput("Show critical risk trips from last week")}
                                        className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                                    >
                                        "Show critical risk trips from last week"
                                    </button>
                                    <button
                                        onClick={() => setInput("Which vehicle has the most unauthorized stops?")}
                                        className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                                    >
                                        "Which vehicle has the most unauthorized stops?"
                                    </button>
                                    <button
                                        onClick={() => setInput("/research https://github.com/karpathy/autoresearch | integrate initial model into unifleet")}
                                        className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                                    >
                                        /research &lt;github-url&gt; | &lt;objective&gt;
                                    </button>
                                </div>
                            </div>
                        )}
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-full`}>
                                <div className={`relative px-3 py-2 text-sm rounded-2xl max-w-[90%] shadow-sm ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-br-none'
                                    : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none'
                                    }`}>
                                    <p className="whitespace-pre-wrap">{msg.role === 'assistant' && msg.explanation ? msg.explanation : msg.content}</p>
                                </div>

                                {msg.role === 'assistant' && (
                                    <div className="mt-2 w-full max-w-[90%] space-y-2">
                                        {msg.sql && (
                                            <details className="group">
                                                <summary className="flex items-center text-[10px] text-slate-400 cursor-pointer hover:text-blue-500 font-mono select-none">
                                                    <Terminal size={10} className="mr-1" />
                                                    View Generated SQL
                                                </summary>
                                                <div className="mt-1 relative">
                                                    <pre className="p-2 bg-slate-900 text-green-400 text-[10px] rounded border border-slate-700 overflow-x-auto font-mono leading-relaxed">
                                                        {msg.sql}
                                                    </pre>
                                                </div>
                                            </details>
                                        )}

                                        {msg.data && msg.data.length > 0 && (
                                            <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                                                <div className="overflow-x-auto max-w-full">
                                                    <table className="w-full text-xs text-left whitespace-nowrap">
                                                        <thead>
                                                            <tr className="bg-slate-50 dark:bg-slate-800 border-b dark:border-slate-700">
                                                                {Object.keys(msg.data[0]).map(k => (
                                                                    <th key={k} className="p-2 font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">{k.replace(/_/g, ' ')}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                            {msg.data.slice(0, 5).map((row: any, i: number) => (
                                                                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                                    {Object.values(row).map((v: any, j) => (
                                                                        <td key={j} className="p-2 text-slate-700 dark:text-slate-300 max-w-[150px] truncate" title={String(v)}>
                                                                            {v === null ? <span className="text-slate-300 italic">null</span> : String(v)}
                                                                        </td>
                                                                    ))}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                {msg.data.length > 5 && (
                                                    <div className="p-1.5 text-center text-[10px] text-slate-500 bg-slate-50 dark:bg-slate-800 border-t dark:border-slate-700 font-medium">
                                                        +{msg.data.length - 5} more results
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {msg.data && msg.data.length === 0 && (
                                            <div className="text-xs text-slate-500 italic px-1">
                                                No specific data rows found matching the query.
                                            </div>
                                        )}
                                        {/* Added feedback buttons */}
                                        <div className="flex items-center space-x-2 mt-2">
                                            <button
                                                onClick={() => handleFeedback(idx, true)}
                                                className="text-slate-400 hover:text-green-500 transition-colors"
                                                title="Good answer (Save for training)"
                                            >
                                                <ThumbsUp size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleFeedback(idx, false)}
                                                className="text-slate-400 hover:text-red-400 transition-colors"
                                                title="Bad answer"
                                            >
                                                <ThumbsDown size={12} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {loading && (
                            <div className="flex items-start">
                                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center space-x-2">
                                    <Loader2 className="animate-spin text-blue-500 h-4 w-4" />
                                    <span className="text-xs text-slate-500">Analyzing data...</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Ask AI..."
                                className="w-full pl-4 pr-12 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-400"
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="absolute right-1.5 top-1.5 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`h-14 w-14 rounded-full shadow-lg shadow-blue-900/20 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 ${isOpen
                    ? 'bg-slate-800 text-white rotate-90'
                    : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white hover:shadow-blue-500/30'
                    }`}
            >
                {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
            </button>
        </div>
    );
}
