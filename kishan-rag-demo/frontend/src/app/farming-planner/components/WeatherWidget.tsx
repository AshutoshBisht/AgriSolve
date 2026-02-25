"use client";
// components/WeatherWidget.tsx
// Weather & Risk Widget with Weekly / Monthly / Seasonal tab support.

import { useState } from "react";
import { useFarmer } from "../context/FarmerContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ForecastDay {
  date:     string;
  temp_max: number;
  temp_min: number;
  rain_mm:  number;
}

interface Risk {
  type:   string;
  level:  string;
  reason: string;
}

interface WeeklyData {
  view:           "weekly";
  current:        ForecastDay;
  forecast_7d:    ForecastDay[];
  rain_30d_total: number;
  risks:          Risk[];
  data_sources?:  Record<string, unknown>;
}

interface WeekSummary {
  week:          number;
  label:         string;
  date_start:    string;
  date_end:      string;
  avg_max_temp:  number | null;
  avg_min_temp:  number | null;
  total_rain_mm: number;
  days:          number;
  is_forecast:   boolean;
}

interface MonthlyData {
  view:    "monthly";
  weeks:   WeekSummary[];
  summary: { total_rain_mm: number; avg_max_temp: number; avg_min_temp: number; period_days: number };
  data_sources?: Record<string, unknown>;
}

interface MonthEntry {
  month:          string;
  avg_max_temp:   number | null;
  avg_min_temp:   number | null;
  total_rain_mm:  number;
  days_recorded:  number;
}

interface SeasonMeta {
  months:      string[];
  description: string;
  top_crops:   string[];
  advisory:    string;
}

interface SeasonalData {
  view:             "seasonal";
  season:           string;
  meta:             SeasonMeta;
  monthly_trend:    MonthEntry[];
  forecast_16d:     { total_rain_mm: number; avg_max_temp: number | null; days: number };
  seasonal_summary: { total_rain_90d_mm: number; expected_rain_mm: number; rainfall_pct: number; rainfall_status: string };
  data_sources?:    Record<string, unknown>;
}

type WeatherData = WeeklyData | MonthlyData | SeasonalData;
type ViewTab = "weekly" | "monthly" | "seasonal";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_STYLE: Record<string, string> = {
  High:   "bg-red-100 text-red-700 border-red-200",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Low:    "bg-green-100 text-green-700 border-green-200",
};
const RISK_ICON: Record<string, string> = {
  Frost: "ac_unit", Heat: "local_fire_department", Flood: "water", Drought: "wb_sunny",
};

function rainIcon(mm: number) {
  if (mm > 20) return "🌧️";
  if (mm > 5)  return "🌦️";
  return "☀️";
}

function rainfallStatusColor(status: string) {
  if (status === "Deficient")    return "text-red-600 bg-red-50 border-red-200";
  if (status === "Below Normal") return "text-yellow-600 bg-yellow-50 border-yellow-200";
  return "text-green-700 bg-green-50 border-green-200";
}

// ── Views ─────────────────────────────────────────────────────────────────────

function WeeklyView({ data, showSrc, toggleSrc }: { data: WeeklyData; showSrc: boolean; toggleSrc: () => void }) {
  return (
    <>
      {/* Today summary */}
      <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex justify-between items-center">
        <div>
          <p className="text-xs text-slate-500">Today</p>
          <p className="text-2xl font-bold text-slate-800">
            {data.current.temp_max?.toFixed(0)}° / {data.current.temp_min?.toFixed(0)}°C
          </p>
          <p className="text-sm text-slate-600">Rain: {data.current.rain_mm?.toFixed(1)} mm</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Last 30 days rain</p>
          <p className="text-xl font-bold text-blue-600">{data.rain_30d_total} mm</p>
        </div>
      </div>

      {/* Risk badges */}
      {data.risks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Active Risks</p>
          {data.risks.map(r => (
            <div key={r.type} className={`flex items-start gap-3 p-3 rounded-xl border ${RISK_STYLE[r.level] || "bg-gray-50 text-gray-700 border-gray-200"}`}>
              <span className="material-symbols-outlined text-lg flex-shrink-0">{RISK_ICON[r.type] || "warning"}</span>
              <div>
                <p className="text-xs font-bold">{r.level} {r.type} Risk</p>
                <p className="text-xs opacity-80">{r.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {data.risks.length === 0 && (
        <div className="p-3 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700">
          ✅ No major farm risks detected this week.
        </div>
      )}

      {/* 7-day strip */}
      <div>
        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">7-Day Forecast</p>
        <div className="grid grid-cols-7 gap-1">
          {data.forecast_7d.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5 p-2 bg-white border border-green-100 rounded-lg text-xs">
              <span>{new Date(d.date).toLocaleDateString("en-IN", { weekday: "short" })}</span>
              <span className="text-base">{rainIcon(d.rain_mm)}</span>
              <span className="font-semibold text-slate-700">{d.temp_max?.toFixed(0)}°</span>
              <span className="text-slate-400">{d.temp_min?.toFixed(0)}°</span>
              <span className="text-blue-500">{d.rain_mm?.toFixed(0)}mm</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sources */}
      {data.data_sources && (
        <div>
          <button onClick={toggleSrc} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:underline">
            <span className="material-symbols-outlined text-sm">{showSrc ? "expand_less" : "expand_more"}</span>
            {showSrc ? "Hide" : "Show"} Data Sources & Risk Rules
          </button>
          {showSrc && (
            <div className="mt-2 bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col gap-1 text-xs text-slate-600">
              {Object.entries(data.data_sources).map(([k, v]) =>
                typeof v === "object" ? (
                  <div key={k}>
                    <p className="font-semibold capitalize mt-1">{k}:</p>
                    {Object.entries(v as Record<string, string>).map(([rk, rv]) => (
                      <p key={rk}>• <strong>{rk}:</strong> {rv}</p>
                    ))}
                  </div>
                ) : (
                  <p key={k}><span className="font-semibold capitalize">{k}:</span> {String(v)}</p>
                )
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MonthlyView({ data }: { data: MonthlyData }) {
  const maxRain = Math.max(...data.weeks.map(w => w.total_rain_mm), 1);
  return (
    <>
      {/* 30-day summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-500">Total Rainfall</p>
          <p className="text-xl font-bold text-blue-700">{data.summary.total_rain_mm} mm</p>
          <p className="text-xs text-slate-400">over {data.summary.period_days} days</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-500">Avg Max Temp</p>
          <p className="text-xl font-bold text-orange-600">{data.summary.avg_max_temp}°C</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-500">Avg Min Temp</p>
          <p className="text-xl font-bold text-green-700">{data.summary.avg_min_temp}°C</p>
        </div>
      </div>

      {/* 4-week breakdown */}
      <div>
        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">4-Week Breakdown</p>
        <div className="flex flex-col gap-2">
          {data.weeks.map(w => (
            <div key={w.week} className={`rounded-xl border p-3 ${w.is_forecast ? "bg-blue-50 border-blue-100" : "bg-white border-green-100"}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    Week {w.week} {w.is_forecast && <span className="text-blue-500 font-normal">(forecast)</span>}
                  </p>
                  <p className="text-[10px] text-slate-400">{w.date_start} → {w.date_end}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-blue-600">{w.total_rain_mm} mm</p>
                  <p className="text-xs text-slate-500">{w.avg_max_temp}° / {w.avg_min_temp}°C</p>
                </div>
              </div>
              {/* Rainfall bar */}
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 rounded-full"
                  style={{ width: `${Math.min(100, (w.total_rain_mm / maxRain) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SeasonalView({ data }: { data: SeasonalData }) {
  const statusClass = rainfallStatusColor(data.seasonal_summary.rainfall_status);
  return (
    <>
      {/* Season header */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs text-slate-500">Current Season</p>
            <p className="text-2xl font-bold text-green-700">{data.season}</p>
            <p className="text-xs text-slate-600 mt-1">{data.meta.description}</p>
          </div>
          <div className={`text-xs font-bold px-3 py-1.5 rounded-full border ${statusClass}`}>
            {data.seasonal_summary.rainfall_status}
          </div>
        </div>
      </div>

      {/* Rainfall vs normal */}
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Rainfall vs Seasonal Normal</p>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xs text-slate-500 w-20">Actual (90d)</span>
          <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${Math.min(100, data.seasonal_summary.rainfall_pct)}%` }}
            />
          </div>
          <span className="text-xs font-bold text-blue-600">{data.seasonal_summary.total_rain_90d_mm} mm</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 w-20">Expected</span>
          <div className="flex-1 h-3 bg-green-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full" style={{ width: "100%" }} />
          </div>
          <span className="text-xs font-bold text-green-600">{data.seasonal_summary.expected_rain_mm} mm</span>
        </div>
        <p className="text-xs text-slate-400 mt-2">{data.seasonal_summary.rainfall_pct}% of seasonal normal received</p>
      </div>

      {/* Monthly trend */}
      {data.monthly_trend.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Monthly Trend (past 90 days)</p>
          <div className="grid gap-2">
            {data.monthly_trend.slice(-3).map(m => (
              <div key={m.month} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-slate-700">
                  {new Date(m.month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                </span>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span>🌡️ {m.avg_max_temp}° / {m.avg_min_temp}°C</span>
                  <span>🌧️ {m.total_rain_mm} mm</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 16-day forecast */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-xs font-semibold text-slate-700 mb-1">Next 16 Days Forecast</p>
        <div className="flex gap-6 text-sm">
          <span>🌧️ <strong>{data.forecast_16d.total_rain_mm} mm</strong> total rain</span>
          {data.forecast_16d.avg_max_temp && (
            <span>🌡️ Avg max <strong>{data.forecast_16d.avg_max_temp}°C</strong></span>
          )}
        </div>
      </div>

      {/* Seasonal crop advice */}
      <div className="bg-gradient-to-br from-green-50 to-lime-50 border border-green-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-green-800 uppercase tracking-wider mb-2">
          {data.season} Season Crops
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {data.meta.top_crops.map(crop => (
            <span key={crop} className="px-2 py-1 bg-white border border-green-200 rounded-full text-xs text-green-700 font-medium">
              {crop}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-600">{data.meta.advisory}</p>
      </div>
    </>
  );
}

// ── Main Widget ───────────────────────────────────────────────────────────────

export default function WeatherWidget() {
  const { session } = useFarmer();
  const [activeView, setActiveView] = useState<ViewTab>("weekly");
  const [dataMap,    setDataMap]    = useState<Partial<Record<ViewTab, WeatherData>>>({});
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [showSrc,    setShowSrc]    = useState(false);

  const lat = session.lat ?? 20.5937;
  const lon = session.lon ?? 78.9629;

  async function fetchWeather(view: ViewTab) {
    setActiveView(view);
    if (dataMap[view]) return;   // already loaded
    setLoading(true); setError("");
    try {
      const res = await fetch(
        `${API_URL}/api/planner/weather?lat=${lat}&lon=${lon}&view=${view}`
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const json = await res.json();
      setDataMap(prev => ({ ...prev, [view]: json }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Weather fetch failed");
    } finally { setLoading(false); }
  }

  const TABS: { id: ViewTab; label: string; icon: string }[] = [
    { id: "weekly",   label: "Weekly",   icon: "calendar_view_week" },
    { id: "monthly",  label: "Monthly",  icon: "calendar_month" },
    { id: "seasonal", label: "Seasonal", icon: "eco" },
  ];

  const currentData = dataMap[activeView];

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">🌧️ Weather & Risk</h2>
        <p className="text-sm text-slate-500">Forecast, farm risks, and seasonal outlook.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => fetchWeather(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold transition-colors ${
              activeView === t.id
                ? "bg-white shadow-sm text-green-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="material-symbols-outlined text-sm">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Fetch button (shown when no data yet for this tab) */}
      {!currentData && !loading && (
        <button
          onClick={() => fetchWeather(activeView)}
          className="h-10 bg-green-700 hover:bg-green-800 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">cloud_download</span>
          {activeView === "seasonal" ? "Load Seasonal Outlook" : activeView === "monthly" ? "Load Monthly Summary" : "Fetch Weather"}
        </button>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 h-10 text-sm text-green-700">
          <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
          Loading {activeView} data…
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {currentData && (
        <>
          {currentData.view === "weekly"   && <WeeklyView   data={currentData} showSrc={showSrc} toggleSrc={() => setShowSrc(s => !s)} />}
          {currentData.view === "monthly"  && <MonthlyView  data={currentData} />}
          {currentData.view === "seasonal" && <SeasonalView data={currentData} />}

          {/* Reload button */}
          <button
            onClick={() => {
              setDataMap(prev => { const updated = { ...prev }; delete updated[activeView]; return updated; });
              setTimeout(() => fetchWeather(activeView), 0);
            }}
            className="self-start flex items-center gap-1 text-xs text-slate-400 hover:text-green-600 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            Refresh
          </button>
        </>
      )}
    </div>
  );
}




