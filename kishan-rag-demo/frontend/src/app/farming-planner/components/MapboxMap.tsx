"use client";
// components/MapboxMap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Mapbox GL JS map via react-map-gl v8.
//
// Advantages over the previous Leaflet/OSM setup:
//   ✅ Correct India international boundaries (legally compliant tile set)
//   ✅ Satellite + Streets hybrid — zoom into actual land/fields
//   ✅ Smooth GPU-accelerated fly-to animation
//   ✅ Built-in zoom / compass / fullscreen controls
//   ✅ Up to zoom level 22 (field-level detail)
//
// Requires NEXT_PUBLIC_MAPBOX_TOKEN in frontend/.env.local
// Free token: https://account.mapbox.com/access-tokens/
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import Map, {
  Marker,
  Popup,
  NavigationControl,
  FullscreenControl,
  ScaleControl,
  MapRef,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Map style options — user can switch between these
const STYLES = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain:   "mapbox://styles/mapbox/outdoors-v12",
  streets:   "mapbox://styles/mapbox/streets-v12",
} as const;
type StyleKey = keyof typeof STYLES;

interface MapboxMapProps {
  lat:       number;
  lon:       number;
  district:  string;
  state:     string;
  isLocated: boolean;
}

export default function MapboxMap({ lat, lon, district, state, isLocated }: MapboxMapProps) {
  const mapRef   = useRef<MapRef>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [mapStyle, setMapStyle]   = useState<StyleKey>("satellite");

  // Fly to farm location when coordinates change
  useEffect(() => {
    if (!isLocated || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [lon, lat],
      zoom:   12,
      speed:  1.4,
      curve:  1.4,
    });
    setPopupOpen(true);
  }, [lat, lon, isLocated]);

  // No token — show clear error rather than a blank div
  if (!MAPBOX_TOKEN || MAPBOX_TOKEN === "pk.your_token_here") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 gap-4 p-8 text-center">
        <span className="material-symbols-outlined text-5xl text-slate-400">map</span>
        <p className="font-bold text-slate-700">Mapbox token not configured</p>
        <ol className="text-sm text-slate-500 text-left max-w-sm list-decimal list-inside space-y-1">
          <li>Go to <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer" className="text-green-700 underline">account.mapbox.com/access-tokens</a></li>
          <li>Copy your default public token (starts with <code className="bg-slate-200 px-1 rounded">pk.</code>)</li>
          <li>
            Paste it in{" "}
            <code className="bg-slate-200 px-1 rounded">
              frontend/.env.local
            </code>{" "}
            as <code className="bg-slate-200 px-1 rounded">NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx</code>
          </li>
          <li>Restart the frontend dev server</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          longitude: 80.0,
          latitude:  22.5,
          zoom:      5,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={STYLES[mapStyle]}
        attributionControl={false}
      >
        {/* Controls */}
        <NavigationControl position="top-right" />
        <FullscreenControl  position="top-right" />
        <ScaleControl      position="bottom-right" maxWidth={100} unit="metric" />

        {/* Farm marker */}
        {isLocated && (
          <>
            <Marker
              longitude={lon}
              latitude={lat}
              anchor="bottom"
              onClick={() => setPopupOpen(p => !p)}
            >
              {/* Custom pin */}
              <div
                title={`${district}${state ? `, ${state}` : ""}`}
                className="cursor-pointer drop-shadow-lg"
              >
                <svg width="36" height="44" viewBox="0 0 36 44" fill="none">
                  <path
                    d="M18 0C8.059 0 0 8.059 0 18c0 12.27 16.5 26 18 26s18-13.73 18-26C36 8.059 27.941 0 18 0z"
                    fill="#15803d"
                  />
                  <circle cx="18" cy="18" r="8" fill="white" />
                  <text x="18" y="23" textAnchor="middle" fontSize="12" fill="#15803d">🌾</text>
                </svg>
              </div>
            </Marker>

            {popupOpen && (
              <Popup
                longitude={lon}
                latitude={lat}
                anchor="top"
                offset={[0, -48] as [number, number]}
                onClose={() => setPopupOpen(false)}
                closeButton
                closeOnClick={false}
                className="rounded-xl"
              >
                <div className="px-1 py-0.5 min-w-[140px]">
                  <p className="font-bold text-green-800 text-sm">
                    📍 {district}{state ? `, ${state}` : ""}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    {lat.toFixed(5)}°N, {lon.toFixed(5)}°E
                  </p>
                </div>
              </Popup>
            )}
          </>
        )}
      </Map>

      {/* Style switcher (bottom-left) */}
      <div className="absolute bottom-10 left-3 z-10 flex flex-col gap-1">
        {(Object.keys(STYLES) as StyleKey[]).map(s => (
          <button
            key={s}
            onClick={() => setMapStyle(s)}
            className={`text-xs px-2.5 py-1 rounded-full font-semibold shadow border transition-colors capitalize ${
              mapStyle === s
                ? "bg-green-700 text-white border-green-700"
                : "bg-white text-slate-600 border-slate-200 hover:border-green-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
