"use client";
// StandaloneLayout.tsx
// Shared modern layout for all standalone feature pages.
// Provides: gradient header, location badge, "Get location-specific" toggle,
// mini location form, and a scrollable content area for the widget.

import { useState } from "react";
import Link from "next/link";
import { useFarmer } from "../context/FarmerContext";
import MiniLocationForm from "./MiniLocationForm";

interface Props {
  title:       string;
  subtitle:    string;
  icon:        string;          // emoji or text icon
  accentColor?: string;         // tailwind color token e.g. "blue" | "green" | "orange"
  children:    React.ReactNode;
}

const ACCENT = {
  green:  { bg: "from-green-600 to-emerald-700",   badge: "bg-green-100 text-green-800 border-green-200",    btn: "bg-green-700 hover:bg-green-800" },
  blue:   { bg: "from-blue-600  to-indigo-700",    badge: "bg-blue-100  text-blue-800  border-blue-200",     btn: "bg-blue-700  hover:bg-blue-800"  },
  orange: { bg: "from-orange-500 to-amber-600",    badge: "bg-orange-100 text-orange-800 border-orange-200", btn: "bg-orange-600 hover:bg-orange-700"},
  purple: { bg: "from-purple-600 to-violet-700",   badge: "bg-purple-100 text-purple-800 border-purple-200", btn: "bg-purple-700 hover:bg-purple-800"},
  teal:   { bg: "from-teal-500  to-cyan-700",      badge: "bg-teal-100  text-teal-800  border-teal-200",     btn: "bg-teal-600  hover:bg-teal-700"  },
  rose:   { bg: "from-rose-500  to-pink-700",      badge: "bg-rose-100  text-rose-800  border-rose-200",     btn: "bg-rose-600  hover:bg-rose-700"  },
};

export default function StandaloneLayout({
  title,
  subtitle,
  icon,
  accentColor = "green",
  children,
}: Props) {
  const { session, updateSession, isLocated } = useFarmer();
  const [showForm, setShowForm] = useState(false);

  const colors = ACCENT[accentColor as keyof typeof ACCENT] || ACCENT.green;
  const locationLabel = isLocated && session.district
    ? `${session.district}, ${session.state}`
    : "India General";

  function clearLocation() {
    updateSession({ lat: null, lon: null, state: "", district: "" });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* ── HEADER ──────────────────────────────────────────────────── */}
      <header className={`bg-gradient-to-r ${colors.bg} text-white`}>
        <div className="max-w-3xl mx-auto px-4 py-5">
          {/* Nav row */}
          <div className="flex items-center justify-between mb-4">
            <Link
              href="/new-ui"
              className="flex items-center gap-1.5 text-white/80 hover:text-white text-sm transition-colors"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              Back to Home
            </Link>
            <Link
              href="/farming-planner"
              className="flex items-center gap-1.5 text-white/80 hover:text-white text-xs transition-colors"
            >
              <span className="material-symbols-outlined text-base">agriculture</span>
              Full Planner
            </Link>
          </div>

          {/* Title row */}
          <div className="flex items-start gap-4">
            <span className="text-4xl">{icon}</span>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{title}</h1>
              <p className="text-white/75 text-sm mt-0.5">{subtitle}</p>
            </div>
          </div>

          {/* Location badge row */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {/* Mode badge */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${colors.badge}`}>
              <span className="material-symbols-outlined text-sm">
                {isLocated ? "location_on" : "public"}
              </span>
              {locationLabel}
            </div>

            {/* Toggle buttons */}
            {!isLocated ? (
              <button
                onClick={() => setShowForm(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${colors.btn} text-white transition-colors`}
              >
                <span className="material-symbols-outlined text-sm">my_location</span>
                {showForm ? "Cancel" : "Get Location-Specific ↓"}
              </button>
            ) : (
              <button
                onClick={clearLocation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/20 hover:bg-white/30 text-white transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                Clear Location
              </button>
            )}
          </div>

          {/* Mini location form (expandable) */}
          {showForm && !isLocated && (
            <div className="mt-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-4">
              <p className="text-xs text-white/70 mb-3 font-medium">
                Enter your location to get personalised recommendations.
              </p>
              <MiniLocationForm onDone={() => setShowForm(false)} />
            </div>
          )}
        </div>
      </header>

      {/* ── CONTENT ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {/* India-general notice */}
        {!isLocated && (
          <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <span className="material-symbols-outlined text-amber-500 mt-0.5">info</span>
            <span>
              Showing <strong>India-wide general recommendations</strong> based on current season.
              Click <strong>"Get Location-Specific"</strong> in the header to personalise.
            </span>
          </div>
        )}

        {/* The feature widget */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}
