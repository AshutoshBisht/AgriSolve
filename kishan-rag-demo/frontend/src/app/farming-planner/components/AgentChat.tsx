"use client";
// components/AgentChat.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Autonomous Agent Chat Panel
// Sends a natural language query to POST /api/planner/agent (Agno + Gemini)
// and displays the agent's answer along with a tool trace (which APIs it called).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const EXAMPLE_QUERIES = [
    "What should I grow in Agra this Rabi season?",
    "What are current wheat prices in Uttar Pradesh?",
    "What soil type does Nashik, Maharashtra have?",
    "Is it a good time to sow cotton in Vidarbha?",
    "Give me a full farming plan for a 2-acre farm in Rajasthan.",
];

interface ToolCall {
    tool: string;
    arguments: Record<string, unknown>;
}

interface Message {
    role: "user" | "agent";
    content: string;
    toolTrace?: ToolCall[];
    loading?: boolean;
}

const TOOL_ICONS: Record<string, string> = {
    geocode_location: "my_location",
    get_weather_for_location: "cloud",
    get_soil_type: "layers",
    get_market_price: "trending_up",
    get_crop_recommendations: "grass",
};

const TOOL_LABELS: Record<string, string> = {
    geocode_location: "Geocode (OpenStreetMap)",
    get_weather_for_location: "Weather (Open-Meteo)",
    get_soil_type: "Soil (ISRIC SoilGrids)",
    get_market_price: "Market Price (Data.gov.in)",
    get_crop_recommendations: "Crop Recommendations",
};

export default function AgentChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [expandedTraces, setExpanded] = useState<Set<number>>(new Set());
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const toggleTrace = (idx: number) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return next;
        });
    };

    const send = async (query: string) => {
        if (!query.trim() || isLoading) return;
        setInput("");
        setIsLoading(true);

        const userMsg: Message = { role: "user", content: query };
        const loadingMsg: Message = { role: "agent", content: "", loading: true };
        setMessages(prev => [...prev, userMsg, loadingMsg]);

        try {
            const res = await fetch(`${API_BASE}/api/planner/agent`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Agent request failed");
            }

            const data = await res.json();
            const agentMsg: Message = {
                role: "agent",
                content: data.answer || "No response generated.",
                toolTrace: data.tool_trace || [],
            };
            setMessages(prev => [...prev.slice(0, -1), agentMsg]);
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : "Unknown error";
            setMessages(prev => [
                ...prev.slice(0, -1),
                { role: "agent", content: `❌ Error: ${errMsg}` },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">

            {/* Header */}
            <div className="px-4 py-3 border-b border-green-100 bg-gradient-to-r from-green-700 to-green-600">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-white text-lg">smart_toy</span>
                    <div>
                        <p className="text-sm font-semibold text-white">Autonomous AI Agent</p>
                        <p className="text-xs text-green-100">Powered by Agno + Gemini 2.0 Flash</p>
                    </div>
                </div>
                {/* Tool badges */}
                <div className="flex flex-wrap gap-1 mt-2">
                    {["🌍 Location", "🌤️ Weather", "🪨 Soil", "💰 Market", "🌾 Crops"].map(t => (
                        <span key={t} className="text-xs bg-green-800 text-green-100 px-2 py-0.5 rounded-full">
                            {t}
                        </span>
                    ))}
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

                {/* Welcome */}
                {messages.length === 0 && (
                    <div className="text-center py-6">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <span className="material-symbols-outlined text-green-700 text-2xl">agriculture</span>
                        </div>
                        <p className="text-sm font-medium text-slate-700 mb-1">Ask me anything about farming</p>
                        <p className="text-xs text-slate-400 mb-4">
                            I'll autonomously call real APIs — weather, soil, market prices — to give you accurate answers.
                        </p>
                        <div className="space-y-2">
                            {EXAMPLE_QUERIES.map(q => (
                                <button
                                    key={q}
                                    onClick={() => send(q)}
                                    className="block w-full text-left text-xs px-3 py-2 rounded-lg border border-green-100 text-slate-600 hover:bg-green-50 hover:border-green-200 transition-colors"
                                >
                                    💬 {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Chat messages */}
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[90%] ${msg.role === "user" ? "order-2" : ""}`}>

                            {/* Bubble */}
                            <div className={`rounded-xl px-4 py-2.5 text-sm ${msg.role === "user"
                                    ? "bg-green-700 text-white rounded-br-sm"
                                    : "bg-slate-50 border border-slate-100 text-slate-800 rounded-bl-sm"
                                }`}>
                                {msg.loading ? (
                                    <div className="flex items-center gap-2 text-slate-400">
                                        <div className="flex gap-1">
                                            {[0, 1, 2].map(j => (
                                                <div key={j} className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce"
                                                    style={{ animationDelay: `${j * 0.15}s` }} />
                                            ))}
                                        </div>
                                        <span className="text-xs">Agent is working...</span>
                                    </div>
                                ) : (
                                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                )}
                            </div>

                            {/* Tool trace */}
                            {msg.toolTrace && msg.toolTrace.length > 0 && (
                                <div className="mt-1.5">
                                    <button
                                        onClick={() => toggleTrace(i)}
                                        className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-xs">
                                            {expandedTraces.has(i) ? "expand_less" : "expand_more"}
                                        </span>
                                        {msg.toolTrace.length} tool{msg.toolTrace.length > 1 ? "s" : ""} called
                                    </button>

                                    {expandedTraces.has(i) && (
                                        <div className="mt-1 space-y-1">
                                            {msg.toolTrace.map((tc, j) => (
                                                <div key={j} className="flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
                                                    <span className="material-symbols-outlined text-green-600 text-sm mt-0.5">
                                                        {TOOL_ICONS[tc.tool] || "build"}
                                                    </span>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-medium text-slate-700">
                                                            {TOOL_LABELS[tc.tool] || tc.tool}
                                                        </p>
                                                        {Object.keys(tc.arguments || {}).length > 0 && (
                                                            <p className="text-xs text-slate-400 truncate">
                                                                {JSON.stringify(tc.arguments)}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-green-100 p-3">
                <div className="flex gap-2">
                    <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
                        placeholder="Ask about crops, weather, market prices..."
                        disabled={isLoading}
                        className="flex-1 text-sm px-3 py-2 rounded-lg border border-green-100 focus:outline-none focus:border-green-400 bg-slate-50 placeholder-slate-300 disabled:opacity-50"
                    />
                    <button
                        onClick={() => send(input)}
                        disabled={isLoading || !input.trim()}
                        className="p-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <span className="material-symbols-outlined text-sm">send</span>
                    </button>
                </div>
                <p className="text-xs text-slate-300 text-center mt-2">
                    Agent autonomously calls real APIs · Gemini decides tool order
                </p>
            </div>
        </div>
    );
}
