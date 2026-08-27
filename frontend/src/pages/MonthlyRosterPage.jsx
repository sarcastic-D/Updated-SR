import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { exportMonthlyRosterXLSX } from "@/lib/exportXlsx";
import { SHIFT_COLORS, SHIFT_LABEL, SOC_SHIFTS, L3_SHIFTS, shiftCellClass } from "@/lib/shifts";
import { Download, RefreshCw, CalendarRange, Shuffle, RotateCcw, Lock, Upload, GripVertical, FileSpreadsheet, CheckCircle2, AlertTriangle, Save, CircleDot } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import * as XLSX from "xlsx-js-style";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_INITIALS = ["M","T","W","T","F","S","S"]; // Mon-first

function monthDayInitial(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wkd = new Date(y, m - 1, d).getDay();
  return DAY_INITIALS[(wkd + 6) % 7];
}
function isWeekendIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wkd = new Date(y, m - 1, d).getDay();
  return wkd === 0 || wkd === 6;
}

// Coverage targets per team per shift
const TEAM_COVERAGE_TARGETS = {
  L1: { M: null, A: null, N: null },    // no fixed target for L1
  L2: { M: 2,    A: 2,    N: 1    },    // 2 Morning / 2 Noon / 1 Night
  L3: { M: 3,    A: 2,    N: null  },   // 3 Morning / 2 Noon / no Night
};

export default function MonthlyRosterPage() {
  const { user } = useAuth();
  const canManage = user && (user.role === "admin" || user.role === "manager");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reshuffling, setReshuffling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activeTeam, setActiveTeam] = useState("L1");
  const [dragEmpId, setDragEmpId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  // Inline daily-cell editing (WD/WO/L/Adj/Clear) — mirrors Weekly Editor
  const [edits, setEdits] = useState({});          // { `${empId}__${date}`: code }
  const [activeCell, setActiveCell] = useState(null); // { empId, date, x, y }
  const [savingEdits, setSavingEdits] = useState(false);

  const cellKey = (empId, date) => `${empId}__${date}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/roster/monthly?year=${year}&month=${month}`);
      setRoster(data);
      setEdits({});
      setActiveCell(null);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const onReshuffle = async () => {
    setReshuffling(true);
    try {
      await api.post(`/roster/monthly/reshuffle?year=${year}&month=${month}`);
      toast.success(`Reshuffled ${MONTHS[month - 1]} ${year}`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setReshuffling(false);
    }
  };

  const onClearSnapshot = async () => {
    setClearing(true);
    try {
      await api.delete(`/roster/monthly?year=${year}&month=${month}`);
      toast.success(`Cleared snapshot for ${MONTHS[month - 1]} ${year}`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setClearing(false);
    }
  };

  const onExport = () => {
    if (!roster) return;
    exportMonthlyRosterXLSX(roster);
    toast.success("Excel exported (L1, L2, L3 sheets)");
  };

  // Move an employee to a target shift by patching the monthly snapshot
  const moveEmployeeToShift = useCallback(async (employeeId, targetShift) => {
    if (!canManage || !employeeId) return;
    const emp = roster?.employees?.find((e) => e.id === employeeId);
    if (!emp) return;
    if (emp.assigned_shift === targetShift) return;
    if (emp.soc_level === "L3" && targetShift === "N") {
      toast.error("L3 employees cannot be assigned to the Night shift.");
      return;
    }
    const SHIFT_NAMES = { M: "Morning", A: "Noon", N: "Night" };
    const targetName = SHIFT_NAMES[targetShift] || targetShift;
    try {
      await api.post("/roster/monthly/assign", {
        year, month,
        assignments: [{ employee_id: employeeId, assigned_shift: targetShift }],
      });
      toast.success(`${emp.name} moved to ${targetName} shift`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [canManage, roster, year, month, load]);

  // Effective schedules = backend schedules with unsaved local edits overlaid,
  // so all counts/coverage/summaries reflect edits live before saving.
  const effSchedules = useMemo(() => {
    if (!roster) return {};
    const base = roster.schedules;
    const keys = Object.keys(edits);
    if (keys.length === 0) return base;
    const out = { ...base };
    keys.forEach((k) => {
      const [empId, date] = k.split("__");
      const sched = out[empId];
      if (!sched) return;
      out[empId] = { ...sched, daily_status: { ...sched.daily_status, [date]: edits[k] } };
    });
    return out;
  }, [roster, edits]);

  const dirty = Object.keys(edits).length > 0;

  const handleCellClick = useCallback((empId, date, ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    setActiveCell({ empId, date, x: rect.left, y: rect.bottom });
  }, []);

  const setCellCode = useCallback((empId, date, code) => {
    if (!roster) return;
    const orig = roster.schedules[empId]?.daily_status?.[date] || "";
    const key = cellKey(empId, date);
    setEdits((prev) => {
      const next = { ...prev };
      if (code === orig) delete next[key];
      else next[key] = code;
      return next;
    });
    setActiveCell(null);
  }, [roster]);

  const onRevertEdits = () => {
    setEdits({});
    setActiveCell(null);
    toast.info("Reverted unsaved changes");
  };

  const onSaveEdits = async () => {
    const keys = Object.keys(edits);
    if (keys.length === 0) { toast.info("Nothing to save"); return; }
    setSavingEdits(true);
    try {
      const entries = keys.map((k) => {
        const [employee_id, date] = k.split("__");
        return { employee_id, date, code: edits[k] || "", sub_type: "" };
      });
      await api.post("/roster/bulk", { entries });
      toast.success(`Saved ${entries.length} change${entries.length === 1 ? "" : "s"}`);
      setEdits({});
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingEdits(false);
    }
  };

  // Filter employees by active team tab
  const teamEmployees = useMemo(() => {
    if (!roster) return [];
    return roster.employees.filter((e) => e.soc_level === activeTeam);
  }, [roster, activeTeam]);

  // Group by shift — for L3 only show M and A
  const grouped = useMemo(() => {
    const g = { M: [], A: [], N: [], "": [] };
    teamEmployees.forEach((e) => {
      const code = e.assigned_shift || "";
      (g[code] || g[""]).push(e);
    });
    return g;
  }, [teamEmployees]);

  // Visible shift sections per team (memoised to keep stable reference for downstream useMemo)
  const visibleShifts = useMemo(
    () => (activeTeam === "L3" ? ["M", "A"] : ["M", "A", "N"]),
    [activeTeam]
  );

  // Shift display config — L3 uses custom timings
  const shiftConfig = activeTeam === "L3" ? L3_SHIFTS : SOC_SHIFTS;

  // Totals computed only for the active team's employees
  const totals = useMemo(() => {
    if (!roster) return { WD: 0, WO: 0, L: 0, Adj: 0 };
    const t = { WD: 0, WO: 0, L: 0, Adj: 0 };
    teamEmployees.forEach((emp) => {
      const sched = effSchedules[emp.id];
      if (!sched) return;
      Object.values(sched.daily_status).forEach((v) => { if (v in t) t[v]++; });
    });
    return t;
  }, [roster, teamEmployees, effSchedules]);

  // Per-shift summaries for active team
  const shiftSummaries = useMemo(() => {
    const result = { M: null, A: null, N: null };
    if (!roster) return result;
    visibleShifts.forEach((sc) => {
      const emps = grouped[sc] || [];
      const dailyCoverage = roster.dates.map(() => 0);
      let manDays = 0, leaves = 0;
      emps.forEach((emp) => {
        const sched = effSchedules[emp.id];
        if (!sched) return;
        roster.dates.forEach((d, i) => {
          const v = sched.daily_status[d];
          if (v === "WD" || v === "Adj") { dailyCoverage[i] += 1; manDays += 1; }
          else if (v === "L") { leaves += 1; }
        });
      });
      result[sc] = {
        headcount: emps.length,
        manDays,
        leaves,
        dailyCoverage,
        minCoverage: emps.length ? Math.min(...dailyCoverage) : 0,
        maxCoverage: emps.length ? Math.max(...dailyCoverage) : 0,
      };
    });
    return result;
  }, [roster, grouped, visibleShifts, effSchedules]);

  const TEAM_TABS = ["L1", "L2", "L3"];

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1700px] mx-auto">
      {/* ── Toolbar ── */}
      <div className="border border-[var(--border)] bg-white anim-fade-up">
        {/* Row 1: title + actions */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="label-eyebrow">Operations / Monthly Roster</div>
            <div className="w-px h-4 bg-[var(--border)]" />
            <h1 className="font-display text-base font-semibold tracking-tight truncate">
              SOC Monthly Roster
            </h1>
            {roster?.has_snapshot ? (
              <span
                className="ml-2 inline-flex items-center gap-1.5 px-2 h-6 text-[10px] font-semibold uppercase tracking-wider bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] border border-[var(--brand-primary)]/30"
                data-testid="monthly-snapshot-badge"
              >
                <Lock className="w-2.5 h-2.5" /> Custom Shuffle
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1.5 px-2 h-6 text-[10px] font-semibold uppercase tracking-wider bg-black/5 text-[var(--muted)] border border-black/10">
                Default
              </span>
            )}
            {dirty && (
              <span
                className="ml-2 inline-flex items-center gap-1.5 px-2 h-6 text-[10px] font-semibold uppercase tracking-wider bg-[#FFB600]/15 text-[#996d00] border border-[#FFB600]/40"
                data-testid="monthly-unsaved-badge"
              >
                <CircleDot className="w-2.5 h-2.5" /> Unsaved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canManage && (
              <>
                {dirty && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRevertEdits}
                      className="rounded-none border-[var(--border)] h-9 text-xs"
                      data-testid="monthly-edit-revert"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Revert
                    </Button>
                    <Button
                      size="sm"
                      onClick={onSaveEdits}
                      disabled={savingEdits}
                      className="rounded-none h-9 text-xs bg-black text-white hover:bg-[var(--brand-primary)] font-semibold disabled:opacity-40"
                      data-testid="monthly-edit-save"
                    >
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      {savingEdits ? "Saving…" : "Save Changes"}
                    </Button>
                    <div className="w-px h-6 bg-[var(--border)] mx-1" />
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                  className="rounded-none border-[var(--border)] h-9 text-xs hover:bg-[var(--brand-primary)] hover:text-white"
                  data-testid="monthly-import-button"
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Import Shifts
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReshuffle}
                  disabled={reshuffling}
                  className="rounded-none border-[var(--border)] h-9 text-xs hover:bg-[var(--brand-primary)] hover:text-white"
                  data-testid="monthly-reshuffle-button"
                >
                  <Shuffle className={`w-3.5 h-3.5 mr-1.5 ${reshuffling ? "animate-spin" : ""}`} />
                  {reshuffling ? "Reshuffling…" : "Reshuffle Month"}
                </Button>
                {roster?.has_snapshot && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearSnapshot}
                    disabled={clearing}
                    className="rounded-none h-9 text-xs hover:bg-black/5"
                    data-testid="monthly-clear-snapshot-button"
                    title="Revert to default employee assignments"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    Reset Shifts
                  </Button>
                )}
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
              className="rounded-none border-[var(--border)] h-9 text-xs"
              data-testid="monthly-refresh-button"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={onExport}
              disabled={!roster}
              className="rounded-none h-9 text-xs bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)] font-semibold"
              data-testid="monthly-export-button"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export XLSX
            </Button>
          </div>
        </div>

        {/* Row 2: Month/Year selector + Totals */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[var(--surface)] flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-[var(--brand-primary)]" />
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
              <SelectTrigger className="w-32 h-9 rounded-none" data-testid="month-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {MONTHS.map((m, i) => (<SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-24 h-9 rounded-none" data-testid="year-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {[2025, 2026, 2027, 2028].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); }}
              className="rounded-none h-9 px-3 text-[10px] uppercase tracking-[0.18em] font-semibold hover:bg-[var(--brand-primary)] hover:text-white"
              data-testid="this-month-button"
            >
              This Month
            </Button>
          </div>

          {/* Totals strip — active team only */}
          <div className="flex items-center gap-4" data-testid="monthly-totals">
            {["WD","WO","L","Adj"].map((c) => (
              <div key={c} className="flex items-center gap-2" data-testid={`monthly-stat-${c}`}>
                <span className="w-3 h-3 inline-block border border-black/10" style={{ background: SHIFT_COLORS[c] }} />
                <span className="font-mono-plex text-[11px] font-semibold">{c}</span>
                <span className="font-display text-base font-bold">{totals[c]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sub-tabs: L1 / L2 / L3 ── */}
        <div className="flex border-t border-[var(--border)]">
          {TEAM_TABS.map((team) => {
            const isActive = activeTeam === team;
            const count = roster ? roster.employees.filter((e) => e.soc_level === team).length : 0;
            return (
              <button
                key={team}
                onClick={() => setActiveTeam(team)}
                data-testid={`team-tab-${team}`}
                className={[
                  "flex items-center gap-2 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] border-r border-[var(--border)] transition-all relative",
                  isActive
                    ? "bg-[var(--brand-primary)] text-white"
                    : "bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--brand-primary)]/10 hover:text-[var(--brand-primary)]",
                ].join(" ")}
              >
                {team}
                <span className={[
                  "inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold",
                  isActive ? "bg-white/20 text-white" : "bg-black/10 text-[var(--muted)]",
                ].join(" ")}>
                  {count}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                )}
              </button>
            );
          })}
          {/* Team description */}
          <div className="flex-1 flex items-center px-4 text-[10px] text-[var(--muted)] font-medium">
            {activeTeam === "L1" && "L1 Team — Standard rotation (7AM–3PM / 3PM–11PM / 11PM–7AM)"}
            {activeTeam === "L2" && "L2 Team — Fixed week-offs · 2 Morning / 2 Noon / 1 Night daily coverage"}
            {activeTeam === "L3" && "L3 Team — Sat & Sun off · 3 Morning (9AM–6PM) / 2 Noon (12PM–9PM) · No Night shift"}
          </div>
        </div>
      </div>

      {/* ── Per-shift summary cards ── */}
      {roster && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="shift-summary-cards">
          {visibleShifts.map((sc) => {
            const s = shiftSummaries[sc];
            const shift = shiftConfig[sc];
            if (!s || !shift) return null;
            const target = TEAM_COVERAGE_TARGETS[activeTeam]?.[sc];
            const understaffed = target
              ? s.headcount > 0 && s.minCoverage < target
              : s.headcount > 0 && s.minCoverage < Math.ceil(s.headcount * 0.5);
            return (
              <div
                key={sc}
                className="border border-[var(--border)] bg-white px-4 py-3 anim-fade-up"
                data-testid={`shift-summary-${sc}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3" style={{ background: shift.color }} />
                    <span className="font-semibold text-xs uppercase tracking-wider">{shift.name} Shift</span>
                    <span className="label-eyebrow ml-1">{shift.display}</span>
                    {target && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-black/5 border border-black/10 font-mono-plex text-[var(--muted)]">
                        Target: {target}/day
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono-plex text-[var(--muted)] uppercase">
                    {understaffed ? "⚠ Low Cover" : "OK"}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="font-display text-2xl font-bold leading-none" data-testid={`shift-${sc}-headcount`}>
                      {s.headcount}
                    </div>
                    <div className="label-eyebrow mt-1">Staff</div>
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold leading-none">{s.manDays}</div>
                    <div className="label-eyebrow mt-1">Man-days</div>
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold leading-none">{s.minCoverage}</div>
                    <div className="label-eyebrow mt-1">Min/Day</div>
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold leading-none text-[#B71C1C]">{s.leaves}</div>
                    <div className="label-eyebrow mt-1">Leaves</div>
                  </div>
                </div>
              </div>
            );
          })}
          {/* Spacer when only 2 cards shown (L3) */}
          {visibleShifts.length === 2 && <div />}
        </div>
      )}

      {/* ── Roster grid sections ── */}
      {loading ? (
        <div className="mt-4 border border-[var(--border)] p-12 text-center text-xs label-eyebrow">
          Loading roster…
        </div>
      ) : !roster || teamEmployees.length === 0 ? (
        <div className="mt-4 border border-[var(--border)] p-12 text-center text-sm text-[var(--muted)]">
          No {activeTeam} employees configured.
        </div>
      ) : (
        <div className="mt-4 space-y-5" data-testid="monthly-roster-grid">
          {visibleShifts.map((sc) => {
            const emps = grouped[sc];
            return (
              <ShiftSection
                key={sc}
                shiftCode={sc}
                employees={emps || []}
                schedules={effSchedules}
                dates={roster.dates}
                shiftConfig={shiftConfig}
                coverageTarget={TEAM_COVERAGE_TARGETS[activeTeam]?.[sc]}
                canManage={canManage}
                activeTeam={activeTeam}
                dragEmpId={dragEmpId}
                setDragEmpId={setDragEmpId}
                onDropEmployee={moveEmployeeToShift}
                onCellClick={canManage ? handleCellClick : null}
                activeCellKey={activeCell ? cellKey(activeCell.empId, activeCell.date) : null}
              />
            );
          })}
          {grouped[""].length > 0 && (
            <ShiftSection
              shiftCode=""
              employees={grouped[""]}
              schedules={effSchedules}
              dates={roster.dates}
              shiftConfig={shiftConfig}
              coverageTarget={null}
              canManage={canManage}
              activeTeam={activeTeam}
              dragEmpId={dragEmpId}
              setDragEmpId={setDragEmpId}
              onDropEmployee={moveEmployeeToShift}
              onCellClick={canManage ? handleCellClick : null}
              activeCellKey={activeCell ? cellKey(activeCell.empId, activeCell.date) : null}
            />
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="mt-6 flex flex-wrap items-center gap-4 text-[11px]">
        <span className="label-eyebrow">Legend</span>
        {["WD","WO","L","Adj"].map((c) => (
          <div key={c} className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 inline-block border border-black/15" style={{ background: SHIFT_COLORS[c] }} />
            <span className="font-semibold">{c}</span>
            <span className="text-[var(--muted)]">{SHIFT_LABEL[c]}</span>
          </div>
        ))}
        <span className="text-[var(--muted)] ml-4">
          SecOps members highlighted on the team column.
        </span>
        {canManage && (
          <span className="text-[var(--brand-primary)] ml-4 font-semibold">
            Tip: Click any day cell to set WD / WO / L / Adj (or Clear), then Save. Drag a row between shift sections to reassign for {MONTHS[month - 1]} {year}.
          </span>
        )}
      </div>

      {activeCell && canManage && (
        <MonthlyCellEditor
          x={activeCell.x}
          y={activeCell.y}
          current={edits[cellKey(activeCell.empId, activeCell.date)] ?? (roster?.schedules?.[activeCell.empId]?.daily_status?.[activeCell.date] || "")}
          onPick={(code) => setCellCode(activeCell.empId, activeCell.date, code)}
          onClose={() => setActiveCell(null)}
        />
      )}

      <ImportShiftsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        year={year}
        month={month}
        monthLabel={`${MONTHS[month - 1]} ${year}`}
        onApplied={load}
      />
    </div>
  );
}

function ShiftSection({
  shiftCode, employees, schedules, dates, shiftConfig, coverageTarget,
  canManage, activeTeam, dragEmpId, setDragEmpId, onDropEmployee,
  onCellClick, activeCellKey,
}) {
  const shift = shiftConfig?.[shiftCode];
  const isUnassigned = !shift;
  const [isOver, setIsOver] = useState(false);
  const canDropHere = canManage && shiftCode !== "" && !(activeTeam === "L3" && shiftCode === "N");

  const handleDragOver = (e) => {
    if (!canDropHere) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isOver) setIsOver(true);
  };
  const handleDragLeave = () => setIsOver(false);
  const handleDrop = (e) => {
    if (!canDropHere) return;
    e.preventDefault();
    setIsOver(false);
    const empId = e.dataTransfer.getData("text/plain") || dragEmpId;
    setDragEmpId(null);
    if (empId) onDropEmployee(empId, shiftCode);
  };

  return (
    <div
      className={`border bg-white transition-all ${isOver ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/30" : "border-[var(--border)]"}`}
      data-testid={`shift-section-${shiftCode || "none"}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="px-4 py-2 text-white font-semibold uppercase tracking-wider text-xs flex items-center gap-3"
        style={{ background: isUnassigned ? "#64748B" : "var(--brand-primary)" }}
      >
        <span className="w-2.5 h-2.5 inline-block" style={{ background: shift?.color || "#94A3B8" }} />
        {isUnassigned
          ? "Unassigned (Drop here or use Reshuffle)"
          : `${shift.name} Shift · ${shift.display}`}
        {coverageTarget && (
          <span className="px-2 py-0.5 text-[9px] bg-white/20 font-mono-plex">
            Target {coverageTarget}/day
          </span>
        )}
        <span className="ml-auto opacity-70 font-mono-plex text-[10px]">
          {employees.length} resource{employees.length === 1 ? "" : "s"}
        </span>
      </div>
      {employees.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] text-[var(--muted)]">
          {canDropHere ? "Drop an employee here to assign this shift." : "No employees in this shift."}
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" data-testid={`shift-table-${shiftCode || "none"}`}>
          <thead className="bg-[var(--brand-accent)] text-white">
            <tr>
              <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider w-14 border-r border-white/10">ID</th>
              <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider w-[160px] border-r border-white/10">Name</th>
              <th className="px-2 py-2 text-center font-semibold uppercase text-[10px] tracking-wider w-[68px] border-r border-white/10">Team</th>
              <th className="px-2 py-2 text-center font-semibold uppercase text-[10px] tracking-wider w-[88px] border-r border-white/10">WO</th>
              {dates.map((d) => {
                const wkn = isWeekendIso(d);
                const dd = d.slice(-2);
                return (
                  <th
                    key={d}
                    className={`px-1 py-1 text-center font-semibold text-[10px] border-r border-white/10 ${wkn ? "bg-[var(--shift-weekend)] text-[#1F2937]" : ""}`}
                  >
                    <div className="font-mono-plex">{dd}</div>
                    <div className="opacity-60 text-[9px]">{monthDayInitial(d)}</div>
                  </th>
                );
              })}
              <th className="px-2 py-2 text-center font-semibold uppercase text-[10px] tracking-wider w-12 bg-[#1F2937]">WD</th>
              <th className="px-2 py-2 text-center font-semibold uppercase text-[10px] tracking-wider w-12 bg-[#1F2937]">L</th>
              <th className="px-2 py-2 text-center font-semibold uppercase text-[10px] tracking-wider w-12 bg-[#1F2937]">Adj</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, idx) => {
              const sched = schedules[emp.id];
              const daily = sched?.daily_status || {};
              const wo = emp.weekoff_days || [];
              let wd = 0, l = 0, adj = 0;
              dates.forEach((d) => {
                const v = daily[d];
                if (v === "WD") wd++;
                else if (v === "L") l++;
                else if (v === "Adj") { adj++; wd++; }
              });
              return (
                <tr
                  key={emp.id}
                  className={`border-t border-[var(--border)] ${idx % 2 === 1 ? "bg-[var(--surface)]/40" : ""} ${canManage ? "cursor-move hover:bg-[var(--brand-primary)]/5" : ""} ${dragEmpId === emp.id ? "opacity-40" : ""}`}
                  data-testid={`monthly-row-${emp.emp_id}`}
                  draggable={canManage}
                  onDragStart={(e) => {
                    if (!canManage) return;
                    e.dataTransfer.setData("text/plain", emp.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragEmpId(emp.id);
                  }}
                  onDragEnd={() => setDragEmpId(null)}
                >
                  <td className="px-2 py-1.5 font-mono-plex text-[11px] font-semibold border-r border-[var(--border)]">
                    {canManage && <GripVertical className="inline w-3 h-3 text-[var(--muted)] mr-0.5 align-middle" />}
                    {emp.emp_id}
                  </td>
                  <td className={`px-2 py-1.5 text-xs border-r border-[var(--border)] ${emp.is_secops ? "font-bold text-[#FF6600]" : "font-semibold"}`}>
                    {emp.name}
                  </td>
                  <td className="px-2 py-1.5 text-center border-r border-[var(--border)]">
                    <div className="inline-flex items-center gap-1">
                      <span className={`text-[9px] px-1.5 py-0.5 font-bold border
                        ${emp.is_secops
                          ? "border-[#FFB300] bg-[var(--secops-tint)] text-[#6D4C00]"
                          : "border-[var(--brand-primary)] text-[var(--brand-primary)]"}`}>
                        {emp.is_secops ? "SecOps" : "SOC"}
                      </span>
                      {emp.soc_level && (
                        <span className="text-[9px] px-1 py-0.5 font-bold border border-black/30 text-black bg-white">
                          {emp.soc_level}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono-plex text-[10px] text-center border-r border-[var(--border)]">
                    {wo.length === 2 ? `${wo[0].slice(0,3)}·${wo[1].slice(0,3)}` : "—"}
                  </td>
                  {dates.map((d) => {
                    const v = daily[d] || "";
                    const wkn = isWeekendIso(d);
                    const key = `${emp.id}__${d}`;
                    const isActive = activeCellKey === key;
                    return (
                      <td
                        key={d}
                        className={`px-0 py-0 text-center border-r border-[var(--border)] ${shiftCellClass(v)} ${wkn && !v ? "bg-[var(--shift-weekend)]" : ""}`}
                        data-testid={`monthly-cell-${emp.emp_id}-${d}`}
                      >
                        {onCellClick ? (
                          <button
                            type="button"
                            draggable={false}
                            onMouseDown={(ev) => ev.stopPropagation()}
                            onClick={(ev) => { ev.stopPropagation(); onCellClick(emp.id, d, ev); }}
                            className={`block w-full h-7 leading-7 text-[10px] font-bold cursor-pointer hover:ring-2 hover:ring-inset hover:ring-black/40 transition-shadow ${isActive ? "ring-2 ring-inset ring-black" : ""}`}
                            data-testid={`monthly-cell-btn-${emp.emp_id}-${d}`}
                            title="Click to set WD / WO / L / Adj"
                          >
                            {v || <span className="text-black/20">·</span>}
                          </button>
                        ) : (
                          <span className="block h-7 leading-7 text-[10px] font-bold">{v}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center font-bold font-mono-plex text-xs">{wd}</td>
                  <td className="px-2 py-1.5 text-center font-bold font-mono-plex text-xs text-[#B71C1C]">{l}</td>
                  <td className="px-2 py-1.5 text-center font-bold font-mono-plex text-xs text-[#0D47A1]">{adj}</td>
                </tr>
              );
            })}
          </tbody>
          {!isUnassigned && employees.length > 0 && (
            <tfoot data-testid={`shift-coverage-${shiftCode}`}>
              <tr className="bg-[var(--surface)] border-t-2 border-[var(--brand-primary)]">
                <td colSpan={4} className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-[var(--brand-primary)] border-r border-[var(--border)]">
                  Daily Coverage →
                </td>
                {dates.map((d) => {
                  let count = 0;
                  employees.forEach((emp) => {
                    const v = schedules[emp.id]?.daily_status?.[d];
                    if (v === "WD" || v === "Adj") count += 1;
                  });
                  const wkn = isWeekendIso(d);
                  const low = coverageTarget ? count < coverageTarget : count < Math.ceil(employees.length * 0.5);
                  return (
                    <td
                      key={d}
                      className={`text-center font-mono-plex text-[10px] font-bold border-r border-[var(--border)] ${wkn ? "bg-[var(--shift-weekend)]" : ""} ${low ? "text-[#B71C1C]" : "text-[var(--brand-primary)]"}`}
                      data-testid={`shift-coverage-${shiftCode}-${d}`}
                      title={`${count} of ${employees.length} working${coverageTarget ? ` (target: ${coverageTarget})` : ""}`}
                    >
                      {count}
                    </td>
                  );
                })}
                <td colSpan={3} className="bg-[#1F2937]" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}
    </div>
  );
}

function MonthlyCellEditor({ x, y, current, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 184));
  const top = Math.min(y + 4, window.innerHeight - 150);
  const OPTS = ["WD", "WO", "L", "Adj"];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} data-testid="monthly-cell-editor-backdrop" />
      <div
        className="fixed z-50 w-[172px] bg-white border border-black shadow-xl p-2"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
        data-testid="monthly-cell-editor"
      >
        <div className="grid grid-cols-2 gap-1.5 mb-1.5">
          {OPTS.map((code) => {
            const active = current === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => onPick(code)}
                data-testid={`monthly-shift-opt-${code}`}
                className={`h-9 text-[11px] font-bold border border-black/20 transition-all ${active ? "ring-2 ring-black ring-offset-1" : "hover:border-black"}`}
                style={{ background: SHIFT_COLORS[code], color: "#111" }}
              >
                {code}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onPick("")}
          data-testid="monthly-shift-opt-clear"
          className="w-full h-8 text-[10px] uppercase tracking-[0.15em] font-semibold border border-black/20 hover:bg-black hover:text-white"
        >
          Clear
        </button>
      </div>
    </>
  );
}

function ImportShiftsDialog({ open, onOpenChange, year, month, monthLabel, onApplied }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const reset = useCallback(() => {
    setRows([]); setFileName(""); setResult(null); setApplying(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  useEffect(() => { if (!open) reset(); }, [open, reset]);

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
      // Normalize column names — accept common variations
      const norm = json.map((r) => {
        const get = (keys) => {
          for (const k of Object.keys(r)) {
            const kk = k.toLowerCase().replace(/[^a-z0-9]/g, "");
            for (const target of keys) {
              if (kk === target || kk.includes(target)) return r[k];
            }
          }
          return "";
        };
        return {
          resource_name: String(get(["resourcename","resource","name"]) || "").trim(),
          emp_id: String(get(["empid","employeeid","id"]) || "").trim(),
          level: String(get(["level"]) || "").trim(),
          leave_dates: String(get(["leavedates","leavedate","dates"]) || "").trim(),
          existing_shift: String(get(["existingshift","currentshift","existing"]) || "").trim(),
          recommended_shift: String(get(["recommshift","recommendedshift","recomm","newshift","shift"]) || "").trim(),
          remarks: String(get(["remarks","note","comment"]) || "").trim(),
        };
      }).filter((r) => r.resource_name || r.emp_id);
      setRows(norm);
      if (norm.length === 0) toast.error("No usable rows found in the sheet.");
    } catch (e) {
      toast.error("Failed to read Excel file: " + (e?.message || "unknown error"));
    }
  };

  const applyImport = async () => {
    if (rows.length === 0) return;
    setApplying(true);
    try {
      const { data } = await api.post("/roster/monthly/import", { year, month, rows });
      setResult(data);
      if (data.applied > 0) {
        toast.success(`Applied ${data.applied} shift change${data.applied === 1 ? "" : "s"} to ${monthLabel}`);
        onApplied?.();
      } else {
        toast.warning("No changes applied. Check the unmatched rows below.");
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-none" data-testid="import-shifts-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[var(--brand-primary)]" />
            Import Shifts from Leave Tracker
          </DialogTitle>
          <DialogDescription>
            Upload the leave tracker Excel for <span className="font-semibold">{monthLabel}</span>.
            Expected columns: <span className="font-mono-plex">S.No, Resource Name, Level, Leave Dates, Existing Shift, Recomm Shift, Remarks</span>.
            Only rows with a recognisable <span className="font-mono-plex">Recomm Shift</span> (M/A/N or Morning/Noon/Night) will be applied.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
              data-testid="import-file-input"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-none h-9 text-xs"
              data-testid="import-choose-file"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Choose Excel file
            </Button>
            {fileName && <span className="text-xs text-[var(--muted)]" data-testid="import-file-name">{fileName} · {rows.length} row(s)</span>}
          </div>

          {rows.length > 0 && !result && (
            <div className="border border-[var(--border)] max-h-72 overflow-auto">
              <table className="w-full text-[11px]" data-testid="import-preview-table">
                <thead className="bg-[var(--surface)] sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Resource</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Level</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Existing</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Recomm</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.resource_name || r.emp_id || "row"}-${i}`} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1">{r.resource_name || r.emp_id}</td>
                      <td className="px-2 py-1 font-mono-plex">{r.level}</td>
                      <td className="px-2 py-1 font-mono-plex">{r.existing_shift}</td>
                      <td className="px-2 py-1 font-mono-plex font-bold text-[var(--brand-primary)]">{r.recommended_shift}</td>
                      <td className="px-2 py-1 text-[var(--muted)]">{r.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-primary)]">
                <CheckCircle2 className="w-4 h-4" /> Applied {result.applied} change(s)
              </div>
              {result.matched?.length > 0 && (
                <div className="border border-[var(--border)] max-h-48 overflow-auto">
                  <table className="w-full text-[11px]" data-testid="import-matched-table">
                    <thead className="bg-[var(--surface)] sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Emp ID</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Name</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Level</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">From</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.matched.map((m) => (
                        <tr key={m.employee_id || m.emp_id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1 font-mono-plex">{m.emp_id}</td>
                          <td className="px-2 py-1 font-semibold">{m.name}</td>
                          <td className="px-2 py-1 font-mono-plex">{m.soc_level}</td>
                          <td className="px-2 py-1 font-mono-plex">{m.from_shift || "—"}</td>
                          <td className="px-2 py-1 font-mono-plex font-bold text-[var(--brand-primary)]">{m.to_shift}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.unmatched?.length > 0 && (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#B71C1C]">
                    <AlertTriangle className="w-4 h-4" /> {result.unmatched.length} unmatched row(s)
                  </div>
                  <div className="border border-[#B71C1C]/30 bg-[#B71C1C]/5 max-h-40 overflow-auto">
                    <table className="w-full text-[11px]" data-testid="import-unmatched-table">
                      <thead className="bg-[#B71C1C]/10 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Resource</th>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Emp ID</th>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Recomm</th>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.unmatched.map((u, i) => (
                          <tr key={`u-${u.emp_id || u.resource_name || "x"}-${i}`} className="border-t border-[#B71C1C]/20">
                            <td className="px-2 py-1">{u.resource_name}</td>
                            <td className="px-2 py-1 font-mono-plex">{u.emp_id || "—"}</td>
                            <td className="px-2 py-1 font-mono-plex">{u.recommended_shift || "—"}</td>
                            <td className="px-2 py-1 text-[#B71C1C]">{u.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-none" data-testid="import-close">
            Close
          </Button>
          {!result && (
            <Button
              onClick={applyImport}
              disabled={rows.length === 0 || applying}
              className="rounded-none bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)]"
              data-testid="import-apply-button"
            >
              {applying ? "Applying…" : `Apply to ${monthLabel}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
