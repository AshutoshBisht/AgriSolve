// app/weather/page.tsx — Standalone Weather & Risk page
import { FarmerProvider } from "../farming-planner/context/FarmerContext";
import StandaloneLayout from "../farming-planner/components/StandaloneLayout";
import WeatherWidget from "../farming-planner/components/WeatherWidget";

export default function WeatherPage() {
  return (
    <FarmerProvider storageKey="agrisolve_standalone_weather">
      <StandaloneLayout
        title="Weather & Risk"
        subtitle="Real-time forecasts, farm-level risk assessment, and seasonal outlook powered by Open-Meteo."
        icon="🌧️"
        accentColor="blue"
      >
        <WeatherWidget />
      </StandaloneLayout>
    </FarmerProvider>
  );
}
