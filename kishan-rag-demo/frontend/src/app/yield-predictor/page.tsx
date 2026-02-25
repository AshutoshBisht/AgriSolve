// app/yield-predictor/page.tsx — Standalone Yield Predictor page
import { FarmerProvider } from "../farming-planner/context/FarmerContext";
import StandaloneLayout from "../farming-planner/components/StandaloneLayout";
import PredictWidget from "../farming-planner/components/PredictWidget";

export default function YieldPredictorPage() {
  return (
    <FarmerProvider storageKey="agrisolve_standalone_predict">
      <StandaloneLayout
        title="Yield Predictor"
        subtitle="Estimate crop yield and net profit based on soil type, weather, and national CACP data."
        icon="📊"
        accentColor="purple"
      >
        <PredictWidget />
      </StandaloneLayout>
    </FarmerProvider>
  );
}
