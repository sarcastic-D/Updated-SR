import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  LogOut, CalendarDays, Users, Inbox, CalendarRange, FileSignature, ShieldCheck, CalendarCheck2,
} from "lucide-react";

const ROLE_BADGES = {
  admin:   { label: "Admin",   color: "bg-[#B71C1C] text-white" },
  manager: { label: "Manager", color: "bg-[var(--brand-primary)] text-white" },
  user:    { label: "User",    color: "bg-black text-white" },
};

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  // Visible to all signed-in roles
  const baseItems = [
    { to: "/", label: "Monthly Roster", icon: CalendarRange, testid: "nav-monthly" },
    { to: "/leave", label: "Leave Portal", icon: FileSignature, testid: "nav-leave" },
  ];
  // Manager + admin
  const managerItems = [
    { to: "/approvals", label: "Approvals", icon: Inbox, testid: "nav-approvals" },
    { to: "/leave-calendar", label: "Leave Calendar", icon: CalendarCheck2, testid: "nav-leave-calendar" },
    { to: "/weekly", label: "Weekly Editor", icon: CalendarDays, testid: "nav-weekly" },
    { to: "/employees", label: "Employees", icon: Users, testid: "nav-employees" },
  ];
  // Admin only
  const adminItems = [
    { to: "/users", label: "Users", icon: ShieldCheck, testid: "nav-users" },
  ];

  let navItems = baseItems;
  if (user?.role === "manager") navItems = [...baseItems, ...managerItems];
  if (user?.role === "admin")   navItems = [...baseItems, ...managerItems, ...adminItems];

  const badge = user ? ROLE_BADGES[user.role] : null;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="h-14 border-b border-[var(--border)] bg-white sticky top-0 z-30">
        <div className="h-full px-4 md:px-6 flex items-center justify-between">
          <div className="flex items-center gap-6 min-w-0">
            <Link to="/" className="flex items-center gap-2 shrink-0" data-testid="brand-home-link">
              <svg className="w-6 h-6 shrink-0" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="100" height="100" fill="black" />
                <path d="M27 27H50C62.7 27 73 37.3 73 50C73 62.7 62.7 73 50 73H27V27ZM40 37V63H50C57.2 63 63 57.2 63 50C63 42.8 57.2 37 50 37H40Z" fill="white" />
                <circle cx="78" cy="66" r="8" fill="#86BC25" />
              </svg>
              <span className="font-display font-bold tracking-tight text-base md:text-lg">SOC Roster</span>
              <span className="label-eyebrow ml-2 hidden md:inline">v1.2</span>
            </Link>
            <nav className="flex items-center gap-0 overflow-x-auto">
              {navItems.map(({ to, label, icon: Icon, testid }) => {
                const active = location.pathname === to || (to === "/" && location.pathname === "/");
                return (
                  <Link
                    key={to}
                    to={to}
                    data-testid={testid}
                    className={`group inline-flex items-center gap-2 px-3 h-9 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                      ${active
                        ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                        : "border-transparent text-[var(--muted)] hover:text-[var(--brand-primary)]"
                      }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {user && badge && (
              <span
                data-testid="role-badge"
                className={`hidden sm:inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 ${badge.color}`}
              >
                {badge.label}
              </span>
            )}
            <div className="hidden md:flex flex-col items-end leading-tight">
              <span className="text-xs font-semibold">{user?.name}</span>
              <span className="label-eyebrow">{user?.email}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="rounded-none border-[var(--border)] hover:bg-[var(--brand-primary)] hover:text-white h-9"
              data-testid="logout-button"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--border)] px-6 py-3 flex items-center justify-between text-xs text-[var(--muted)] font-mono-plex">
        <span>© SOC Shift Roster Console</span>
        <span>ON-PREMISES · INTERNAL TOOL</span>
      </footer>
    </div>
  );
}
