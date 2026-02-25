"use client";
// MiniLocationForm.tsx
// Compact location form for standalone tool pages.
// Provides state + district selection → geocodes → updates FarmerContext.

import { useState } from "react";
import { useFarmer } from "../context/FarmerContext";
import { STATES_DISTRICTS, SOIL_TYPES } from "../data/india_locations";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export default function MiniLocationForm({ onDone }: { onDone?: () => void }) {
  const { updateSession } = useFarmer();

  const [state,        setState]       = useState("");
  const [district,     setDistrict]    = useState("");
  const [landInput,    setLandInput]   = useState("1");
  const [soilType,     setSoilType]    = useState("Loamy");
  const [soilDetected, setSoilDetected]= useState(false);
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState("");

  const states    = Object.keys(STATES_DISTRICTS).sort();
  const districts = state ? (STATES_DISTRICTS[state] || []).sort() : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !district) { setError("Please select state and district."); return; }
    setLoading(true); setError("");

    try {
      // Geocode
      const geoRes = await fetch(
        `${API_URL}/api/planner/geocode?district=${encodeURIComponent(district)}&state=${encodeURIComponent(state)}`
      );
      if (!geoRes.ok) { const e = await geoRes.json(); throw new Error(e.detail || "Geocoding failed"); }
      const geo = await geoRes.json();

      // Auto soil detection
      let detected = soilType;
      try {
        const soilRes = await fetch(`${API_URL}/api/planner/soil?lat=${geo.lat}&lon=${geo.lon}`);
        if (soilRes.ok) {
          const s = await soilRes.json();
          detected = s.soil_type || soilType;
          setSoilType(detected);
          setSoilDetected(true);
        }
      } catch { /* non-critical */ }

      updateSession({
        state,
        district,
        land_size: parseFloat(landInput) || 1,
        soil_type: detected,
        lat: geo.lat,
        lon: geo.lon,
      });
      onDone?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Location failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* State + District */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">State</label>
          <select
            value={state}
            onChange={e => { setState(e.target.value); setDistrict(""); }}
            className="h-9 px-2 rounded-lg border border-green-200 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-600"
          >
            <option value="">Select state…</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">District</label>
          <select
            value={district}
            onChange={e => setDistrict(e.target.value)}
            disabled={!state}
            className="h-9 px-2 rounded-lg border border-green-200 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-50"
          >
            <option value="">Select district…</option>
            {districts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Land size + Soil type */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Land (acres)</label>
          <input
            type="number" min={0.1} step={0.1}
            value={landInput}
            onChange={e => setLandInput(e.target.value)}
            className="h-9 px-2 rounded-lg border border-green-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
            Soil Type
            {soilDetected && <span className="text-[9px] text-green-600">✓ auto</span>}
          </label>
          <select
            value={soilType}
            onChange={e => setSoilType(e.target.value)}
            className="h-9 px-2 rounded-lg border border-green-200 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-600"
          >
            {SOIL_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1.5">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="h-9 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
      >
        {loading
          ? <><span className="animate-spin material-symbols-outlined text-sm">progress_activity</span> Detecting…</>
          : <><span className="material-symbols-outlined text-sm">my_location</span> Detect Location</>}
      </button>
    </form>
  );
}
