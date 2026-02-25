"use client";
// components/MarketAdvisor.tsx
// Live mandi prices + buy/sell/wait recommendation from the Market Agent.

import { useState } from "react";
import { useFarmer } from "../context/FarmerContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface PriceLogic {
  current_vs_30d_avg_pct:  number;
  sell_threshold:          string;
  store_threshold:         string;
  msp_floor:               string;
  current_vs_msp_pct:      number | null;
  records_analysed:        number;
  advice_reason:           string;
}

interface MarketData {
  crop: string;
  msp_per_quintal: number | null;
  current_price_per_quintal: number | null;
  avg_30d_price: number | null;
  trend: string;
  advice: string;
  data_source: string;
  nearest_mandis: { name: string; district: string; price_per_quintal: number }[];
  price_logic: PriceLogic | null;
  sources: Record<string, string>;
}

const TREND_COLOR: Record<string, string> = {
  Rising:  "text-green-700",
  Falling: "text-red-600",
  Stable:  "text-slate-600",
  Unknown: "text-slate-400",
};
const TREND_ICON: Record<string, string> = {
  Rising: "trending_up", Falling: "trending_down", Stable: "trending_flat", Unknown: "remove",
};

export default function MarketAdvisor() {
  const { session } = useFarmer();
  const [data,    setData]    = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [crop,    setCrop]    = useState(session.selected_crop || "Wheat");
  const [showLogic, setShowLogic] = useState(false);
  const [showSrc,   setShowSrc]   = useState(false);

  async function fetchMarket() {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/planner/market`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: session.state, district: session.district, crop }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Market data fetch failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">📈 Market Advisor</h2>
        <p className="text-sm text-slate-500">Live mandi prices and buying/selling guidance.</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={crop}
          onChange={e => setCrop(e.target.value)}
          placeholder="Crop name e.g. Wheat"
          className="flex-1 h-10 px-3 rounded-xl border border-green-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-green-600"
        />
        <button
          onClick={fetchMarket}
          disabled={loading}
          className="h-10 px-4 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
        >
          {loading
            ? <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
            : <span className="material-symbols-outlined text-sm">search</span>}
          Check
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {data && (
        <>
          {/* Advice card */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-bold text-slate-800 mb-1">{data.crop}</p>
            <p className="text-sm text-slate-700 leading-relaxed">{data.advice}</p>
            <p className="text-xs text-slate-400 mt-1">Source: {data.data_source}</p>
          </div>

          {/* Price grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-green-100 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-500">Current Price</p>
              <p className="text-lg font-bold text-slate-800">
                {data.current_price_per_quintal ? `₹${data.current_price_per_quintal}` : "N/A"}
              </p>
              <p className="text-xs text-slate-400">/quintal</p>
            </div>
            <div className="bg-white border border-green-100 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-500">30-Day Avg</p>
              <p className="text-lg font-bold text-slate-800">
                {data.avg_30d_price ? `₹${data.avg_30d_price}` : "N/A"}
              </p>
              <p className="text-xs text-slate-400">/quintal</p>
            </div>
            <div className="bg-white border border-green-100 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-500">Govt MSP</p>
              <p className="text-lg font-bold text-slate-800">
                {data.msp_per_quintal ? `₹${data.msp_per_quintal}` : "N/A"}
              </p>
              <p className="text-xs text-slate-400">/quintal</p>
            </div>
          </div>

          {/* Trend */}
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className={`material-symbols-outlined ${TREND_COLOR[data.trend]}`}>
              {TREND_ICON[data.trend]}
            </span>
            <span className={TREND_COLOR[data.trend]}>Market trend: {data.trend}</span>
          </div>

          {/* Nearest mandis */}
          {data.nearest_mandis.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Nearest Mandis</p>
              {data.nearest_mandis.map((m, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-green-50 last:border-0 text-sm">
                  <span className="text-slate-700">🏪 {m.name}, {m.district}</span>
                  <span className="font-semibold text-green-700">₹{m.price_per_quintal}/q</span>
                </div>
              ))}
            </div>
          )}

          {/* Price logic */}
          {data.price_logic && (
            <div>
              <button
                onClick={() => setShowLogic(s => !s)}
                className="flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"
              >
                <span className="material-symbols-outlined text-sm">{showLogic ? "expand_less" : "expand_more"}</span>
                {showLogic ? "Hide" : "Show"} How This Advice Was Calculated
              </button>
              {showLogic && (
                <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-3 flex flex-col gap-1.5 text-xs text-slate-600">
                  <p>📊 <strong>Reason:</strong> {data.price_logic.advice_reason}</p>
                  <p>✅ <strong>Sell rule:</strong> {data.price_logic.sell_threshold}</p>
                  <p>📦 <strong>Store rule:</strong> {data.price_logic.store_threshold}</p>
                  <p>🏛️ <strong>MSP floor:</strong> {data.price_logic.msp_floor}</p>
                  {data.price_logic.current_vs_msp_pct != null && (
                    <p>Current price is <strong>{data.price_logic.current_vs_msp_pct > 0 ? "+" : ""}{data.price_logic.current_vs_msp_pct}%</strong> vs MSP</p>
                  )}
                  <p>📄 Records analysed: {data.price_logic.records_analysed} Agmarknet entries</p>
                </div>
              )}
            </div>
          )}

          {/* Sources */}
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
        </>
      )}
    </div>
  );
}
