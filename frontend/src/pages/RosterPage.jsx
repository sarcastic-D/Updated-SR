import React, { useEffect, useMemo, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  startOfWeekMonday, addDays, weekDays, toISODate, formatRange,
  dayLabel, monthLabel, isWeekend,
} from "@/lib/dateUtils";
import { SHIFT_OPTIONS, SUBTYPE_OPTIONS, SHIFT_COLORS, SHIFT_LABEL, shiftCellClass } from "@/lib/shifts";
import { exportRosterXLSX } from "@/lib/exportXlsx";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  ChevronLeft, ChevronRight, Download, CalendarIcon, Save, RotateCcw,
  CircleDot, Users as UsersIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

const LEVEL_FILTERS = ["ALL", "SOC", "SECOPS"];

export default function RosterPage() {
  const [employees, setEmployees] = useState([]);
  const [monday, setMonday] = useState(startOfWeekMonday(new Date()));
  const [grid, setGrid] = useState({});
  const [originalGrid, setOriginalGrid] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calOpen, setCalOpen] = useState(false);

  const days = useMemo(() => weekDays(monday), [monday]);
  const weekStart = toISODate(monday);
  const weekEnd = toISODate(addDays(monday, 6));
  const weekRange = formatRange(monday);

  const cellKey = (empId, d) => `${empId}__${toISODate(d)}`;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, rosterRes] = await Promise.all([
        api.get("/employees"),
        api.get(`/roster?start_date=${weekStart}&end_date=${weekEnd}`),
      ]);
      setEmployees(empRes.data);
      const g = {};
      (rosterRes.data?.entries || []).forEach((e) => {
        g[`${e.employee_id}__${e.date}`] = { code: e.code, sub_type: e.sub_type || "" };
      });
      setGrid(g);
      setOriginalGrid(g);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filteredEmployees = useMemo(() => {
    if (levelFilter === "ALL") return employees;
    if (levelFilter === "SECOPS") return employees.filter((e) => e.is_secops);
    if (levelFilter === "SOC") return employees.filter((e) => !e.is_secops);
    return employees;
  }, [employees, levelFilter]);

  const setCellValue = (empId, d, patch) => {
    const k = cellKey(empId, d);
    setGrid((prev) => {
      const current = prev[k] || { code: "", sub_type: "" };
      const next = { ...current, ...patch };
      if (patch.code === "") next.sub_type = "";
      if (next.code !== "WD") next.sub_type = "";
      return { ...prev, [k]: next };
    });
  };

  const getCell = (empId, d) => grid[cellKey(empId, d)];

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(grid), ...Object.keys(originalGrid)]);
    for (const k of keys) {
      const a = grid[k] || { code: "", sub_type: "" };
      const b = originalGrid[k] || { code: "", sub_type: "" };
      if (a.code !== b.code || (a.sub_type || "") !== (b.sub_type || "")) return true;
    }
    return false;
  }, [grid, originalGrid]);

  const summary = useMemo(() => {
    const totals = { WD: 0, WO: 0, L: 0, Adj: 0 };
    filteredEmployees.forEach((emp) => {
      days.forEach((d) => {
        const c = getCell(emp.id, d);
        if (c?.code && totals[c.code] !== undefined) totals[c.code] += 1;
      });
    });
    return totals;
  }, [filteredEmployees, days, grid]);

  const onSave = async () => {
    setSaving(true);
    try {
      const entries = [];
      const keys = new Set([...Object.keys(grid), ...Object.keys(originalGrid)]);
      keys.forEach((k) => {
        const a = grid[k] || { code: "", sub_type: "" };
        const b = originalGrid[k] || { code: "", sub_type: "" };
        if (a.code !== b.code || (a.sub_type || "") !== (b.sub_type || "")) {
          const [employee_id, date] = k.split("__");
          entries.push({
            employee_id,
            date,
            code: a.code || "",
            sub_type: a.sub_type || "",
          });
        }
      });
      if (entries.length === 0) {
        toast.info("Nothing to save");
        setSaving(false);
        return;
      }
      await api.post("/roster/bulk", { entries });
      toast.success(`Saved ${entries.length} change${entries.length === 1 ? "" : "s"}`);
      setOriginalGrid({ ...grid });
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setGrid({ ...originalGrid });
    setActiveCell(null);
    toast.info("Reverted unsaved changes");
  };

  const onExport = () => {
    if (filteredEmployees.length === 0) {
      toast.error("No employees to export");
      return;
    }
    exportRosterXLSX({
      employees: filteredEmployees,
      days,
      getCell: (id, d) => grid[`${id}__${toISODate(d)}`],
      weekRangeLabel: weekRange,
    });
    toast.success("Excel exported");
  };

  const jumpToday = () => setMonday(startOfWeekMonday(new Date()));
  const prevWeek = () => setMonday(addDays(monday, -7));
  const nextWeek = () => setMonday(addDays(monday, 7));

  const todayISO = toISODate(new Date());
  const totalCells = filteredEmployees.length * 7;
  const filledCells = summary.WD + summary.WO + summary.L + summary.Adj;
  const coverage = totalCells === 0 ? 0 : Math.round((filledCells / totalCells) * 100);

  return (
    <div className="px-4 md:px-6 py-4 max-w-[1600px] mx-auto">
      {/* Toolbar Header */}
      <div className="border border-black/15 bg-white anim-fade-up">
        {/* Row 1: Breadcrumb + title + actions */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="label-eyebrow whitespace-nowrap">Operations / Roster</div>
            <div className="w-px h-4 bg-black/15" />
            <h1 className="font-display text-base font-semibold tracking-tight truncate">
              Weekly Shift Planner
            </h1>
            {dirty && (
              <span className="ml-2 inline-flex items-center gap-1.5 px-2 h-6 text-[10px] font-semibold uppercase tracking-wider bg-[#FFB600]/15 text-[#996d00] border border-[#FFB600]/40">
                <CircleDot className="w-2.5 h-2.5" /> Unsaved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={!dirty}
              className="rounded-none border-black/20 h-9 text-xs disabled:opacity-40"
              data-testid="roster-reset-button"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Revert
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={!dirty || saving}
              className="rounded-none h-9 text-xs bg-black text-white hover:bg-[#86BC25] hover:text-black font-semibold disabled:opacity-40"
              data-testid="roster-save-button"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
            <div className="w-px h-6 bg-black/15 mx-1" />
            <Button
              size="sm"
              onClick={onExport}
              variant="outline"
              className="rounded-none h-9 text-xs border-black/20 hover:bg-black hover:text-white font-semibold"
              data-testid="export-excel-button"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export XLSX
            </Button>
          </div>
        </div>

        {/* Row 2: Week nav + filter + meta */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[var(--surface)]">
          <div className="flex items-center gap-1 border border-black/15 bg-white" data-testid="week-controls">
            <Button
              variant="ghost"
              size="sm"
              onClick={prevWeek}
              className="rounded-none h-9 w-9 hover:bg-black hover:text-white"
              data-testid="prev-week-button"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none h-9 px-3 font-mono-plex text-xs tracking-wide hover:bg-black hover:text-white"
                  data-testid="week-picker-button"
                >
                  <CalendarIcon className="w-3.5 h-3.5 mr-2" />
                  {weekRange}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-none border-black/20" align="start">
                <Calendar
                  mode="single"
                  selected={monday}
                  onSelect={(d) => {
                    if (d) {
                      setMonday(startOfWeekMonday(d));
                      setCalOpen(false);
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              onClick={nextWeek}
              className="rounded-none h-9 w-9 hover:bg-black hover:text-white"
              data-testid="next-week-button"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <div className="border-l border-black/15" />
            <Button
              variant="ghost"
              size="sm"
              onClick={jumpToday}
              className="rounded-none h-9 px-3 text-[10px] uppercase tracking-[0.18em] font-semibold hover:bg-black hover:text-white"
              data-testid="today-button"
            >
              Today
            </Button>
          </div>

          <div className="flex items-center gap-3">
            {/* Level filter */}
            <div className="hidden sm:flex items-center gap-1.5 label-eyebrow">
              <UsersIcon className="w-3 h-3" /> Level
            </div>
            <div className="flex border border-black/15 bg-white">
              {LEVEL_FILTERS.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setLevelFilter(lvl)}
                  data-testid={`roster-level-${lvl.toLowerCase()}`}
                  className={`px-3 h-9 text-[10px] font-semibold tracking-[0.18em] uppercase transition-colors
                    ${levelFilter === lvl ? "bg-black text-white" : "bg-white text-black hover:bg-black/5"}`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: Metric strip */}
        <div className="grid grid-cols-2 md:grid-cols-6 border-t border-black/10" data-testid="stats-strip">
          <Metric label="Employees" value={filteredEmployees.length} mono />
          <Metric label="Coverage" value={`${coverage}%`} mono />
          <ShiftMetric code="WD" count={summary.WD} />
          <ShiftMetric code="WO" count={summary.WO} />
          <ShiftMetric code="L" count={summary.L} />
          <ShiftMetric code="Adj" count={summary.Adj} />
        </div>
      </div>

      {/* Grid */}
      <div className="mt-3">
        {loading ? (
          <div className="border border-black/15 p-12 text-center text-xs label-eyebrow">Loading roster…</div>
        ) : filteredEmployees.length === 0 ? (
          <div className="border border-black/15 p-16 text-center bg-white" data-testid="roster-empty">
            <p className="text-sm text-[var(--muted)] mb-4">
              No employees in this view. Add employees to begin scheduling.
            </p>
            <Link
              to="/employees"
              className="inline-block px-5 h-10 leading-10 bg-black text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#86BC25] hover:text-black transition-colors"
              data-testid="goto-employees-link"
            >
              Manage Employees
            </Link>
          </div>
        ) : (
          <div className="border border-black/15 bg-white">
            <div className="overflow-x-auto" data-testid="roster-grid">
              <table className="w-full border-collapse text-sm" data-testid="roster-table">
                <thead className="bg-[#0f0f10] text-white">
                  <tr>
                    <th className="px-2 py-2.5 text-left font-mono-plex font-semibold text-[10px] tracking-wider uppercase w-10 border-r border-white/10">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-[11px] uppercase tracking-wider w-[220px] border-r border-white/10">Employee</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-[11px] uppercase tracking-wider w-[110px] border-r border-white/10">Team · ID</th>
                    {days.map((d) => {
                      const wknd = isWeekend(d);
                      const isToday = toISODate(d) === todayISO;
                      return (
                        <th
                          key={toISODate(d)}
                          className={`px-2 py-2 text-center font-semibold uppercase text-[10px] tracking-wider min-w-[110px] border-r border-white/10 last:border-r-0
                            ${wknd ? "bg-black" : ""}
                            ${isToday ? "border-b-2 border-b-[#86BC25]" : ""}`}
                        >
                          <div className="flex flex-col items-center leading-tight">
                            <span className="opacity-70 text-[9px]">{dayLabel(d)}</span>
                            <span className="font-mono-plex text-sm font-bold mt-0.5">{d.getDate()}</span>
                            <span className="opacity-60 text-[9px] mt-0.5">{monthLabel(d)}</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp, rIdx) => (
                    <tr
                      key={emp.id}
                      className={`border-t border-black/10 ${rIdx % 2 === 1 ? "bg-[var(--surface)]/50" : ""}`}
                    >
                      <td className="px-2 py-1.5 font-mono-plex text-[10px] text-[var(--muted)] text-center border-r border-black/10">
                        {String(rIdx + 1).padStart(2, "0")}
                      </td>
                      <td className="px-3 py-1.5 text-sm font-medium border-r border-black/10">
                        {emp.name}
                      </td>
                      <td className="px-3 py-1.5 border-r border-black/10">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[9px] px-1.5 leading-[14px] font-bold border
                              ${emp.is_secops
                                ? "border-[#FFB300] bg-[var(--secops-tint)] text-[#6D4C00]"
                                : "border-[var(--brand-primary)] text-[var(--brand-primary)] bg-white"}`}
                          >
                            {emp.is_secops ? "SecOps" : "SOC"}
                          </span>
                          <span className="font-mono-plex text-[10px] text-[var(--muted)]">{emp.emp_id}</span>
                        </div>
                      </td>
                      {days.map((d) => {
                        const cell = getCell(emp.id, d);
                        const code = cell?.code || "";
                        const sub = cell?.sub_type || "";
                        const isActive =
                          activeCell &&
                          activeCell.empId === emp.id &&
                          toISODate(activeCell.date) === toISODate(d);
                        return (
                          <td key={toISODate(d)} className="p-0 border-l border-black/10 relative">
                            <button
                              type="button"
                              onClick={() => setActiveCell({ empId: emp.id, date: d })}
                              data-testid={`cell-${emp.emp_id}-${toISODate(d)}`}
                              className={`shift-cell w-full h-10 px-2 text-center font-bold text-[12px] tracking-wide ${shiftCellClass(code)} ${isActive ? "ring-2 ring-black ring-inset" : ""}`}
                            >
                              {code
                                ? (sub ? `${code} · ${sub[0]}` : code)
                                : <span className="text-black/25 font-normal">—</span>}
                            </button>

                            {isActive && (
                              <CellEditor
                                value={cell || { code: "", sub_type: "" }}
                                onChange={(patch) => setCellValue(emp.id, d, patch)}
                                onClose={() => setActiveCell(null)}
                                employeeName={emp.name}
                                dateLabel={`${dayLabel(d)} · ${d.getDate()} ${monthLabel(d)} ${d.getFullYear()}`}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer / Legend */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-black/10 bg-[var(--surface)]" data-testid="legend">
              <div className="flex flex-wrap items-center gap-4 text-[11px]">
                <span className="label-eyebrow">Legend</span>
                {["WD", "WO", "L", "Adj"].map((c) => (
                  <div key={c} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 inline-block border border-black/20"
                      style={{ background: SHIFT_COLORS[c] }}
                    />
                    <span className="font-semibold">{c}</span>
                    <span className="text-[var(--muted)]">{SHIFT_LABEL[c]}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] font-mono-plex text-[var(--muted)] uppercase tracking-wider">
                Click any cell to edit
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, mono }) {
  return (
    <div className="px-4 py-3 border-r border-black/10 last:border-r-0">
      <div className="label-eyebrow">{label}</div>
      <div className={`mt-1 font-bold text-2xl tracking-tight ${mono ? "font-mono-plex" : "font-display"}`}>
        {value}
      </div>
    </div>
  );
}

function ShiftMetric({ code, count }) {
  return (
    <div
      className="px-4 py-3 border-r border-black/10 last:border-r-0"
      data-testid={`stat-${code}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5"
          style={{ background: SHIFT_COLORS[code] }}
        />
        <div className="label-eyebrow">{code} · {SHIFT_LABEL[code]}</div>
      </div>
      <div className="mt-1 font-display font-bold text-2xl tracking-tight">{count}</div>
    </div>
  );
}

function CellEditor({ value, onChange, onClose, employeeName, dateLabel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1 w-64 bg-white border border-black shadow-xl p-3"
        onClick={(e) => e.stopPropagation()}
        data-testid="cell-editor"
      >
        <div className="pb-2 mb-2 border-b border-black/10">
          <div className="text-xs font-semibold truncate">{employeeName}</div>
          <div className="font-mono-plex text-[10px] text-[var(--muted)] mt-0.5">{dateLabel}</div>
        </div>

        <div className="label-eyebrow mb-2">Shift Code</div>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {SHIFT_OPTIONS.map((opt) => {
            const active = value.code === opt.code;
            const isClear = opt.code === "";
            const bg = isClear ? "transparent" : SHIFT_COLORS[opt.code];
            const fg = opt.code === "L" || opt.code === "Adj" ? "#fff" : "#000";
            return (
              <button
                key={opt.code || "clear"}
                type="button"
                onClick={() => onChange({ code: opt.code })}
                data-testid={`shift-opt-${opt.code || "clear"}`}
                className={`h-9 text-[11px] font-bold border border-black/20 transition-all
                  ${active ? "ring-2 ring-black ring-offset-1" : "hover:border-black"}`}
                style={{
                  background: bg,
                  color: isClear ? "#000" : fg,
                }}
              >
                {opt.code || "Clear"}
              </button>
            );
          })}
        </div>

        {value.code === "WD" && (
          <div>
            <div className="label-eyebrow mb-2">Shift Time</div>
            <div className="grid grid-cols-4 gap-1">
              {SUBTYPE_OPTIONS.map((s) => {
                const active = (value.sub_type || "") === s.code;
                return (
                  <button
                    key={s.code || "none"}
                    type="button"
                    onClick={() => onChange({ sub_type: s.code })}
                    data-testid={`subtype-opt-${s.code || "none"}`}
                    className={`h-8 text-[10px] font-semibold border border-black/20
                      ${active ? "bg-black text-white" : "bg-white text-black hover:bg-black/5"}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-3 w-full h-8 text-[10px] uppercase tracking-[0.2em] font-semibold border border-black/20 hover:bg-black hover:text-white"
          data-testid="cell-editor-close"
        >
          Done
        </button>
      </div>
    </>
  );
}
