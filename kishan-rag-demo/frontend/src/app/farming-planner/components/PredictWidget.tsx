"use client";
// components/PredictWidget.tsx
// Yield and revenue prediction from the Predictive Analysis Agent.

import { useState } from "react";
import { useFarmer } from "../context/FarmerContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface PredictData {
  crop:                    string;
  land_size_acres:         number;
  land_size_ha:            number;
  predicted_yield_tons:    number;
  quintals:                number;
  estimated_revenue_inr:   number | null;
  gross_revenue_inr:       number | null;
  total_cost_inr:          number | null;
  net_profit_inr:          number | null;
  msp_per_quintal:         number | null;
  base_yield_t_ha:         number;
  soil_factor:             number;
  weather_factor:          number;
  risk_factors:            string[];
  confidence:              "High" | "Medium" | "Low";
  calculation_steps:       string[];
  cost_breakdown:          Record<string, number> | null;
  sources:                 Record<string, string>;
}

const CONF_COLOR: Record<string, string> = {
  High:   "text-green-700 bg-green-100",
  Medium: "text-yellow-700 bg-yellow-100",
  Low:    "text-red-600 bg-red-100",
};

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${n.toLocaleString("en-IN")}` : "N/A";

export default function PredictWidget() {
  const { session } = useFarmer();
  const [data,    setData]    = useState<PredictData | null>(null);
  const [showSteps,  setShowSteps]  = useState(false);
  const [showSrc,    setShowSrc]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [crop,    setCrop]    = useState(session.selected_crop || "Wheat");

  async function fetchPrediction() {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/planner/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: session.state, district: session.district,
          crop, land_size: session.land_size,
          soil_type: session.soil_type,
          lat: session.lat, lon: session.lon,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">🔮 Yield Prediction</h2>
        <p className="text-sm text-slate-500">Estimated harvest and revenue based on your farm profile.</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={crop}
          onChange={e => setCrop(e.target.value)}
          placeholder="e.g. Wheat"
          className="flex-1 h-10 px-3 rounded-xl border border-green-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-green-600"
        />
        <button
          onClick={fetchPrediction}
          disabled={loading}
          className="h-10 px-4 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
        >
          {loading
            ? <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
            : <span className="material-symbols-outlined text-sm">insights</span>}
          Predict
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {data && (
        <>
          {/* Confidence badge */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${CONF_COLOR[data.confidence]}`}>
              {data.confidence} Confidence
            </span>
            <span className="text-xs text-slate-500">
              {data.land_size_acres} acres · {session.soil_type} soil
            </span>
          </div>

          {/* Hero numbers — yield + revenue trio */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-green-50 border border-green-200 rounded-2xl p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Predicted Yield</p>
              <p className="text-2xl font-bold text-green-700">{data.predicted_yield_tons}</p>
              <p className="text-xs text-slate-500">{data.quintals} quintals</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-2xl p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Gross Revenue</p>
              <p className="text-2xl font-bold text-green-700">
                {data.gross_revenue_inr ? `₹${(data.gross_revenue_inr/1000).toFixed(0)}K` : "N/A"}
              </p>
              <p className="text-xs text-slate-500">{data.msp_per_quintal ? `MSP ₹${data.msp_per_quintal}/q` : ""}</p>
            </div>
            <div className={`border rounded-2xl p-3 text-center ${
              data.net_profit_inr != null && data.net_profit_inr >= 0
                ? "bg-emerald-50 border-emerald-200"
                : "bg-red-50 border-red-200"
            }`}>
              <p className="text-xs text-slate-500 mb-1">Net Profit</p>
              <p className={`text-2xl font-bold ${
                data.net_profit_inr != null && data.net_profit_inr >= 0 ? "text-emerald-700" : "text-red-600"
              }`}>
                {data.net_profit_inr != null ? `₹${(data.net_profit_inr/1000).toFixed(0)}K` : "N/A"}
              </p>
              <p className="text-xs text-slate-500">after all costs</p>
            </div>
          </div>

          {/* Factors breakdown */}
          <div className="bg-white border border-green-100 rounded-xl p-4 flex flex-col gap-2">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Calculation Factors</p>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-slate-500">Base Yield</p>
                <p className="font-bold text-slate-700">{data.base_yield_t_ha} t/ha</p>
              </div>
              <div>
                <p className="text-slate-500">Soil Factor</p>
                <p className={`font-bold ${data.soil_factor >= 1 ? "text-green-700" : "text-yellow-700"}`}>
                  ×{data.soil_factor}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Weather Factor</p>
                <p className={`font-bold ${data.weather_factor >= 1 ? "text-green-700" : "text-red-600"}`}>
                  ×{data.weather_factor}
                </p>
              </div>
            </div>
          </div>

          {/* Cost breakdown table */}
          {data.cost_breakdown && (
            <div>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Cost Breakdown</p>
              <div className="rounded-xl border border-green-100 overflow-hidden">
                {Object.entries(data.cost_breakdown)
                  .filter(([k]) => k !== "total")
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center px-3 py-2 text-xs border-b border-green-50 last:border-0">
                      <span className="capitalize text-slate-600">{k}</span>
                      <span className="font-semibold text-slate-700">{fmt(v)}</span>
                    </div>
                  ))}
                <div className="flex justify-between items-center px-3 py-2 text-xs bg-slate-50 font-bold">
                  <span className="text-slate-700">Total Cost</span>
                  <span className="text-red-600">{fmt(data.total_cost_inr)}</span>
                </div>
                <div className="flex justify-between items-center px-3 py-2 text-xs bg-emerald-50 font-bold">
                  <span className="text-slate-700">Net Profit</span>
                  <span className={data.net_profit_inr != null && data.net_profit_inr >= 0 ? "text-emerald-700" : "text-red-600"}>
                    {fmt(data.net_profit_inr)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1">Source: CACP / ICAR 2024-25 cost-of-cultivation estimates</p>
            </div>
          )}

          {/* Risk factors */}
          <div>
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Risk Factors</p>
            {data.risk_factors.map((r, i) => (
              <div key={i} className="flex gap-2 text-xs text-slate-600 py-1 border-b border-green-50 last:border-0">
                <span className="material-symbols-outlined text-sm text-yellow-600">warning</span>
                {r}
              </div>
            ))}
          </div>

          {/* Calculation steps */}
          <div>
            <button
              onClick={() => setShowSteps(s => !s)}
              className="flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
            >
              <span className="material-symbols-outlined text-sm">{showSteps ? "expand_less" : "expand_more"}</span>
              {showSteps ? "Hide" : "Show"} Calculation Steps
            </button>
            {showSteps && (
              <ol className="mt-2 flex flex-col gap-1">
                {data.calculation_steps.map((s, i) => (
                  <li key={i} className="text-xs text-slate-600 leading-relaxed flex gap-2">
                    <span className="w-4 h-4 flex-shrink-0 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-bold text-[10px]">{i+1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Data sources */}
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
                  <p key={k} className="text-xs text-slate-500"><span className="font-semibold capitalize">{k.replace(/_/g," ")}:</span> {v}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
