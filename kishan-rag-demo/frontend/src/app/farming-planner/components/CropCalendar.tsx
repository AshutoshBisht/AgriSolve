"use client";
// components/CropCalendar.tsx
// Sowing → fertilizer → irrigation → harvest timeline from the Calendar Agent.

import { useState } from "react";
import { useFarmer } from "../context/FarmerContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface CalendarEvent {
  date:        string;
  label:       string;
  description: string;
  type:        "sow" | "irrigation" | "fertilizer" | "harvest";
  icon:        string;
}

interface CalendarData {
  crop:   string;
  zone:   string;
  events: CalendarEvent[];
}

const TYPE_STYLE: Record<string, string> = {
  sow:        "border-green-500 bg-green-50",
  irrigation: "border-blue-400 bg-blue-50",
  fertilizer: "border-purple-400 bg-purple-50",
  harvest:    "border-yellow-500 bg-yellow-50",
};

export default function CropCalendar() {
  const { session } = useFarmer();
  const [data,    setData]    = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]  = useState("");
  const [crop,    setCrop]   = useState(session.selected_crop || "Wheat");

  async function fetchCalendar() {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/planner/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: session.state, district: session.district, crop }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Calendar fetch failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">📅 Crop Calendar</h2>
        <p className="text-sm text-slate-500">Full sowing-to-harvest timeline for your crop.</p>
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
          onClick={fetchCalendar}
          disabled={loading}
          className="h-10 px-4 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
        >
          {loading
            ? <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
            : <span className="material-symbols-outlined text-sm">calendar_month</span>}
          Generate
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {data && (
        <>
          <p className="text-xs text-slate-500">
            Zone: <span className="font-semibold text-slate-700">{data.zone}</span> · Crop: <span className="font-semibold text-slate-700">{data.crop}</span>
          </p>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { type: "sow",        label: "Sowing",      icon: "🌱" },
              { type: "fertilizer", label: "Fertilizer",  icon: "🧪" },
              { type: "irrigation", label: "Irrigation",  icon: "💧" },
              { type: "harvest",    label: "Harvest",     icon: "🌾" },
            ].map(l => (
              <span key={l.type} className={`px-2 py-1 rounded-full border text-xs ${TYPE_STYLE[l.type]}`}>
                {l.icon} {l.label}
              </span>
            ))}
          </div>

          {/* Timeline */}
          <div className="relative flex flex-col gap-3 pl-6 border-l-2 border-green-100">
            {data.events.map((ev, i) => {
              const isUpcoming = new Date(ev.date) >= new Date();
              return (
                <div key={i} className={`relative border-l-4 rounded-xl px-4 py-3 ${TYPE_STYLE[ev.type]} ${!isUpcoming ? "opacity-50" : ""}`}>
                  {/* Timeline dot */}
                  <div className="absolute -left-[22px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-green-700 border-2 border-white" />

                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        {ev.icon} {ev.label}
                      </p>
                      <p className="text-xs text-slate-600">{ev.description}</p>
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap font-mono">
                      {new Date(ev.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
