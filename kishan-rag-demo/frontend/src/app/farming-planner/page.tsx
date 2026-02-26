"use client";
// farming-planner/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Farming Planner main page.
// Layout: left 40% = scrollable panel (form + agent outputs)
//         right 60% = persistent Leaflet map
//
// The FarmerProvider wraps everything so all child components can share the
// farmer's session (lat/lon, crop, soil type etc.) via useFarmer().
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FarmerProvider } from "./context/FarmerContext";
import AgentNav, { AgentTab } from "./components/AgentNav";
import MapPanel from "./components/MapPanel";
import LocationForm from "./components/LocationForm";
import CropCards from "./components/CropCards";
import WeatherWidget from "./components/WeatherWidget";
import MarketAdvisor from "./components/MarketAdvisor";
import CropCalendar from "./components/CropCalendar";
import CropDoctor from "./components/CropDoctor";
import PredictWidget from "./components/PredictWidget";
import AgentChat from "./components/AgentChat";


// Maps each tab ID to the component that renders in the left panel
const PANEL_COMPONENTS: Record<AgentTab, React.ComponentType> = {
  map: LocationForm,
  crops: CropCards,
  weather: WeatherWidget,
  market: MarketAdvisor,
  calendar: CropCalendar,
  doctor: CropDoctor,
  predict: PredictWidget,
  agent: AgentChat,
};

function FarmingPlannerContent() {
  const [activeTab, setActiveTab] = useState<AgentTab>("map");
  const router = useRouter();

  const PanelComponent = PANEL_COMPONENTS[activeTab];

  return (
    <div className="flex flex-col h-screen bg-green-50 overflow-hidden">

      {/* ── Top navigation bar ── */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-green-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button
            onClick={() => router.push("/new-ui")}
            className="p-1.5 rounded-lg text-slate-500 hover:text-green-700 hover:bg-green-50 transition-colors"
            title="Back to home"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          {/* Logo + title */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-700 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-lg">eco</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800 leading-tight">AgriSolve Planner</h1>
              <p className="text-xs text-slate-500 leading-tight">Smart Farming Assistant</p>
            </div>
          </div>
        </div>

        {/* Link to RAG chat */}
        <button
          onClick={() => router.push("/new-ui/chat")}
          className="flex items-center gap-1.5 text-sm text-green-700 hover:text-green-800 font-medium"
        >
          <span className="material-symbols-outlined text-sm">chat</span>
          Chat with AgriSolve
        </button>
      </header>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL (40%) ── */}
        <div className="w-[40%] min-w-[320px] flex flex-col bg-white border-r border-green-100 overflow-hidden flex-shrink-0">

          {/* Agent tab bar */}
          <AgentNav active={activeTab} onChange={setActiveTab} />

          {/* Scrollable panel content */}
          <div className="flex-1 overflow-y-auto">
            <PanelComponent />
          </div>
        </div>

        {/* ── RIGHT PANEL (60%) — persistent map ── */}
        <div className="flex-1 overflow-hidden">
          <MapPanel />
        </div>
      </div>
    </div>
  );
}

// Wrap in provider and export as the page
export default function FarmingPlannerPage() {
  return (
    <FarmerProvider>
      <FarmingPlannerContent />
    </FarmerProvider>
  );
}
