import { Sidebar } from "./components/Sidebar"
import { TopNav } from "./components/TopNav"
import { Routes, Route, useLocation, Navigate } from "react-router-dom"
import { Home } from "./pages/Home"
import { Vehicle } from "./pages/Vehicle"
import { Reports } from "./pages/Reports"
import { Login } from "./pages/Login"

import { FleetAI } from "./pages/FleetAI"
import { Dashboard } from "./pages/Dashboard"
import { OpsProvider } from "./context/OpsContext"
import { AuthProvider } from "./context/AuthContext"
import { ProtectedRoute } from "./components/auth/ProtectedRoute"
import { CompliancePage } from "./pages/compliance/CompliancePage"
import { DriverScore } from "./pages/DriverScore"
import { DriverScoreLogic } from "./pages/DriverScoreLogic"
import LiveGeofences from "./pages/ops/LiveGeofences"
import LiveFleet from "./pages/ops/LiveFleet"

export default function App() {
  return (
    <OpsProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/*" element={<Layout />} />
          </Route>
        </Routes>
      </AuthProvider>
    </OpsProvider>
  )
}

function Layout() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isLocked = searchParams.get('view') === 'locked';

  const hideSidebarRoutes = ["/fleet-ai", "/contact"];
  const showSidebar = !hideSidebarRoutes.includes(location.pathname) && !isLocked;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-main font-sans text-foreground transition-colors duration-200">
      {/* SIDEBAR — touches viewport edge (Fixed) */}
      {showSidebar && <Sidebar />}

      {/* MAIN CONTENT — padded */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header (Links) - Global */}
        {!isLocked && <TopNav />}

        {/* Page Content */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/fleet-pulse" element={<Home />} />
          <Route path="/live-geofences" element={<LiveGeofences />} />
          <Route path="/live-fleet" element={<LiveFleet />} />
          <Route path="/corridor-analytics" element={<Home />} />
          <Route path="/turnaround-time" element={<Home />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/vehicle/*" element={<Vehicle />} />
          <Route path="/vehicle/driver-score" element={<DriverScore />} />
          <Route path="/vehicle/score-logic" element={<DriverScoreLogic />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/fleet-ai" element={<FleetAI />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
