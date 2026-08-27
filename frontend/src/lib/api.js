import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true, // httpOnly cookies are the primary auth transport
});

// -----------------------------------------------------------------------------
// Request interceptor: attach bearer token from sessionStorage as a fallback
// for environments (embedded webviews, some preview proxies) where third-party
// cookies get stripped. sessionStorage is used instead of localStorage so the
// token dies with the tab and cannot be persisted across sessions. httpOnly
// cookies remain the source of truth.
// -----------------------------------------------------------------------------
function readToken() {
  try {
    return sessionStorage.getItem("roster_access_token");
  } catch {
    return null;
  }
}
export function saveToken(token) {
  try {
    if (token) sessionStorage.setItem("roster_access_token", token);
    else sessionStorage.removeItem("roster_access_token");
  } catch { /* ignore quota errors */ }
}

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// -----------------------------------------------------------------------------
// Response interceptor: on a single 401, try /auth/refresh once and retry the
// original request. This keeps the UX seamless as short-lived (1h) access
// tokens roll over. Concurrent refreshes are coalesced onto one in-flight
// promise so we don't stampede the server.
// -----------------------------------------------------------------------------
let refreshInFlight = null;

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config || {};
    const status = error?.response?.status;

    if (status !== 401 || original._retry || (original.url || "").includes("/auth/")) {
      return Promise.reject(error);
    }

    original._retry = true;
    try {
      refreshInFlight = refreshInFlight || api.post("/auth/refresh").finally(() => {
        // Reset after this refresh cycle completes (success or fail)
        setTimeout(() => { refreshInFlight = null; }, 0);
      });
      const resp = await refreshInFlight;
      const newToken = resp?.data?.access_token;
      if (newToken) {
        saveToken(newToken);
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
      }
      return api.request(original);
    } catch (refreshErr) {
      saveToken(null);
      return Promise.reject(error);
    }
  }
);

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  }
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;
