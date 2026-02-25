"use client";

import React, { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

type Source = {
  text: string;
  doc_name?: string;
  doc_url?: string;
  chunk_index?: number;
};

type Message = {
  sender: string;
  text: string;
  sources?: Source[];
  timestamp?: string;
};

type ChatSession = {
  id: string;
  title: string;
  date: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export default function NewUIChat() {
  const router = useRouter();
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "bot",
      text: "Hello! Ask me anything about your documents. I can help you analyze soil reports, crop schedules, or market trends. Please upload a document to get started.",
      timestamp: "9:41 AM",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showSources, setShowSources] = useState<{ [key: number]: boolean }>(
    {},
  );

  // Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null,
  );

  // Sidebar state
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([
    {
      id: "1",
      title: "Soil Health Report Analysis",
      date: "Today",
    },
    {
      id: "2",
      title: "Kharif Crop Planning",
      date: "Yesterday",
    },
    {
      id: "3",
      title: "Pesticide Recommendation",
      date: "2 days ago",
    },
  ]);

  const supportedLanguages = [
    { code: "en", name: "English" },
    { code: "hi", name: "Hindi (हिन्दी)" },
    { code: "mr", name: "Marathi (मराठी)" },
  ];

  const getTimestamp = (): string => {
    return new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/wav")
          ? "audio/wav"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: mimeType });
        const extension = mimeType.includes("wav") ? ".wav" : ".webm";
        const audioFile = new File([audioBlob], `recording${extension}`, {
          type: mimeType,
        });
        await transcribeAudio(audioFile);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err: any) {
      console.error("Microphone error:", err);
      alert("Microphone access denied. Please allow microphone access.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await transcribeAudio(file);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  };

  const transcribeAudio = async (file: File) => {
    try {
      setIsTranscribing(true);
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("language", selectedLanguage);

      const res = await fetch(`${API_URL}/api/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Transcription failed");
      }

      const data = await res.json();
      if (data.success && data.text) {
        setInput(data.text);
      } else {
        throw new Error(data.error || "Transcription failed");
      }
    } catch (err: any) {
      console.error("Audio transcription error:", err);
      alert("Could not transcribe audio. Please try again.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending || isRecording || isTranscribing) return;

    setSending(true);
    const question = input.trim();
    const timestamp = getTimestamp();
    setInput("");

    setMessages((msgs) => [
      ...msgs,
      { sender: "user", text: question, timestamp },
    ]);

    const history = messages.slice(-6);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history,
          language: selectedLanguage,
        }),
      });

      if (!res.body) throw new Error("No response from server");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let botMsg = "";
      let sources: Source[] | undefined = undefined;
      let buffer = "";
      const botTimestamp = getTimestamp();

      setMessages((msgs) => [
        ...msgs,
        { sender: "bot", text: "", timestamp: botTimestamp },
      ]);

      const appendCharByChar = async (text: string) => {
        for (let i = 0; i < text.length; i++) {
          botMsg += text[i];
          setMessages((msgs) => {
            const updated = [...msgs];
            const lastBotIdx = updated.findLastIndex((m) => m.sender === "bot");
            if (lastBotIdx !== -1) {
              updated[lastBotIdx] = {
                ...updated[lastBotIdx],
                text: botMsg,
              };
            }
            return updated;
          });
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunk = value ? decoder.decode(value) : "";
        buffer += chunk;

        const marker = "[[SOURCES]]";
        const markerIdx = buffer.indexOf(marker);

        if (markerIdx !== -1) {
          const answerPart = buffer.slice(0, markerIdx);
          await appendCharByChar(answerPart);

          const sourcesJson = buffer.slice(markerIdx + marker.length);
          try {
            const parsed = JSON.parse(sourcesJson);
            sources = parsed.sources;
          } catch (e) {
            sources = undefined;
          }
          buffer = "";
          done = true;
        } else {
          await appendCharByChar(buffer);
          buffer = "";
        }
      }

      setMessages((msgs) => {
        const updated = [...msgs];
        const lastBotIdx = updated.findLastIndex((m) => m.sender === "bot");
        if (lastBotIdx !== -1) {
          updated[lastBotIdx] = {
            ...updated[lastBotIdx],
            text: botMsg,
            sources,
          };
        }
        return updated;
      });
    } catch (err: any) {
      console.error("Chat error:", err);
      setMessages((msgs) => [
        ...msgs,
        {
          sender: "bot",
          text: "Sorry, I couldn't process your request. Please try again.",
          timestamp: getTimestamp(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-white">
      {/* Sidebar */}
      <aside className="w-80 bg-green-50 border-r border-green-100 flex flex-col shrink-0">
        <div className="p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <button
              onClick={() => router.push("/new-ui")}
              className="size-10 bg-green-700 rounded-xl flex items-center justify-center text-white hover:bg-green-800 transition-colors"
            >
              <span className="material-symbols-outlined">eco</span>
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">
              AgriSolve
            </h1>
          </div>

          {/* Language Selection */}
          <div className="mb-10">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
              Preferred Language
            </h3>
            <div className="flex flex-col gap-2">
              {supportedLanguages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLanguage(lang.code)}
                  className={`flex items-center justify-between w-full px-4 py-3 rounded-xl font-medium transition-all shadow-sm ${
                    selectedLanguage === lang.code
                      ? "bg-white border border-green-700 text-slate-700"
                      : "bg-white/50 border border-transparent text-slate-600 hover:bg-white hover:border-green-200"
                  }`}
                >
                  <span>{lang.name}</span>
                  {selectedLanguage === lang.code && (
                    <span className="material-symbols-outlined text-green-700 text-sm">
                      check_circle
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Chat History */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
              Chat History
            </h3>
            <div className="space-y-1">
              {chatHistory.map((chat) => (
                <div
                  key={chat.id}
                  className="group flex items-center gap-3 p-3 rounded-xl hover:bg-white/60 cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-slate-400 text-lg">
                    chat_bubble
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate font-medium">
                      {chat.title}
                    </p>
                    <p className="text-xs text-slate-400">{chat.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* User Profile */}
        <div className="mt-auto p-6 border-t border-green-100 bg-white/40">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-slate-200 overflow-hidden flex-shrink-0">
              <img
                alt="User Profile"
                className="w-full h-full object-cover"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuADBdMDiAW5XHWcifwk5sVx0cApffMdfI2TtT8NUZeaGpYPgVde1t5CqpQBFKYRu5qEFapWYeTswsv80tV2CKSP-GYATUyWEzSYcvPhN7ZTOFzsc62xZOg-hRuNyqur9c0Mh2XZXhB6l12gGkD5hGm8aZVs-gm5rLJfM-pqbo7z-FFEdDXr5hV1VWGywzNnqRYSl5T2gZbO4ISgPfdAh9yEJnnLl29kKX10SG0t-tVcoG62BodVDpm979lWCas8fZy7FBoEu_T5C6RL"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800">Farmer John</p>
              <p className="text-xs text-slate-500">Premium Account</p>
            </div>
            <button className="text-slate-400 hover:text-slate-600">
              <span className="material-symbols-outlined">settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative bg-slate-50">
        {/* Header */}
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-2">
            <span className="size-2 bg-green-700 rounded-full animate-pulse"></span>
            <h2 className="font-semibold text-slate-800">Document Assistant</h2>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-slate-500 hover:text-slate-700 flex items-center gap-2 text-sm font-medium transition-colors">
              <span className="material-symbols-outlined text-xl">share</span>
              Share
            </button>
            <div className="h-6 w-px bg-slate-200"></div>
            <button className="text-slate-500 hover:text-slate-700 transition-colors">
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
          </div>
        </header>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="max-w-5xl mx-auto space-y-8">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-4 ${msg.sender === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`size-10 rounded-xl flex items-center justify-center text-white shrink-0 mt-1 shadow-md ${
                    msg.sender === "user" ? "bg-slate-800" : "bg-green-700"
                  }`}
                >
                  <span className="material-symbols-outlined">
                    {msg.sender === "user" ? "person" : "smart_toy"}
                  </span>
                </div>
                <div
                  className={`space-y-1 max-w-3xl ${msg.sender === "user" ? "text-right" : ""}`}
                >
                  <div
                    className={`p-6 rounded-2xl ${
                      msg.sender === "user"
                        ? "bg-green-700 text-white rounded-tr-none shadow-md"
                        : "bg-white border border-slate-200 rounded-tl-none shadow-sm"
                    }`}
                  >
                    {msg.sender === "user" ? (
                      <p className="leading-relaxed text-[15px] font-medium">
                        {msg.text}
                      </p>
                    ) : (
                      <div className="prose prose-sm max-w-none prose-headings:text-slate-900 prose-p:text-slate-800 prose-a:text-green-700 prose-strong:text-green-700 prose-ul:text-slate-800 prose-ol:text-slate-800 prose-li:my-0.5 text-slate-800">
                        <ReactMarkdown>{msg.text || "..."}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {msg.timestamp && (
                    <p
                      className={`text-[11px] text-slate-400 ${msg.sender === "user" ? "mr-1" : "ml-1"}`}
                    >
                      {msg.timestamp}
                    </p>
                  )}

                  {/* Sources Display */}
                  {msg.sender === "bot" &&
                    msg.sources &&
                    msg.sources.length > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() =>
                            setShowSources((prev) => ({
                              ...prev,
                              [idx]: !prev[idx],
                            }))
                          }
                          className="text-xs font-medium text-green-700 hover:text-green-800 transition-colors flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">
                            {showSources[idx] ? "expand_less" : "expand_more"}
                          </span>
                          {showSources[idx] ? "Hide" : "View"} Sources (
                          {msg.sources.length})
                        </button>

                        {showSources[idx] && (
                          <div className="mt-2 space-y-2">
                            {msg.sources.map((source, sourceIdx) => (
                              <div
                                key={sourceIdx}
                                className="p-3 bg-green-50 border-l-4 border-green-500 rounded text-xs text-slate-700"
                              >
                                {source.doc_name && (
                                  <p className="font-semibold text-green-800 mb-1">
                                    📄 {source.doc_name}
                                  </p>
                                )}
                                <p className="line-clamp-3 text-slate-600 italic">
                                  "{source.text}"
                                </p>
                                {source.doc_url && (
                                  <a
                                    href={source.doc_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-green-700 hover:text-green-800 underline mt-1 inline-block"
                                  >
                                    View Document →
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-8 z-10">
          <div className="max-w-5xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-3xl shadow-xl p-3 flex items-center gap-3">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={sending || isTranscribing}
                className={`p-3 rounded-full transition-all ${
                  isRecording
                    ? "bg-red-100 text-red-600"
                    : "text-slate-400 hover:text-green-700 hover:bg-green-50"
                } disabled:opacity-50`}
              >
                <span className="material-symbols-outlined">
                  {isRecording ? "stop_circle" : "mic"}
                </span>
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSend(e as any)}
                disabled={sending || isRecording || isTranscribing}
                className="flex-1 bg-transparent border-none focus:ring-0 text-slate-800 placeholder-slate-400 text-lg py-2 outline-none disabled:opacity-50"
                placeholder="Ask your agricultural assistant..."
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg active:scale-95 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <span className="material-symbols-outlined animate-spin">
                    hourglass_bottom
                  </span>
                ) : (
                  <>
                    <span>Send</span>
                    <span className="material-symbols-outlined">send</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-center text-[12px] text-slate-400 mt-4">
              AgriSolve can provide general guidance. Always cross-verify with
              local agricultural experts for critical decisions.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

type Source = {
  text: string;
  doc_name?: string;
  doc_url?: string;
  chunk_index?: number;
};

type Message = {
  sender: string;
  text: string;
  sources?: Source[];
};

const MessageBubble = ({
  message,
  isUser,
}: {
  message: Message;
  isUser: boolean;
}) => (
  <div
    className={`px-4 py-3 rounded-lg transition-all duration-200 ${
      isUser
        ? "bg-gradient-to-br from-[#2bee3b] to-[#24c932] text-[#111812] shadow-md"
        : "bg-white dark:bg-[#152016] text-[#111812] dark:text-white border border-gray-200 dark:border-white/10 shadow-sm hover:shadow-md"
    }`}
    translate="no"
  >
    {isUser ? (
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        {message.text}
      </p>
    ) : (
      <div className="prose prose-sm max-w-none prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-a:text-[#2bee3b] prose-strong:text-gray-900 dark:prose-strong:text-white prose-ul:text-gray-800 dark:prose-ul:text-gray-200 prose-ol:text-gray-800 dark:prose-ol:text-gray-200 prose-headings:my-2 prose-p:my-2 prose-li:my-1">
        <ReactMarkdown>{message.text || "..."}</ReactMarkdown>
      </div>
    )}
  </div>
);

const SourcesCard = ({
  sources,
  isExpanded,
  onToggle,
}: {
  sources: Source[];
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 animate-in fade-in duration-200">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-[#2bee3b] hover:text-[#24c932] font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#2bee3b]/20 rounded-md px-2 py-1 hover:bg-[#2bee3b]/10"
      >
        {isExpanded ? "− Hide Sources" : "+ Show Sources"}
      </button>

      {isExpanded && (
        <div className="mt-2 p-4 bg-gradient-to-br from-gray-50 dark:from-[#0a120b] to-white dark:to-[#152016] rounded-lg border border-gray-200 dark:border-white/10 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#2bee3b] text-xl">
              description
            </span>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
              Retrieved Context
            </h4>
          </div>
          <div className="space-y-3">
            {sources.map((source: Source, idx: number) => (
              <div
                key={idx}
                className="text-sm text-gray-700 dark:text-gray-300 pl-3 border-l-2 border-[#2bee3b]/30 hover:border-[#2bee3b] transition-colors"
              >
                <p className="italic mb-2 text-gray-600 dark:text-gray-400 leading-relaxed">
                  "{source.text.substring(0, 200)}
                  {source.text.length > 200 ? "..." : ""}"
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  {source.doc_name && (
                    <span className="font-medium">{source.doc_name}</span>
                  )}
                  {source.doc_url && (
                    <>
                      <span>•</span>
                      <a
                        href={source.doc_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2bee3b] hover:text-[#24c932] underline transition-colors"
                      >
                        View Document
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
