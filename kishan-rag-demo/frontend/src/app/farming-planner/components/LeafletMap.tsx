"use client";
// components/LeafletMap.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Leaflet map with multiple high-quality tile layers — fully free, no API key.
//   • ESRI WorldImagery  — satellite imagery, zoom to field level
//   • ESRI WorldStreetMap — labelled streets/boundaries
//   • OpenTopoMap        — terrain / elevation contours
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix Leaflet broken icon in webpack/Next.js
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom green farm pin
const farmIcon = L.divIcon({
  className: "",
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <path d="M18 0C8.059 0 0 8.059 0 18c0 12.27 16.5 26 18 26s18-13.73 18-26C36 8.059 27.941 0 18 0z" fill="#15803d"/>
    <circle cx="18" cy="18" r="9" fill="white"/>
    <text x="18" y="23" text-anchor="middle" font-size="11" fill="#15803d">🌾</text>
  </svg>`,
  iconSize:    [36, 44],
  iconAnchor:  [18, 44],
  popupAnchor: [0, -48],
});

// Tile layer definitions — all completely free, no API key
const LAYERS = {
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, DigitalGlobe, GeoEye, Earthstar Geographics, CNES/Airbus DS",
    maxZoom: 19,
  },
  streets: {
    label: "Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Esri, HERE, Garmin, USGS, Intermap",
    maxZoom: 19,
  },
  topo: {
    label: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)",
    maxZoom: 17,
  },
} as const;
type LayerKey = keyof typeof LAYERS;

// Sub-component: smooth fly-to when coordinates change
function FlyTo({ lat, lon, isLocated }: { lat: number; lon: number; isLocated: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (isLocated) {
      map.flyTo([lat, lon], 14, { duration: 1.8 });
    }
  }, [lat, lon, isLocated, map]);
  return null;
}

// Sub-component: click anywhere on map to place / move the pin
function ClickToPlace({ onPosition }: { onPosition: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => onPosition(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

interface LeafletMapProps {
  lat:                number;
  lon:                number;
  district:           string;
  state:              string;
  isLocated:          boolean;
  onPositionChange?:  (lat: number, lon: number) => void;
}

export default function LeafletMap({ lat, lon, district, state, isLocated, onPositionChange }: LeafletMapProps) {
  const [activeLayer, setActiveLayer] = useState<LayerKey>("satellite");
  const layer = LAYERS[activeLayer];

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={[22.5, 80.0]}
        zoom={5}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        attributionControl={true}
      >
        <ZoomControl position="topright" />

        <TileLayer
          key={activeLayer}          /* key forces re-mount when layer changes */
          url={layer.url}
          attribution={layer.attribution}
          maxZoom={layer.maxZoom}
        />

        <FlyTo lat={lat} lon={lon} isLocated={isLocated} />
        {onPositionChange && <ClickToPlace onPosition={onPositionChange} />}

        {isLocated && (
          <Marker
            position={[lat, lon]}
            icon={farmIcon}
            draggable={!!onPositionChange}
            eventHandlers={onPositionChange ? {
              dragend: (e) => {
                const pos = (e.target as L.Marker).getLatLng();
                onPositionChange(pos.lat, pos.lng);
              },
            } : {}}
          >
            <Popup>
              <div className="text-sm font-semibold text-green-800">
                📍 {district}{state ? `, ${state}` : ""}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono">
                {lat.toFixed(5)}°N, {lon.toFixed(5)}°E
              </div>
              {onPositionChange && (
                <div className="text-xs text-slate-400 mt-1">Drag pin or click map to move</div>
              )}
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Layer switcher — bottom left, above attribution */}
      <div className="absolute bottom-8 left-3 z-[1000] flex flex-col gap-1">
        {(Object.entries(LAYERS) as [LayerKey, typeof LAYERS[LayerKey]][]).map(([key, l]) => (
          <button
            key={key}
            onClick={() => setActiveLayer(key)}
            className={`text-xs px-3 py-1 rounded-full font-semibold shadow border transition-colors ${
              activeLayer === key
                ? "bg-green-700 text-white border-green-700"
                : "bg-white/90 text-slate-700 border-slate-200 hover:border-green-500"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

