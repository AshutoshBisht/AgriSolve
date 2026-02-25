// app/crop-recommender/page.tsx — Standalone Crop Recommendation page
import { FarmerProvider } from "../farming-planner/context/FarmerContext";
import StandaloneLayout from "../farming-planner/components/StandaloneLayout";
import CropCards from "../farming-planner/components/CropCards";

export default function CropRecommenderPage() {
  return (
    <FarmerProvider storageKey="agrisolve_standalone_crops">
      <StandaloneLayout
        title="Crop Recommender"
        subtitle="Get AI-powered crop suggestions based on your soil, season, and weather conditions."
        icon="🌱"
        accentColor="green"
      >
        <CropCards />
      </StandaloneLayout>
    </FarmerProvider>
  );
}
