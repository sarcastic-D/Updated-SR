import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/AppShell";
import LoginPage from "@/pages/LoginPage";
import MonthlyRosterPage from "@/pages/MonthlyRosterPage";
import WeeklyRosterPage from "@/pages/RosterPage";
import EmployeesPage from "@/pages/EmployeesPage";
import LeavePortalPage from "@/pages/LeavePortalPage";
import ApprovalsPage from "@/pages/ApprovalsPage";
import LeaveCalendarPage from "@/pages/LeaveCalendarPage";
import UsersPage from "@/pages/UsersPage";
import { Toaster } from "@/components/ui/sonner";

const MANAGER_ROLES = ["manager", "admin"];
const ADMIN_ONLY = ["admin"];

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* All signed-in roles */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell><MonthlyRosterPage /></AppShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/leave"
              element={
                <ProtectedRoute>
                  <AppShell><LeavePortalPage /></AppShell>
                </ProtectedRoute>
              }
            />

            {/* Manager + Admin */}
            <Route
              path="/approvals"
              element={
                <ProtectedRoute roles={MANAGER_ROLES}>
                  <AppShell><ApprovalsPage /></AppShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/leave-calendar"
              element={
                <ProtectedRoute roles={MANAGER_ROLES}>
                  <AppShell><LeaveCalendarPage /></AppShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/weekly"
              element={
                <ProtectedRoute roles={MANAGER_ROLES}>
                  <AppShell><WeeklyRosterPage /></AppShell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/employees"
              element={
                <ProtectedRoute roles={MANAGER_ROLES}>
                  <AppShell><EmployeesPage /></AppShell>
                </ProtectedRoute>
              }
            />

            {/* Admin only */}
            <Route
              path="/users"
              element={
                <ProtectedRoute roles={ADMIN_ONLY}>
                  <AppShell><UsersPage /></AppShell>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </div>
  );
}

export default App;
