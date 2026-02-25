"use client";
// components/CropCards.tsx
// Top-3 crop recommendations from the Crop Selection Agent.

import { useState } from "react";
import { useFarmer } from "../context/FarmerContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface ScoringInputs {
  avg_temp_c:           number;
  est_monthly_rain_mm:  number;
  soil_type:            string;
  season_detected:      string;
}

interface CropResult {
  name: string;
  risk: "Low" | "Medium" | "High";
  score: number;
  water_req: string;
  yield_range: string;
  why: string;
}

const RISK_COLOR: Record<string, string> = {
  Low:    "bg-green-100 text-green-700",
  Medium: "bg-yellow-100 text-yellow-700",
  High:   "bg-red-100 text-red-600",
};

export default function CropCards() {
  const { session, updateSession } = useFarmer();
  const [data, setData] = useState<{
    season: string;
    top_crops: CropResult[];
    scoring_inputs?: ScoringInputs;
    sources?: Record<string, string>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [showSrc, setShowSrc] = useState(false);

  async function fetchCrops() {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/planner/crops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: session.state, district: session.district,
          soil_type: session.soil_type, land_size: session.land_size,
          lat: session.lat, lon: session.lon,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch crops");
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">🌾 Crop Recommendations</h2>
        <p className="text-sm text-slate-500">Based on your location, soil, and current season.</p>
      </div>

      <button
        onClick={fetchCrops}
        disabled={loading}
        className="h-10 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
      >
        {loading
          ? <><span className="animate-spin material-symbols-outlined text-sm">progress_activity</span> Analysing...</>
          : <><span className="material-symbols-outlined text-sm">search</span> Get Recommendations</>}
      </button>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {data && (
        <>
          <p className="text-sm font-semibold text-green-700 bg-green-50 px-3 py-2 rounded-lg">
            Current Season: <span className="font-bold">{data.season}</span>
          </p>

          {/* Scoring inputs badge */}
          {data.scoring_inputs && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full">
                🌡️ Avg temp: {data.scoring_inputs.avg_temp_c}°C
              </span>
              <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full">
                🌧️ Est. rain: {data.scoring_inputs.est_monthly_rain_mm} mm/mo
              </span>
              <span className="px-2 py-1 bg-green-50 text-green-700 rounded-full">
                🌱 Soil: {data.scoring_inputs.soil_type}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {data.top_crops.map((crop, i) => (
              <div
                key={crop.name}
                onClick={() => updateSession({ selected_crop: crop.name })}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  session.selected_crop === crop.name
                    ? "border-green-700 bg-green-50 shadow-md"
                    : "border-green-100 bg-white hover:border-green-300"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{["🥇","🥈","🥉"][i]}</span>
                    <p className="font-bold text-slate-800">{crop.name}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RISK_COLOR[crop.risk]}`}>
                    {crop.risk} Risk
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-slate-500 mb-2">
                  <span>💧 {crop.water_req}</span>
                  <span>📦 {crop.yield_range}</span>
                  <span>📊 {crop.score}/100</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{crop.why}</p>
                {session.selected_crop === crop.name && (
                  <p className="text-xs text-green-700 font-semibold mt-2">✅ Selected for Calendar, Market & Predictions</p>
                )}
              </div>
            ))}
          </div>

          {/* Sources */}
          {data.sources && (
            <div>
              <button
                onClick={() => setShowSrc(s => !s)}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:underline"
              >
                <span className="material-symbols-outlined text-sm">{showSrc ? "expand_less" : "expand_more"}</span>
                {showSrc ? "Hide" : "Show"} Data Sources
              </button>
              {showSrc && (
                <div className="mt-2 flex flex-col gap-1">
                  {Object.entries(data.sources).map(([k, v]) => (
                    <p key={k} className="text-xs text-slate-500">
                      <span className="font-semibold capitalize">{k.replace(/_/g," ")}:</span> {v}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
