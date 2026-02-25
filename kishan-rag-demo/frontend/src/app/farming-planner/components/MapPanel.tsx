"use client";
// components/MapPanel.tsx — uses Leaflet with ESRI satellite tiles (free, no key)

import dynamic from "next/dynamic";
import { useFarmer } from "../context/FarmerContext";

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-green-50">
      <span className="animate-spin material-symbols-outlined text-green-600 text-4xl">
        progress_activity
      </span>
    </div>
  ),
});

export default function MapPanel() {
  const { session, isLocated, updateSession } = useFarmer();

  return (
    <div className="relative w-full h-full">
      <LeafletMap
        lat={session.lat ?? 22.5}
        lon={session.lon ?? 80.0}
        district={session.district}
        state={session.state}
        isLocated={isLocated}
        onPositionChange={(lat, lon) => updateSession({ lat, lon })}
      />

      {!isLocated && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1000]">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-6 py-4 shadow-xl border border-green-100 flex flex-col items-center gap-2 max-w-xs text-center">
            <span className="material-symbols-outlined text-4xl text-green-700">map</span>
            <p className="text-slate-700 font-semibold text-sm">Enter your location</p>
            <p className="text-slate-500 text-xs">Select state & district to pin your farm, or click anywhere on the map.</p>
          </div>
        </div>
      )}

      {isLocated && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-1 shadow border border-green-100 flex items-center gap-2 text-xs text-slate-600 font-mono">
            <span className="font-mono">{session.lat?.toFixed(5)}°N, {session.lon?.toFixed(5)}°E</span>
            <span className="text-slate-400 font-sans ml-1">• Drag pin to adjust</span>
          </div>
        </div>
      )}
    </div>
  );
}


