import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import api from "@/lib/api";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);

  // Fetch the branded logo (public endpoint) once on mount
  useEffect(() => {
    let cancelled = false;
    api.get("/settings/login-logo")
      .then(({ data }) => { if (!cancelled) setLogoUrl(data?.data_url || null); })
      .catch(() => { /* silent — logo is purely cosmetic */ });
    return () => { cancelled = true; };
  }, []);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await login(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (res.ok) {
      toast.success("Welcome back");
      navigate("/", { replace: true });
    } else {
      toast.error(res.error || "Login failed");
    }
  };

  return (
    <div className="min-h-screen w-full bg-white text-black grid grid-cols-1 lg:grid-cols-2">
      {/* Left: Identity panel */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 bg-[#0a0a0a] text-white overflow-hidden">
        <div className="absolute inset-0 grid-backdrop opacity-[0.06] pointer-events-none" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-3 h-3 bg-[#86BC25]" />
          <div className="label-eyebrow text-white/60">Roster Console · v1</div>
        </div>
        <div className="relative z-10 max-w-md anim-fade-up">
          <div className="label-eyebrow text-white/60 mb-6">Workforce Operations</div>
          {logoUrl && (
            <div className="mb-8" data-testid="login-brand-logo">
              <img
                src={logoUrl}
                alt="Organization logo"
                className="max-h-24 max-w-[220px] object-contain bg-white/5 p-3 border border-white/10"
              />
            </div>
          )}
          <h1 className="font-display text-5xl xl:text-6xl font-bold leading-[1.02] tracking-tight">
            Plan the week.
            <br />
            <span className="text-[#86BC25]">Ship the week.</span>
          </h1>
          <p className="mt-6 text-white/70 text-base leading-relaxed max-w-sm">
            A precise weekly shift planner for L1/L2 squads.
            Edit, color-code, and export — all without leaving the grid.
          </p>
        </div>
        <div className="relative z-10 flex items-end justify-between text-xs text-white/40 font-mono-plex">
          <span>ON-PREMISES</span>
          <span>JWT · HTTPONLY</span>
          <span>SINGLE-TENANT</span>
        </div>
      </aside>

      {/* Right: Auth panel */}
      <main className="flex items-center justify-center p-8 md:p-12">
        <div className="w-full max-w-md anim-fade-up">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="w-3 h-3 bg-[#86BC25]" />
            <div className="label-eyebrow">Roster Console</div>
          </div>
          <div className="label-eyebrow mb-3 flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" />
            Secure Sign-in
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-2">
            Sign in
          </h2>
          <p className="text-sm text-[var(--muted)] mb-10">
            Sign in with your credentials. Admins, managers and users use the same portal.
          </p>

          <form onSubmit={onSubmit} className="space-y-6" data-testid="login-form">
            <div>
              <Label htmlFor="email" className="label-eyebrow">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@roster.app"
                className="mt-2 h-12 border-black/20 rounded-none focus-visible:ring-0 focus-visible:border-black"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <Label htmlFor="password" className="label-eyebrow">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-2 h-12 border-black/20 rounded-none focus-visible:ring-0 focus-visible:border-black"
                data-testid="login-password-input"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="group w-full h-12 rounded-none bg-black hover:bg-[#86BC25] hover:text-black text-white font-semibold tracking-wide transition-colors duration-200"
              data-testid="login-submit-button"
            >
              <Lock className="w-4 h-4 mr-2 group-hover:hidden" />
              {submitting ? "Signing in…" : "Sign in"}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
          </form>

          <div className="mt-12 pt-6 border-t border-black/10 text-xs text-[var(--muted)] font-mono-plex flex justify-between">
            <span>NEED ACCESS?</span>
            <span>CONTACT IT ADMINISTRATOR</span>
          </div>
        </div>
      </main>
    </div>
  );
}
