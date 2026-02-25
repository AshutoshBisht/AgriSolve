// app/crop-calendar/page.tsx — Standalone Crop Calendar page
import { FarmerProvider } from "../farming-planner/context/FarmerContext";
import StandaloneLayout from "../farming-planner/components/StandaloneLayout";
import CropCalendar from "../farming-planner/components/CropCalendar";

export default function CropCalendarPage() {
  return (
    <FarmerProvider storageKey="agrisolve_standalone_calendar">
      <StandaloneLayout
        title="Crop Calendar"
        subtitle="Sowing-to-harvest event timeline with zone-adjusted dates for your selected crop."
        icon="📅"
        accentColor="teal"
      >
        <CropCalendar />
      </StandaloneLayout>
    </FarmerProvider>
  );
}
