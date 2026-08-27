import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

/**
 * Guards a route. Optionally restricts by role.
 *   <ProtectedRoute>                       — any signed-in user
 *   <ProtectedRoute roles={["admin"]}>     — admin only
 *   <ProtectedRoute roles={["manager","admin"]}>
 */
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading || user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="label-eyebrow">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
