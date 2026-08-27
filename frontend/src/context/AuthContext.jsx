import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import api, { formatApiError, saveToken } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // null = checking, false = unauth, object = authed
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      // Not authenticated or expired session — treat as logged out
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      // Primary auth is the httpOnly cookie set by the backend. We also keep a
      // short-lived bearer token in localStorage as a fallback for environments
      // (some preview proxies, embedded webviews) where third-party cookies are
      // blocked. The cookie remains the source of truth.
      if (data?.access_token) {
        saveToken(data.access_token);
      }
      setUser({
        id: data.id, email: data.email, name: data.name,
        role: data.role, linked_emp_id: data.linked_emp_id || "",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatApiError(e) };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      // Server is already unreachable or session already cleared — proceed
      // with local cleanup. Kept silent in production.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("logout request failed:", formatApiError(err));
      }
    }
    saveToken(null);
    setUser(false);
  }, []);

  const contextValue = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
