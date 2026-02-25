// app/crop-doctor/page.tsx — Standalone Crop Doctor page
import { FarmerProvider } from "../farming-planner/context/FarmerContext";
import StandaloneLayout from "../farming-planner/components/StandaloneLayout";
import CropDoctor from "../farming-planner/components/CropDoctor";

export default function CropDoctorPage() {
  return (
    <FarmerProvider storageKey="agrisolve_standalone_doctor">
      <StandaloneLayout
        title="Crop Doctor"
        subtitle="Describe your plant's symptoms and get AI-powered disease diagnosis and treatment plans."
        icon="🩺"
        accentColor="rose"
      >
        <CropDoctor />
      </StandaloneLayout>
    </FarmerProvider>
  );
}
