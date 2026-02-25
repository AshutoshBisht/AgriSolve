// app/market/page.tsx — Standalone Market Advisor page
import { FarmerProvider } from "../farming-planner/context/FarmerContext";
import StandaloneLayout from "../farming-planner/components/StandaloneLayout";
import MarketAdvisor from "../farming-planner/components/MarketAdvisor";

export default function MarketPage() {
  return (
    <FarmerProvider storageKey="agrisolve_standalone_market">
      <StandaloneLayout
        title="Market Advisor"
        subtitle="Live mandi prices, MSP comparison, and sell/store recommendations powered by Agmarknet."
        icon="📈"
        accentColor="orange"
      >
        <MarketAdvisor />
      </StandaloneLayout>
    </FarmerProvider>
  );
}
