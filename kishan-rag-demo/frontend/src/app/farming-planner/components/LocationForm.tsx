"use client";
// components/LocationForm.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Left-panel form: farmer enters state, district, land size, soil type.
// On district select → auto-geocodes + soil-detects in the background.
// On submit → finalises all fields (name, land size) in shared FarmerContext.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { useFarmer } from "../context/FarmerContext";
import { STATES_DISTRICTS, SOIL_TYPES } from "../data/india_locations";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export default function LocationForm() {
  const { session, updateSession } = useFarmer();

  // Local form state (avoids context churn on every keystroke)
  const [form, setForm] = useState({
    name:      session.name,
    state:     session.state,
    district:  session.district,
    land_size: session.land_size,
    soil_type: session.soil_type,
  });

  // Separate string state so user can freely delete/type in the number input
  const [landSizeInput, setLandSizeInput] = useState(String(session.land_size));

  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");
  const [success,       setSuccess]       = useState(false);
  const [soilDetecting, setSoilDetecting] = useState(false);
  const [soilConfirmed, setSoilConfirmed] = useState(false);
  // Stored coordinates from the background auto-geocode so submit doesn't re-geocode
  const [autoCoordsRef, setAutoCoordsRef] = useState<{ lat: number; lon: number } | null>(null);

  const states    = Object.keys(STATES_DISTRICTS).sort();
  const districts = form.state ? (STATES_DISTRICTS[form.state] || []).sort() : [];

  // ── Background auto-detect when district is selected ──────────────────────
  const autoDetect = useCallback(async (state: string, district: string) => {
    if (!state || !district) return;
    setSoilDetecting(true);
    setSoilConfirmed(false);
    setError("");
    try {
      // 1. Geocode
      const geoRes = await fetch(
        `${API_URL}/api/planner/geocode?district=${encodeURIComponent(district)}&state=${encodeURIComponent(state)}`
      );
      if (!geoRes.ok) return;
      const geo = await geoRes.json();
      setAutoCoordsRef({ lat: geo.lat, lon: geo.lon });

      // 2. Update map immediately so user sees pin move
      updateSession({ state, district, lat: geo.lat, lon: geo.lon });

      // 3. Soil detection
      const soilRes = await fetch(`${API_URL}/api/planner/soil?lat=${geo.lat}&lon=${geo.lon}`);
      if (soilRes.ok) {
        const s = await soilRes.json();
        const detected = s.soil_type || form.soil_type;
        setForm(f => ({ ...f, soil_type: detected }));
        setSoilConfirmed(true);
      }
    } catch {
      // non-critical — silently ignore
    } finally {
      setSoilDetecting(false);
    }
  }, [updateSession, form.soil_type]);

  async function handleDetect(e: React.FormEvent) {
    e.preventDefault();
    if (!form.state || !form.district) {
      setError("Please select state and district first.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      // Use stored coords from background auto-detect if available; otherwise geocode now
      let lat: number, lon: number;
      if (autoCoordsRef) {
        ({ lat, lon } = autoCoordsRef);
      } else {
        const res = await fetch(
          `${API_URL}/api/planner/geocode?district=${encodeURIComponent(form.district)}&state=${encodeURIComponent(form.state)}`
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Geocoding failed");
        }
        const geo = await res.json();
        lat = geo.lat; lon = geo.lon;
      }

      // Finalise all fields in session
      updateSession({
        name:      form.name,
        state:     form.state,
        district:  form.district,
        land_size: parseFloat(landSizeInput) || 1,
        soil_type: form.soil_type,
        lat, lon,
      });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Location detection failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleDetect} className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">Your Farm Details</h2>
        <p className="text-sm text-slate-500">Enter your location to get personalised farming advice.</p>
      </div>

      {/* Name (optional) */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">Farmer Name <span className="text-slate-400">(optional)</span></label>
        <input
          type="text"
          placeholder="e.g. Ramesh Kumar"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="h-10 px-3 rounded-lg border border-green-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 placeholder:text-slate-400"
        />
      </div>

      {/* State */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">State <span className="text-red-500">*</span></label>
        <select
          value={form.state}
          onChange={e => setForm(f => ({ ...f, state: e.target.value, district: "" }))}
          className="h-10 px-3 rounded-lg border border-green-200 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-600"
          required
        >
          <option value="">Select state...</option>
          {states.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* District */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
          District <span className="text-red-500">*</span>
          {soilDetecting && (
            <span className="text-[10px] text-blue-500 animate-pulse font-normal ml-auto">📍 Locating…</span>
          )}
        </label>
        <select
          value={form.district}
          onChange={e => {
            const d = e.target.value;
            setForm(f => ({ ...f, district: d }));
            setAutoCoordsRef(null);
            setSoilConfirmed(false);
            autoDetect(form.state, d);
          }}
          className="h-10 px-3 rounded-lg border border-green-200 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-600"
          disabled={!form.state}
          required
        >
          <option value="">{form.state ? "Select district..." : "Select state first"}</option>
          {districts.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Land size + Soil type — side by side */}
      <div className="flex gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium text-slate-700">Land Size (acres)</label>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={landSizeInput}
            onChange={e => setLandSizeInput(e.target.value)}
            className="h-10 px-3 rounded-lg border border-green-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
            Soil Type
            {soilDetecting && (
              <span className="text-[10px] text-green-600 animate-pulse font-normal">⚙️ Detecting…</span>
            )}
            {!soilDetecting && soilConfirmed && (
              <span className="text-[10px] text-green-600 font-normal">✓ Auto-detected</span>
            )}
          </label>
          <select
            value={form.soil_type}
            onChange={e => setForm(f => ({ ...f, soil_type: e.target.value }))}
            className="h-10 px-3 rounded-lg border border-green-200 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-600"
          >
            {SOIL_TYPES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error / success */}
      {error   && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      {success && (
        <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
          ✅ Location detected — map updated!
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
            Detecting...
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-sm">my_location</span>
            Detect Location &amp; Load Map
          </>
        )}
      </button>
    </form>
  );
}
