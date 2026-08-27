import React, { useEffect, useState, useRef, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Pencil, Trash2, Users, Shuffle, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { SOC_SHIFTS } from "@/lib/shifts";
import { useAuth } from "@/context/AuthContext";
import * as XLSX from "xlsx-js-style";

export default function EmployeesPage() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === "admin";
  const canManage = me?.role === "admin" || me?.role === "manager";
  const [employees, setEmployees] = useState([]);
  const [userMap, setUserMap] = useState({}); // employee email -> system username
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", emp_id: "", email: "", is_secops: false, soc_level: "" });
  const [reshuffling, setReshuffling] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [empRes, userRes] = await Promise.all([
        api.get("/employees"),
        isAdmin ? api.get("/users") : Promise.resolve({ data: [] }),
      ]);
      setEmployees(empRes.data);
      // Match users to employees by email
      const map = {};
      (userRes.data || []).forEach((u) => {
        if (u.email) map[u.email.toLowerCase()] = u.name;
      });
      setUserMap(map);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({
      name: emp.name, emp_id: emp.emp_id, email: emp.email,
      is_secops: !!emp.is_secops, soc_level: emp.soc_level || "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.emp_id.trim() || !form.email.trim()) {
      toast.error("Name, Employee ID and Email are required");
      return;
    }
    const payload = { ...form };
    if (!isAdmin) delete payload.soc_level;
    try {
      await api.patch(`/employees/${editing.id}`, payload);
      toast.success("Employee updated");
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const remove = async (emp) => {
    try {
      await api.delete(`/employees/${emp.id}`);
      toast.success(`Removed ${emp.name} and their linked user account`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const reshuffle = async () => {
    setReshuffling(true);
    try {
      await api.post("/roster/monthly/reshuffle");
      toast.success("Shifts & week-offs re-assigned");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setReshuffling(false);
    }
  };

  const filtered = employees.filter((e) => {
    if (filter === "SECOPS" && !e.is_secops) return false;
    if (filter === "SOC" && e.is_secops) return false;
    if (levelFilter !== "ALL" && (e.soc_level || "") !== levelFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const username = userMap[(e.email || "").toLowerCase()] || "";
    return (
      e.name.toLowerCase().includes(q) ||
      e.emp_id.toLowerCase().includes(q) ||
      (e.email || "").toLowerCase().includes(q) ||
      username.toLowerCase().includes(q)
    );
  });

  const counts = {
    SOC: employees.filter((e) => !e.is_secops).length,
    SECOPS: employees.filter((e) => e.is_secops).length,
    total: employees.length,
  };

  return (
    <div className="px-6 md:px-10 py-8 max-w-[1500px] mx-auto">

      {/* Header */}
      <div className="flex items-end justify-between mb-8 anim-fade-up gap-4 flex-wrap">
        <div>
          <div className="label-eyebrow">02 · Workforce</div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
            Employees
          </h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            {counts.total} total · {counts.SOC} SOC · {counts.SECOPS} SecOps
            <span className="ml-3 text-[var(--muted)] text-[11px]">
              — Add employees via <strong>Users &amp; Roles → Add User</strong>
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button
              onClick={() => setImportOpen(true)}
              variant="outline"
              className="rounded-none h-11 border-[var(--border)] hover:bg-[var(--brand-primary)] hover:text-white"
              data-testid="import-analysts-button"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import Analysts
            </Button>
          )}
          <Button
            onClick={reshuffle}
            disabled={reshuffling || employees.length === 0}
            variant="outline"
            className="rounded-none h-11 border-[var(--border)] hover:bg-[var(--brand-primary)] hover:text-white"
            data-testid="reshuffle-button"
          >
            <Shuffle className="w-4 h-4 mr-2" />
            {reshuffling ? "Re-assigning…" : "Reshuffle Shifts"}
          </Button>
        </div>
      </div>

      <ImportAnalystsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        isAdmin={isAdmin}
        onImported={load}
      />

      {/* Edit Employee Dialog — opens via row edit button only */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-none border-[var(--border)]" data-testid="employee-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Edit Employee</DialogTitle>
            <DialogDescription>
              Update team member details. Shift and week-off assignments are managed via Reshuffle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="label-eyebrow">Full Name / Alias</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-2 h-11 rounded-none focus-visible:ring-0"
                data-testid="employee-name-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="label-eyebrow">Employee ID</Label>
                <Input
                  value={form.emp_id}
                  onChange={(e) => setForm({ ...form, emp_id: e.target.value })}
                  className="mt-2 h-11 rounded-none focus-visible:ring-0"
                  data-testid="employee-id-input"
                />
              </div>
              <div>
                <Label className="label-eyebrow">Team</Label>
                <Select
                  value={form.is_secops ? "SECOPS" : "SOC"}
                  onValueChange={(v) => setForm({ ...form, is_secops: v === "SECOPS" })}
                >
                  <SelectTrigger className="mt-2 h-11 rounded-none" data-testid="employee-team-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none">
                    <SelectItem value="SOC">SOC</SelectItem>
                    <SelectItem value="SECOPS">SecOps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="label-eyebrow">
                SOC Level {!isAdmin && <span className="text-[10px] text-[var(--muted)] normal-case ml-2">(Admin only)</span>}
              </Label>
              <Select
                value={form.soc_level || "__none__"}
                onValueChange={(v) => setForm({ ...form, soc_level: v === "__none__" ? "" : v })}
                disabled={!isAdmin}
              >
                <SelectTrigger className="mt-2 h-11 rounded-none disabled:bg-[var(--surface)]" data-testid="employee-level-select">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  <SelectItem value="__none__">— None —</SelectItem>
                  <SelectItem value="L1">L1 · Tier 1 Analyst</SelectItem>
                  <SelectItem value="L2">L2 · Tier 2 Analyst</SelectItem>
                  <SelectItem value="L3">L3 · Senior / Lead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="label-eyebrow">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-2 h-11 rounded-none focus-visible:ring-0"
                data-testid="employee-email-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}
              className="rounded-none" data-testid="employee-cancel-button">
              Cancel
            </Button>
            <Button onClick={save}
              className="rounded-none bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)] font-semibold"
              data-testid="employee-save-button">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <Input
          placeholder="Search by name, username or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 max-w-xs rounded-none focus-visible:ring-0"
          data-testid="employee-search-input"
        />
        <div className="flex border border-[var(--border)]">
          {[{ k: "ALL", l: "All" }, { k: "SOC", l: "SOC" }, { k: "SECOPS", l: "SecOps" }].map(({ k, l }) => (
            <button key={k} onClick={() => setFilter(k)} data-testid={`team-filter-${k.toLowerCase()}`}
              className={`px-4 h-10 text-xs font-semibold tracking-wide uppercase transition-colors
                ${filter === k ? "bg-[var(--brand-primary)] text-white" : "bg-white hover:bg-[var(--surface)]"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex border border-[var(--border)]">
          {["ALL", "L1", "L2", "L3"].map((k) => (
            <button key={k} onClick={() => setLevelFilter(k)} data-testid={`level-filter-${k.toLowerCase()}`}
              className={`px-3 h-10 text-xs font-semibold tracking-wide uppercase transition-colors
                ${levelFilter === k ? "bg-black text-white" : "bg-white hover:bg-[var(--surface)]"}`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-[var(--border)]" data-testid="employees-table">
        <div className="grid grid-cols-12 bg-[var(--brand-primary)] text-white text-[11px] font-semibold uppercase tracking-wider">
          <div className="col-span-1 px-3 py-3">#</div>
          <div className="col-span-2 px-3 py-3">Username</div>
          <div className="col-span-2 px-3 py-3">Name</div>
          <div className="col-span-1 px-3 py-3">Team</div>
          <div className="col-span-1 px-3 py-3">Level</div>
          <div className="col-span-1 px-3 py-3">Shift</div>
          <div className="col-span-2 px-3 py-3">Week-off</div>
          <div className="col-span-1 px-3 py-3">Email</div>
          <div className="col-span-1 px-3 py-3 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center" data-testid="employees-empty-state">
            <Users className="w-10 h-10 mx-auto text-[var(--muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--muted)]">No employees yet</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              Go to <strong>Users &amp; Roles</strong> and click <strong>Add User</strong> to create employees.
            </p>
          </div>
        ) : (
          filtered.map((e, idx) => {
            const shiftInfo = SOC_SHIFTS[e.assigned_shift];
            const wo = e.weekoff_days || [];
            const username = userMap[(e.email || "").toLowerCase()];
            return (
              <div key={e.id}
                className="grid grid-cols-12 items-center border-t border-[var(--border)] hover:bg-[var(--surface)] transition-colors text-sm"
                data-testid={`employee-row-${e.emp_id}`}>
                <div className="col-span-1 px-3 py-3 font-mono-plex text-xs text-[var(--muted)]">
                  {String(idx + 1).padStart(2, "0")}
                </div>
                <div className="col-span-2 px-3 py-3">
                  {username ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-[var(--brand-primary)] text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                        {username.charAt(0).toUpperCase()}
                      </span>
                      <span className="font-semibold text-xs text-[var(--brand-primary)] truncate">{username}</span>
                    </span>
                  ) : <span className="text-[var(--muted)] text-xs">—</span>}
                </div>
                <div className="col-span-2 px-3 py-3 font-semibold">{e.name}</div>
                <div className="col-span-1 px-3 py-3">
                  <span className={`text-[10px] px-1.5 py-0.5 font-bold border
                    ${e.is_secops
                      ? "border-[#FFB300] bg-[var(--secops-tint)] text-[#6D4C00]"
                      : "border-[var(--brand-primary)] text-[var(--brand-primary)] bg-white"}`}>
                    {e.is_secops ? "SecOps" : "SOC"}
                  </span>
                </div>
                <div className="col-span-1 px-3 py-3">
                  {e.soc_level
                    ? <span className="text-[10px] px-1.5 py-0.5 font-bold border border-black/40">{e.soc_level}</span>
                    : <span className="text-[var(--muted)] text-xs">—</span>}
                </div>
                <div className="col-span-1 px-3 py-3">
                  {shiftInfo ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: shiftInfo.color }} />
                      {shiftInfo.name}
                    </span>
                  ) : <span className="text-[var(--muted)] text-xs">—</span>}
                </div>
                <div className="col-span-2 px-3 py-3 font-mono-plex text-xs">
                  {wo.length === 2 ? `${wo[0].slice(0, 3)} · ${wo[1].slice(0, 3)}` : "—"}
                </div>
                <div className="col-span-1 px-3 py-3 text-xs text-[var(--muted)] truncate">{e.email}</div>
                <div className="col-span-1 px-3 py-3 flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(e)}
                    className="rounded-none h-8 w-8 p-0 hover:bg-[var(--brand-primary)] hover:text-white"
                    data-testid={`edit-employee-${e.emp_id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost"
                        className="rounded-none h-8 w-8 p-0 hover:bg-[#DA291C] hover:text-white"
                        data-testid={`delete-employee-${e.emp_id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-none">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {e.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the employee, all their roster entries,
                          and their linked user account ({username || e.email}).
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(e)}
                          className="rounded-none bg-[#DA291C] hover:bg-[#b3221a]"
                          data-testid={`confirm-delete-${e.emp_id}`}>
                          Delete Both
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ImportAnalystsDialog({ open, onOpenChange, isAdmin, onImported }) {
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
        const secRaw = String(get(["secops","team","issecops"]) || "").trim().toLowerCase();
        return {
          name: String(get(["analystname","resourcename","name","fullname"]) || "").trim(),
          emp_id: String(get(["empid","employeeid","id"]) || "").trim(),
          email: String(get(["email","mail","emailid"]) || "").trim(),
          level: String(get(["level","soclevel","tier"]) || "").trim(),
          is_secops: ["yes","y","true","1","secops"].includes(secRaw),
        };
      }).filter((r) => r.name);
      setRows(norm);
      if (norm.length === 0) toast.error("No usable rows found. Make sure the sheet has a 'Name' or 'Analyst Name' column.");
    } catch (e) {
      toast.error("Failed to read Excel: " + (e?.message || "unknown error"));
    }
  };

  const applyImport = async () => {
    if (rows.length === 0) return;
    setApplying(true);
    try {
      const { data } = await api.post("/employees/import", { rows });
      setResult(data);
      if (data.created_count > 0) {
        toast.success(`Imported ${data.created_count} analyst${data.created_count === 1 ? "" : "s"}`);
        onImported?.();
      } else {
        toast.warning("No analysts imported. Check the skipped rows below.");
      }
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-none" data-testid="import-analysts-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[var(--brand-primary)]" />
            Import Analysts from Excel
          </DialogTitle>
          <DialogDescription>
            Upload a sheet with your analysts. Recognised columns:
            <span className="font-mono-plex ml-1">Analyst Name / Name, Emp ID (optional), Email (optional), Level (L1/L2/L3), SecOps (Yes/No)</span>.
            Missing Emp IDs are auto-assigned (E001, E002…), missing emails get a placeholder. L3 analysts are automatically given Sat/Sun off.
            {!isAdmin && <span className="block mt-1 text-[10px] text-[#B71C1C]">Note: managers cannot set Level — only admins can. Levels in the sheet will still be accepted.</span>}
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
              data-testid="import-analysts-file-input"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-none h-9 text-xs"
              data-testid="import-analysts-choose-file"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Choose Excel file
            </Button>
            {fileName && (
              <span className="text-xs text-[var(--muted)]" data-testid="import-analysts-file-name">
                {fileName} · {rows.length} row(s)
              </span>
            )}
          </div>

          {rows.length > 0 && !result && (
            <div className="border border-[var(--border)] max-h-72 overflow-auto">
              <table className="w-full text-[11px]" data-testid="import-analysts-preview">
                <thead className="bg-[var(--surface)] sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Name</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Emp ID</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Email</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Level</th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.name}-${r.emp_id || i}`} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1 font-semibold">{r.name}</td>
                      <td className="px-2 py-1 font-mono-plex text-[var(--muted)]">{r.emp_id || "(auto)"}</td>
                      <td className="px-2 py-1 text-[var(--muted)]">{r.email || "(auto)"}</td>
                      <td className="px-2 py-1 font-mono-plex">{r.level || "—"}</td>
                      <td className="px-2 py-1 font-mono-plex">{r.is_secops ? "SecOps" : "SOC"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-primary)]">
                <CheckCircle2 className="w-4 h-4" /> Created {result.created_count} analyst(s)
              </div>
              {result.created?.length > 0 && (
                <div className="border border-[var(--border)] max-h-48 overflow-auto">
                  <table className="w-full text-[11px]" data-testid="import-analysts-created">
                    <thead className="bg-[var(--surface)] sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Emp ID</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Name</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Email</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Level</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Shift</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Week-off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.created.map((c) => (
                        <tr key={c.emp_id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1 font-mono-plex font-semibold">{c.emp_id}</td>
                          <td className="px-2 py-1 font-semibold">{c.name}</td>
                          <td className="px-2 py-1 text-[var(--muted)]">{c.email}</td>
                          <td className="px-2 py-1 font-mono-plex">{c.soc_level || "—"}</td>
                          <td className="px-2 py-1 font-mono-plex">{c.assigned_shift}</td>
                          <td className="px-2 py-1 font-mono-plex text-[var(--muted)]">
                            {c.weekoff_days?.map((d) => d.slice(0,3)).join("·")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.skipped?.length > 0 && (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#B71C1C]">
                    <AlertTriangle className="w-4 h-4" /> {result.skipped.length} row(s) skipped
                  </div>
                  <div className="border border-[#B71C1C]/30 bg-[#B71C1C]/5 max-h-40 overflow-auto">
                    <table className="w-full text-[11px]" data-testid="import-analysts-skipped">
                      <thead className="bg-[#B71C1C]/10 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Row</th>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Name</th>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Emp ID</th>
                          <th className="px-2 py-1 text-left font-semibold uppercase">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.skipped.map((s) => (
                          <tr key={`skip-${s.row}-${s.name || s.emp_id || "x"}`} className="border-t border-[#B71C1C]/20">
                            <td className="px-2 py-1 font-mono-plex">{s.row}</td>
                            <td className="px-2 py-1">{s.name || "—"}</td>
                            <td className="px-2 py-1 font-mono-plex">{s.emp_id || "—"}</td>
                            <td className="px-2 py-1 text-[#B71C1C]">{s.reason}</td>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-none" data-testid="import-analysts-close">
            Close
          </Button>
          {!result && (
            <Button
              onClick={applyImport}
              disabled={rows.length === 0 || applying}
              className="rounded-none bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)]"
              data-testid="import-analysts-apply"
            >
              {applying ? "Importing…" : `Import ${rows.length} analyst${rows.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
