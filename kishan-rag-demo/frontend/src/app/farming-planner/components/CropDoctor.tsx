"use client";
// components/CropDoctor.tsx
// Chat-style symptom input + structured diagnosis card from the Doctor Agent.

import { useState, useRef } from "react";
import { useFarmer } from "../context/FarmerContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface RagSource {
  document:         string;
  chunk_id:         string;
  relevance_score:  number;
  preview:          string;
}

interface Diagnosis {
  disease:      string;
  cause:        string;
  treatment:    string[];
  product:      string;
  prevention:   string;
  context_used: boolean;
  rag_sources:  RagSource[];
  sources:      Record<string, string>;
}

export default function CropDoctor() {
  const { session } = useFarmer();
  const [symptom,   setSymptom]   = useState("");
  const [crop,      setCrop]      = useState(session.selected_crop || "");
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [showSrc,   setShowSrc]   = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!symptom.trim()) return;
    setLoading(true); setError(""); setDiagnosis(null);
    try {
      const res = await fetch(`${API_URL}/api/planner/doctor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symptom,
          crop:     crop || session.selected_crop,
          district: session.district,
          state:    session.state,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      setDiagnosis(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Diagnosis failed");
    } finally { setLoading(false); }
  }

  const EXAMPLES = [
    "Leaves turning yellow with black spots",
    "White powder on leaves",
    "Wilting despite good watering",
    "Small holes in leaves, growing worse",
  ];

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">🌿 Crop Doctor</h2>
        <p className="text-sm text-slate-500">Describe your crop's symptoms and get an AI diagnosis.</p>
      </div>

      {/* Example prompts */}
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            onClick={() => setSymptom(ex)}
            className="text-xs px-3 py-1.5 rounded-full border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          value={crop}
          onChange={e => setCrop(e.target.value)}
          placeholder="Crop name (optional, e.g. Wheat)"
          className="h-10 px-3 rounded-xl border border-green-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-green-600 placeholder:text-slate-400"
        />
        <textarea
          ref={textRef}
          value={symptom}
          onChange={e => setSymptom(e.target.value)}
          placeholder="Describe symptoms in detail, e.g. 'The leaves are turning yellow with brown spots starting from the tips, and the plant looks wilted even though I watered yesterday.'"
          rows={3}
          className="px-3 py-2 rounded-xl border border-green-200 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-green-600 placeholder:text-slate-400"
          required
        />
        <button
          type="submit"
          disabled={loading || !symptom.trim()}
          className="h-10 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {loading
            ? <><span className="animate-spin material-symbols-outlined text-sm">progress_activity</span> Diagnosing...</>
            : <><span className="material-symbols-outlined text-sm">search</span> Diagnose</>}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Diagnosis card */}
      {diagnosis && (
        <div className="flex flex-col gap-3 bg-white border border-green-100 rounded-2xl p-5 shadow-sm">
          {/* Disease name */}
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-green-700 text-base">🔬 {diagnosis.disease || "Unknown"}</h3>
            {diagnosis.context_used && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                ICAR Knowledge Base Used
              </span>
            )}
          </div>

          {/* Cause */}
          {diagnosis.cause && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Cause</p>
              <p className="text-sm text-slate-700">{diagnosis.cause}</p>
            </div>
          )}

          {/* Treatment */}
          {diagnosis.treatment.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Treatment Steps</p>
              <ol className="flex flex-col gap-1.5">
                {diagnosis.treatment.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="w-5 h-5 bg-green-700 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Product */}
          {diagnosis.product && (
            <div className="flex gap-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-green-700 text-sm">science</span>
              <div>
                <p className="text-xs font-semibold text-slate-500">Recommended Product</p>
                <p className="text-sm text-slate-700">{diagnosis.product}</p>
              </div>
            </div>
          )}

          {/* Prevention */}
          {diagnosis.prevention && (
            <div className="flex gap-2 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-yellow-700 text-sm">lightbulb</span>
              <div>
                <p className="text-xs font-semibold text-slate-500">Prevention Tip</p>
                <p className="text-sm text-slate-700">{diagnosis.prevention}</p>
              </div>
            </div>
          )}

          {/* RAG sources */}
          {diagnosis.rag_sources && diagnosis.rag_sources.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Knowledge Base Matches</p>
              {diagnosis.rag_sources.map((src, i) => (
                <div key={i} className="mb-2 p-2 bg-slate-50 border border-slate-100 rounded-lg">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[70%]">{src.document}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                      src.relevance_score > 0.7 ? "bg-green-100 text-green-700" :
                      src.relevance_score > 0.5 ? "bg-yellow-100 text-yellow-700" :
                      "bg-slate-100 text-slate-500"
                    }`}>{(src.relevance_score * 100).toFixed(0)}% match</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{src.preview}</p>
                </div>
              ))}
            </div>
          )}
          {diagnosis.context_used && (!diagnosis.rag_sources || diagnosis.rag_sources.length === 0) && (
            <p className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">RAG knowledge base context was used in this diagnosis.</p>
          )}

          {/* Sources */}
          {diagnosis.sources && (
            <div>
              <button
                onClick={() => setShowSrc(s => !s)}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:underline"
              >
                <span className="material-symbols-outlined text-sm">{showSrc ? "expand_less" : "expand_more"}</span>
                {showSrc ? "Hide" : "Show"} AI & Data Sources
              </button>
              {showSrc && (
                <div className="mt-2 flex flex-col gap-1">
                  {Object.entries(diagnosis.sources).map(([k, v]) => (
                    <p key={k} className="text-xs text-slate-500">
                      <span className="font-semibold capitalize">{k.replace(/_/g," ")}:</span> {v}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
