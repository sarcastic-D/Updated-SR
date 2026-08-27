import React, { useEffect, useMemo, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { CalendarRange, RefreshCw, CalendarDays, Clock, CheckCircle2, XCircle, Users } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_INITIALS = ["M","T","W","T","F","S","S"];

const STATUS_STYLES = {
  PENDING:  { bar: "bg-[#F59E0B] border-[#B45309] text-[#7C2D12]",  icon: Clock,       label: "Pending"  },
  APPROVED: { bar: "bg-[#10B981] border-[#065F46] text-white",       icon: CheckCircle2, label: "Approved" },
  REJECTED: { bar: "bg-[#9CA3AF] border-[#374151] text-white opacity-60", icon: XCircle, label: "Rejected" },
};

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
function iso(year, month, day) {
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function dayWeekday(year, month, day) {
  const wkd = new Date(year, month - 1, day).getDay();
  return DAY_INITIALS[(wkd + 6) % 7];
}
function isWeekend(year, month, day) {
  const wkd = new Date(year, month - 1, day).getDay();
  return wkd === 0 || wkd === 6;
}

export default function LeaveCalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState("ALL"); // ALL, PENDING, APPROVED, REJECTED
  const [leaves, setLeaves] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      const [lvRes, empRes] = await Promise.all([
        api.get(`/leaves?${params.toString()}`),
        api.get("/employees"),
      ]);
      setLeaves(lvRes.data);
      setEmployees(empRes.data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [year, month, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const numDays = useMemo(() => daysInMonth(year, month), [year, month]);
  const days = useMemo(() => Array.from({ length: numDays }, (_, i) => i + 1), [numDays]);

  // Group leaves by employee, then compute per-day status
  const rows = useMemo(() => {
    // Build employee → leaves[]
    const byEmp = new Map();
    leaves.forEach((lr) => {
      if (!byEmp.has(lr.emp_id)) byEmp.set(lr.emp_id, []);
      byEmp.get(lr.emp_id).push(lr);
    });
    // Build rows
    const result = [];
    for (const [empId, lrs] of byEmp.entries()) {
      const emp = employees.find((e) => e.emp_id === empId);
      if (!emp) continue;
      // For each day, find best leave (priority: approved > pending > rejected)
      const cells = days.map((day) => {
        const dIso = iso(year, month, day);
        // Find leaves covering this day
        const hits = lrs.filter((lr) => {
          return lr.start_date <= dIso && dIso <= lr.end_date;
        });
        if (hits.length === 0) return null;
        const priority = { APPROVED: 0, PENDING: 1, REJECTED: 2 };
        hits.sort((a, b) => priority[a.status] - priority[b.status]);
        return hits[0];
      });
      result.push({ employee: emp, cells, leaves: lrs });
    }
    // Sort: secops first, then by emp_id
    result.sort((a, b) => {
      if (a.employee.is_secops !== b.employee.is_secops) return a.employee.is_secops ? -1 : 1;
      return a.employee.emp_id.localeCompare(b.employee.emp_id);
    });
    return result;
  }, [leaves, employees, days, year, month]);

  // Per-day totals (approved + pending leaves)
  const dailyTotals = useMemo(() => {
    return days.map((day) => {
      let pending = 0, approved = 0;
      rows.forEach((r) => {
        const cell = r.cells[day - 1];
        if (!cell) return;
        if (cell.status === "APPROVED") approved++;
        else if (cell.status === "PENDING") pending++;
      });
      return { day, pending, approved };
    });
  }, [rows, days]);

  // Summary stats
  const stats = useMemo(() => {
    const s = { PENDING: 0, APPROVED: 0, REJECTED: 0, peopleOff: new Set(), peakDay: { day: 0, count: 0 } };
    leaves.forEach((lr) => { if (lr.status in s) s[lr.status] += 1; });
    rows.forEach((r) => r.cells.forEach((c) => { if (c && c.status === "APPROVED") s.peopleOff.add(r.employee.emp_id); }));
    dailyTotals.forEach((d) => { if (d.approved + d.pending > s.peakDay.count) s.peakDay = { day: d.day, count: d.approved + d.pending }; });
    return s;
  }, [leaves, rows, dailyTotals]);

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1700px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap anim-fade-up">
        <div>
          <div className="label-eyebrow flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5" /> 06 · Leave Calendar
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
            Leave Overview — {MONTHS[month - 1]} {year}
          </h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            {rows.length} employees with leave activity · peak day: {stats.peakDay.day ? `${SHORT[month-1]} ${stats.peakDay.day} (${stats.peakDay.count})` : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-[var(--brand-primary)]" />
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-36 h-10 rounded-none" data-testid="calendar-month-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-24 h-10 rounded-none" data-testid="calendar-year-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {[2025, 2026, 2027, 2028].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm" variant="outline" onClick={load} disabled={loading}
            className="rounded-none h-10 text-xs"
            data-testid="calendar-refresh-button"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5" data-testid="leave-stats">
        <StatCard label="Approved" value={stats.APPROVED} accent="#10B981" />
        <StatCard label="Pending" value={stats.PENDING} accent="#F59E0B" />
        <StatCard label="Rejected" value={stats.REJECTED} accent="#9CA3AF" />
        <StatCard label="People Off (Approved)" value={stats.peopleOff.size} accent="var(--brand-primary)" icon={Users} />
      </div>

      {/* Status filter */}
      <div className="flex border border-[var(--border)] w-fit mb-3">
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((k) => (
          <button
            key={k}
            onClick={() => setStatusFilter(k)}
            data-testid={`status-filter-${k.toLowerCase()}`}
            className={`px-4 h-10 text-xs font-semibold uppercase tracking-wider transition-colors
              ${statusFilter === k
                ? "bg-[var(--brand-primary)] text-white"
                : "bg-white hover:bg-[var(--surface)]"}`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="border border-[var(--border)] bg-white overflow-x-auto" data-testid="leave-calendar-grid">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-[var(--brand-accent)] text-white sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider w-[180px] border-r border-white/10 sticky left-0 bg-[var(--brand-accent)]">
                Employee
              </th>
              <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wider w-12 border-r border-white/10">Days</th>
              {days.map((d) => {
                const wkn = isWeekend(year, month, d);
                return (
                  <th
                    key={d}
                    className={`px-1 py-1 text-center text-[10px] border-r border-white/10 min-w-[26px] ${wkn ? "bg-[var(--shift-weekend)] text-[#1F2937]" : ""}`}
                  >
                    <div className="font-mono-plex">{d}</div>
                    <div className="opacity-60 text-[9px]">{dayWeekday(year, month, d)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={numDays + 2} className="py-12 text-center label-eyebrow">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={numDays + 2} className="py-16 text-center" data-testid="leave-calendar-empty">
                  <CalendarDays className="w-10 h-10 mx-auto text-[var(--muted)] mb-3" />
                  <p className="text-sm text-[var(--muted)]">
                    No leave activity in {MONTHS[month - 1]} {year}.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const empDayCount = r.cells.filter((c) => c && c.status !== "REJECTED").length;
                return (
                  <tr
                    key={r.employee.emp_id}
                    className={`border-t border-[var(--border)] ${idx % 2 === 1 ? "bg-[var(--surface)]/40" : ""}`}
                    data-testid={`leave-row-${r.employee.emp_id}`}
                  >
                    <td className={`px-2 py-1.5 border-r border-[var(--border)] sticky left-0 ${idx % 2 === 1 ? "bg-[var(--surface)]" : "bg-white"}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-plex text-[10px] font-bold text-[var(--muted)]">{r.employee.emp_id}</span>
                        <span className={`text-xs ${r.employee.is_secops ? "font-bold text-[#FF6600]" : "font-semibold"}`}>
                          {r.employee.name}
                        </span>
                        {r.employee.soc_level && (
                          <span className="text-[9px] px-1 py-0.5 font-bold border border-black/30">{r.employee.soc_level}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono-plex text-[11px] font-bold border-r border-[var(--border)]">
                      {empDayCount}
                    </td>
                    {r.cells.map((cell, i) => {
                      const day = i + 1;
                      const wkn = isWeekend(year, month, day);
                      if (!cell) {
                        return (
                          <td
                            key={day}
                            className={`border-r border-[var(--border)] ${wkn ? "bg-[var(--shift-weekend)]" : ""}`}
                            data-testid={`leave-cell-${r.employee.emp_id}-${day}`}
                          />
                        );
                      }
                      const sty = STATUS_STYLES[cell.status];
                      const Icon = sty.icon;
                      const initial = cell.status[0]; // P/A/R
                      return (
                        <td
                          key={day}
                          className={`text-center border-r border-[var(--border)] ${wkn ? "bg-[var(--shift-weekend)]" : ""}`}
                          title={`${cell.status} · ${cell.reason || "—"}${cell.replacement_name ? ` · Replaced by ${cell.replacement_name}` : ""}`}
                          data-testid={`leave-cell-${r.employee.emp_id}-${day}`}
                        >
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 border text-[10px] font-bold ${sty.bar}`}
                          >
                            {initial}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot data-testid="leave-daily-totals">
              <tr className="bg-[var(--surface)] border-t-2 border-[var(--brand-primary)]">
                <td className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-[var(--brand-primary)] border-r border-[var(--border)] sticky left-0 bg-[var(--surface)]">
                  Daily Total →
                </td>
                <td className="border-r border-[var(--border)]" />
                {dailyTotals.map(({ day, pending, approved }) => {
                  const wkn = isWeekend(year, month, day);
                  const total = pending + approved;
                  return (
                    <td
                      key={day}
                      className={`text-center font-mono-plex text-[10px] font-bold border-r border-[var(--border)] ${wkn ? "bg-[var(--shift-weekend)]" : ""} ${total >= 4 ? "text-[#B71C1C]" : total > 0 ? "text-[var(--brand-primary)]" : "text-[var(--muted)]"}`}
                      title={`${approved} approved · ${pending} pending`}
                      data-testid={`leave-daily-${day}`}
                    >
                      {total || ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Legend */}
      <div className="mt-5 flex flex-wrap gap-4 items-center text-[11px]">
        <span className="label-eyebrow">Legend</span>
        {Object.entries(STATUS_STYLES).map(([k, sty]) => (
          <div key={k} className="inline-flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-5 h-5 border text-[9px] font-bold ${sty.bar}`}>
              {k[0]}
            </span>
            <span className="font-semibold">{sty.label}</span>
          </div>
        ))}
        <span className="text-[var(--muted)] ml-4">Footer row = total people off per day (red ≥ 4)</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, icon: Icon }) {
  return (
    <div className="border border-[var(--border)] bg-white px-4 py-3 flex items-center justify-between">
      <div>
        <div className="label-eyebrow">{label}</div>
        <div className="font-display text-3xl font-bold leading-none mt-1">{value}</div>
      </div>
      <div className="w-1 h-10" style={{ background: accent }} />
      {Icon && <Icon className="w-5 h-5" style={{ color: accent }} />}
    </div>
  );
}
