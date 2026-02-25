"use client";
// farming-planner/context/FarmerContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Shared session state for the Farming Planner.
// Uses React context + sessionStorage (no login required).
// All agents read from this context — location data flows to every feature.
// ─────────────────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useState, useEffect } from "react";

export interface FarmerSession {
  // Location (filled by the Map Agent form)
  name:       string;
  state:      string;
  district:   string;
  land_size:  number;       // in acres
  soil_type:  string;
  lat:        number | null;
  lon:        number | null;

  // Derived selections (filled as user navigates agents)
  selected_crop: string;
}

const DEFAULT_SESSION: FarmerSession = {
  name:          "",
  state:         "",
  district:      "",
  land_size:     1,
  soil_type:     "Loamy",
  lat:           null,
  lon:           null,
  selected_crop: "",
};

interface FarmerContextType {
  session:    FarmerSession;
  setSession: React.Dispatch<React.SetStateAction<FarmerSession>>;
  updateSession: (partial: Partial<FarmerSession>) => void;
  isLocated:  boolean;   // true once lat/lon are set
}

const FarmerContext = createContext<FarmerContextType | null>(null);

export function FarmerProvider({
  children,
  storageKey = "agrisolve_farmer_session",
}: {
  children:    React.ReactNode;
  storageKey?: string;
}) {
  const [session, setSession] = useState<FarmerSession>(DEFAULT_SESSION);

  // Persist to sessionStorage so a page refresh doesn't lose the location
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      try { setSession(JSON.parse(saved)); } catch {}
    }
  }, [storageKey]);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(session));
  }, [session, storageKey]);

  const updateSession = (partial: Partial<FarmerSession>) =>
    setSession(prev => ({ ...prev, ...partial }));

  const isLocated = session.lat !== null && session.lon !== null;

  return (
    <FarmerContext.Provider value={{ session, setSession, updateSession, isLocated }}>
      {children}
    </FarmerContext.Provider>
  );
}

export function useFarmer() {
  const ctx = useContext(FarmerContext);
  if (!ctx) throw new Error("useFarmer must be used inside <FarmerProvider>");
  return ctx;
}
