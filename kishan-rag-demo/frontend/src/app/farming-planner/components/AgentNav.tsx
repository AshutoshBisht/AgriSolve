"use client";
// components/AgentNav.tsx
// Tab bar that switches the left panel between all 7 farming agents.

import { useFarmer } from "../context/FarmerContext";

export type AgentTab =
  | "map"
  | "crops"
  | "weather"
  | "market"
  | "calendar"
  | "doctor"
  | "predict"
  | "agent";

const TABS: { id: AgentTab; icon: string; label: string; alwaysEnabled?: boolean }[] = [
  { id: "map", icon: "my_location", label: "Location" },
  { id: "crops", icon: "grass", label: "Crops" },
  { id: "weather", icon: "cloud", label: "Weather" },
  { id: "market", icon: "trending_up", label: "Market" },
  { id: "calendar", icon: "calendar_month", label: "Calendar" },
  { id: "doctor", icon: "local_hospital", label: "Doctor" },
  { id: "predict", icon: "insights", label: "Predict" },
  { id: "agent", icon: "smart_toy", label: "Ask AI", alwaysEnabled: true },
];

interface AgentNavProps {
  active: AgentTab;
  onChange: (tab: AgentTab) => void;
}

export default function AgentNav({ active, onChange }: AgentNavProps) {
  const { isLocated } = useFarmer();
  const locked = !isLocated;

  return (
    <div className="flex overflow-x-auto gap-1 px-4 py-2 bg-white border-b border-green-100 scrollbar-hide">
      {TABS.map(tab => {
        const isMap = tab.id === "map";
        const isActive = active === tab.id;
        const isDisabled = locked && !isMap && !tab.alwaysEnabled;

        return (
          <button
            key={tab.id}
            onClick={() => !isDisabled && onChange(tab.id)}
            title={isDisabled ? "Detect your location first" : tab.label}
            className={`
              flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-medium
              whitespace-nowrap transition-colors flex-shrink-0
              ${isActive
                ? "bg-green-700 text-white"
                : isDisabled
                  ? "text-slate-300 cursor-not-allowed"
                  : "text-slate-600 hover:bg-green-50 hover:text-green-700"}
            `}
          >
            <span className="material-symbols-outlined text-base">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
