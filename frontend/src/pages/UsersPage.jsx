import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ShieldCheck, Users as UsersIcon, BadgeCheck, KeyRound, RefreshCw, Copy, Eye, EyeOff, Image as ImageIcon, Upload } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const ROLE_TINTS = {
  admin:   "border-[#B71C1C] text-[#B71C1C]",
  manager: "border-[var(--brand-primary)] text-[var(--brand-primary)]",
  user:    "border-black/40 text-black",
};

const SOC_LEVEL_LABELS = {
  "":   "— None —",
  L1:   "L1 · Tier 1 Analyst",
  L2:   "L2 · Tier 2 Analyst",
  L3:   "L3 · Senior / Lead",
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [lastCreatedEmpId, setLastCreatedEmpId] = useState(null);
  const [credsOpen, setCredsOpen] = useState(false);

  // Create form includes employee fields (team + soc level)
  const blankCreate = { name: "", email: "", password: "", role: "user", is_secops: false, soc_level: "" };
  // Edit form — employee data managed via Employees page
  const blankEdit = { name: "", password: "", role: "user" };
  const [form, setForm] = useState(blankCreate);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setLastCreatedEmpId(null);
    setForm(blankCreate);
    setDialogOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setLastCreatedEmpId(null);
    setForm({ name: u.name, password: "", role: u.role });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");

    try {
      if (editing) {
        // Edit: update name, role, optional password
        if (!form.name.trim()) return;
        const payload = { name: form.name.trim(), role: form.role };
        if (form.password.trim()) payload.password = form.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success("User updated");
        setDialogOpen(false);
        load();
      } else {
        // Create: validate all fields
        if (!form.email.trim()) return toast.error("Email is required");
        if (!form.password.trim()) return toast.error("Password is required");

        const res = await api.post("/users/with-employee", {
          email:      form.email.trim().toLowerCase(),
          password:   form.password,
          name:       form.name.trim(),
          role:       form.role,
          is_secops:  form.is_secops,
          soc_level:  form.soc_level,
        });

        const empId = res.data?.emp_id;
        setLastCreatedEmpId(empId);
        toast.success(`User created! Employee ID: ${empId}`);
        load();
        // Keep dialog open briefly to show the emp_id, then close
        setTimeout(() => setDialogOpen(false), 2200);
      }
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const remove = async (u) => {
    try {
      await api.delete(`/users/${u.id}`);
      toast.success(`Removed ${u.name}`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const filtered = users.filter((u) => {
    if (filter !== "ALL" && u.role !== filter.toLowerCase()) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.linked_emp_id || "").toLowerCase().includes(q)
    );
  });

  const counts = {
    admin:   users.filter((u) => u.role === "admin").length,
    manager: users.filter((u) => u.role === "manager").length,
    user:    users.filter((u) => u.role === "user").length,
  };

  return (
    <div className="px-6 md:px-10 py-8 max-w-[1500px] mx-auto">

      {/* Header */}
      <div className="flex items-end justify-between mb-8 anim-fade-up gap-4 flex-wrap">
        <div>
          <div className="label-eyebrow flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" /> 05 · Identity &amp; Access
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
            Users &amp; Roles
          </h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            {users.length} total · {counts.admin} admin · {counts.manager} manager · {counts.user} user
          </p>
        </div>

        {/* Add User Dialog */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCredsOpen(true)}
            className="rounded-none h-11 border-[var(--border)] hover:bg-[var(--brand-primary)] hover:text-white"
            data-testid="create-credentials-button"
          >
            <KeyRound className="w-4 h-4 mr-2" />
            Create Credentials
          </Button>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setLastCreatedEmpId(null); }}>
          <DialogTrigger asChild>
            <Button
              onClick={openCreate}
              className="rounded-none h-11 bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)] font-semibold"
              data-testid="add-user-button"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>

          <DialogContent className="rounded-none border-[var(--border)] max-w-md" data-testid="user-dialog">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {editing ? `Edit ${editing.name}` : "Add New User"}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? "Update name, role or reset password. To change team/level, use the Employees page."
                  : "Creates a login account and an employee record together. An Employee ID is auto-assigned."}
              </DialogDescription>
            </DialogHeader>

            {/* Success banner — shows auto-assigned emp id after creation */}
            {lastCreatedEmpId && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-3 py-2 rounded-none text-sm">
                <BadgeCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span className="text-green-800">
                  Employee ID <span className="font-bold font-mono">{lastCreatedEmpId}</span> auto-assigned!
                </span>
              </div>
            )}

            <div className="space-y-4 pt-1">
              {/* Name */}
              <div>
                <Label className="label-eyebrow">Full Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Doe"
                  className="mt-2 h-11 rounded-none focus-visible:ring-0"
                  data-testid="user-name-input"
                />
              </div>

              {/* Email — only on create */}
              {!editing && (
                <div>
                  <Label className="label-eyebrow">Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="jane@company.com"
                    className="mt-2 h-11 rounded-none focus-visible:ring-0"
                    data-testid="user-email-input"
                  />
                </div>
              )}

              {/* Password */}
              <div>
                <Label className="label-eyebrow">
                  {editing ? "New Password (leave blank to keep)" : "Password"}
                </Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="mt-2 h-11 rounded-none focus-visible:ring-0"
                  data-testid="user-password-input"
                />
              </div>

              {/* Role */}
              <div>
                <Label className="label-eyebrow">Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger className="mt-2 h-11 rounded-none" data-testid="user-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none">
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Employee fields — only on create */}
              {!editing && (
                <>
                  <div className="border-t border-[var(--border)] pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
                      Employee Details (auto-assigned)
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Team */}
                      <div>
                        <Label className="label-eyebrow">Team</Label>
                        <Select
                          value={form.is_secops ? "SECOPS" : "SOC"}
                          onValueChange={(v) => setForm({ ...form, is_secops: v === "SECOPS" })}
                        >
                          <SelectTrigger className="mt-2 h-11 rounded-none" data-testid="user-team-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-none">
                            <SelectItem value="SOC">SOC</SelectItem>
                            <SelectItem value="SECOPS">SecOps</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {/* SOC Level */}
                      <div>
                        <Label className="label-eyebrow">SOC Level</Label>
                        <Select
                          value={form.soc_level || "__none__"}
                          onValueChange={(v) => setForm({ ...form, soc_level: v === "__none__" ? "" : v })}
                        >
                          <SelectTrigger className="mt-2 h-11 rounded-none" data-testid="user-soc-level-select">
                            <SelectValue placeholder="— None —" />
                          </SelectTrigger>
                          <SelectContent className="rounded-none">
                            <SelectItem value="__none__">— None —</SelectItem>
                            <SelectItem value="L1">L1 · Tier 1</SelectItem>
                            <SelectItem value="L2">L2 · Tier 2</SelectItem>
                            <SelectItem value="L3">L3 · Senior</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--muted)] mt-2">
                      Employee ID is auto-generated (E001, E002 …) and shown after creation.
                    </p>
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}
                className="rounded-none" data-testid="user-cancel-button">
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={!!lastCreatedEmpId}
                className="rounded-none bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)] font-semibold"
                data-testid="user-save-button"
              >
                {editing ? "Save Changes" : "Create User + Employee"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <CreateCredentialsDialog
        open={credsOpen}
        onOpenChange={setCredsOpen}
        existingUsers={users}
        onCreated={load}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <Input
          placeholder="Search by name, email or Emp ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 max-w-xs rounded-none focus-visible:ring-0"
          data-testid="user-search-input"
        />
        <div className="flex border border-[var(--border)]">
          {["ALL", "ADMIN", "MANAGER", "USER"].map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              data-testid={`role-filter-${k.toLowerCase()}`}
              className={`px-4 h-10 text-xs font-semibold tracking-wide uppercase transition-colors
                ${filter === k ? "bg-[var(--brand-primary)] text-white" : "bg-white hover:bg-[var(--surface)]"}`}
            >
              {k === "ALL" ? "All" : k.charAt(0) + k.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Branding card — admin-only */}
      {me?.role === "admin" && <BrandingCard />}

      {/* Table */}
      <div className="border border-[var(--border)]" data-testid="users-table">
        <div className="grid grid-cols-12 bg-[var(--brand-primary)] text-white text-[11px] font-semibold uppercase tracking-wider">
          <div className="col-span-1 px-3 py-3">#</div>
          <div className="col-span-3 px-3 py-3">Name</div>
          <div className="col-span-4 px-3 py-3">Email</div>
          <div className="col-span-2 px-3 py-3">Role</div>
          <div className="col-span-1 px-3 py-3">Emp ID</div>
          <div className="col-span-1 px-3 py-3 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-16 text-center" data-testid="users-empty-state">
            <UsersIcon className="w-10 h-10 mx-auto text-[var(--muted)] mb-3" />
            <p className="text-sm text-[var(--muted)]">No users match this filter.</p>
          </div>
        ) : (
          filtered.map((u, idx) => (
            <div
              key={u.id}
              className="grid grid-cols-12 items-center border-t border-[var(--border)] hover:bg-[var(--surface)] transition-colors text-sm"
              data-testid={`user-row-${u.email}`}
            >
              <div className="col-span-1 px-3 py-3 font-mono-plex text-xs text-[var(--muted)]">
                {String(idx + 1).padStart(2, "0")}
              </div>
              <div className="col-span-3 px-3 py-3">
                <div className="font-semibold leading-tight">{u.name}</div>
              </div>
              <div className="col-span-4 px-3 py-3 text-xs text-[var(--muted)] truncate">{u.email}</div>
              <div className="col-span-2 px-3 py-3">
                <span className={`text-[10px] px-1.5 py-0.5 font-bold border uppercase ${ROLE_TINTS[u.role]}`}>
                  {u.role}
                </span>
              </div>
              <div className="col-span-1 px-3 py-3">
                {u.linked_emp_id
                  ? <span className="font-mono-plex text-xs font-bold text-[var(--brand-primary)]">{u.linked_emp_id}</span>
                  : <span className="text-[var(--muted)] text-xs">—</span>}
              </div>
              <div className="col-span-1 px-3 py-3 flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(u)}
                  className="rounded-none h-8 w-8 p-0 hover:bg-[var(--brand-primary)] hover:text-white"
                  data-testid={`edit-user-${u.email}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost"
                      disabled={u.id === me?.id}
                      className="rounded-none h-8 w-8 p-0 hover:bg-[#DA291C] hover:text-white disabled:opacity-30"
                      data-testid={`delete-user-${u.email}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-none">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {u.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes the user account. The linked employee record on the Employees page will remain.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(u)}
                        className="rounded-none bg-[#DA291C] hover:bg-[#b3221a]"
                        data-testid={`confirm-delete-user-${u.email}`}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function genPassword() {
  // simple, human-typeable password: Word + 4 digits + symbol
  const words = ["Storm","Nova","Falcon","Cyber","Quartz","Onyx","Ember","Orbit","Vault","Ridge","Aurora","Zenith"];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = String(Math.floor(1000 + Math.random() * 9000));
  return `${w}@${n}`;
}

function CreateCredentialsDialog({ open, onOpenChange, existingUsers, onCreated }) {
  const [employees, setEmployees] = useState([]);
  const [loadingEmps, setLoadingEmps] = useState(false);
  const [rows, setRows] = useState([]); // { emp_id, name, email, soc_level, checked, role, password }
  const [defaultRole, setDefaultRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    setLoadingEmps(true);
    try {
      const { data } = await api.get("/employees");
      setEmployees(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoadingEmps(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSummary(null);
      load();
    }
  }, [open, load]);

  // Employees without a linked user (matched by shared email OR linked_emp_id)
  const unlinked = useMemo(() => {
    const userEmails = new Set((existingUsers || []).map((u) => (u.email || "").toLowerCase()));
    const userLinkedEmps = new Set(
      (existingUsers || []).map((u) => (u.linked_emp_id || "").toUpperCase()).filter(Boolean)
    );
    return employees.filter((e) => {
      const emailTaken = userEmails.has((e.email || "").toLowerCase());
      const empLinked = userLinkedEmps.has((e.emp_id || "").toUpperCase());
      return !emailTaken && !empLinked;
    });
  }, [employees, existingUsers]);

  // Reset rows whenever the unlinked employee list changes.
  // `defaultRole` is intentionally excluded from deps: changing the default
  // role must NOT wipe per-row role edits the admin has already made — that
  // is handled explicitly by `applyDefaultRoleToAll` below.
  useEffect(() => {
    setRows(unlinked.map((e) => ({
      emp_id: e.emp_id,
      name: e.name,
      email: e.email,
      soc_level: e.soc_level || "",
      checked: true,
      role: defaultRole,
      password: genPassword(),
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlinked]);

  const toggleAll = (val) => setRows((rs) => rs.map((r) => ({ ...r, checked: val })));
  const patchRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const applyDefaultRoleToAll = (role) => {
    setDefaultRole(role);
    setRows((rs) => rs.map((r) => ({ ...r, role })));
  };
  const regenAllPasswords = () => setRows((rs) => rs.map((r) => ({ ...r, password: genPassword() })));

  const copyAllCreds = () => {
    const lines = rows
      .filter((r) => r.checked && r.password)
      .map((r) => `${r.name}\t${r.email}\t${r.password}\t${r.role}`);
    if (!lines.length) return toast.error("No selected rows to copy");
    const header = "Name\tEmail\tPassword\tRole";
    navigator.clipboard.writeText([header, ...lines].join("\n"))
      .then(() => toast.success(`Copied ${lines.length} credential(s) to clipboard`))
      .catch(() => toast.error("Clipboard copy failed"));
  };

  const submit = async () => {
    const selected = rows.filter((r) => r.checked);
    if (selected.length === 0) return toast.error("Select at least one employee");
    const bad = selected.find((r) => !r.password || r.password.length < 4);
    if (bad) return toast.error(`Password for ${bad.name} must be at least 4 characters`);

    setSubmitting(true);
    const created = [], failed = [];
    for (const r of selected) {
      try {
        await api.post("/users", {
          email: r.email,
          password: r.password,
          name: r.name,
          role: r.role,
          linked_emp_id: r.emp_id,
        });
        created.push({ name: r.name, email: r.email, emp_id: r.emp_id, password: r.password, role: r.role });
      } catch (e) {
        failed.push({ name: r.name, email: r.email, reason: formatApiError(e) });
      }
    }
    setSummary({ created, failed });
    setSubmitting(false);
    if (created.length > 0) {
      toast.success(`Created ${created.length} credential(s)`);
      onCreated?.();
    }
    if (failed.length > 0) toast.error(`${failed.length} failed`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-none" data-testid="create-credentials-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[var(--brand-primary)]" />
            Create Login Credentials
          </DialogTitle>
          <DialogDescription>
            Employees below have no login account yet. Set a password (auto-generated by default) and role for each,
            then click <span className="font-semibold">Create</span>. Copy the credentials list before closing — passwords are stored hashed and cannot be retrieved later.
          </DialogDescription>
        </DialogHeader>

        {!summary && (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-3">
              <span className="text-xs text-[var(--muted)]">
                {loadingEmps
                  ? "Loading employees…"
                  : `${unlinked.length} employee${unlinked.length === 1 ? "" : "s"} without credentials`}
              </span>
              {rows.length > 0 && (
                <>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="label-eyebrow">Default role</span>
                    <Select value={defaultRole} onValueChange={applyDefaultRoleToAll}>
                      <SelectTrigger className="h-8 rounded-none text-xs w-28" data-testid="creds-default-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-none">
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm" variant="ghost"
                      onClick={regenAllPasswords}
                      className="rounded-none h-8 text-xs"
                      data-testid="creds-regen-all"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" /> Regenerate all
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setShowPasswords((s) => !s)}
                      className="rounded-none h-8 text-xs"
                      data-testid="creds-toggle-show"
                    >
                      {showPasswords ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                      {showPasswords ? "Hide" : "Show"} passwords
                    </Button>
                  </div>
                </>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--muted)]">
                {loadingEmps ? "…" : "All employees already have login credentials."}
              </div>
            ) : (
              <div className="border border-[var(--border)] max-h-[420px] overflow-auto">
                <table className="w-full text-[12px]" data-testid="creds-table">
                  <thead className="bg-[var(--surface)] sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 w-8">
                        <Checkbox
                          checked={rows.every((r) => r.checked)}
                          onCheckedChange={(v) => toggleAll(Boolean(v))}
                          data-testid="creds-check-all"
                        />
                      </th>
                      <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider">Emp ID</th>
                      <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider">Name</th>
                      <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider">Email</th>
                      <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider">Level</th>
                      <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider w-28">Role</th>
                      <th className="px-2 py-2 text-left font-semibold uppercase text-[10px] tracking-wider">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={r.emp_id}
                        className={`border-t border-[var(--border)] ${!r.checked ? "opacity-50" : ""}`}
                        data-testid={`creds-row-${r.emp_id}`}
                      >
                        <td className="px-2 py-1.5">
                          <Checkbox
                            checked={r.checked}
                            onCheckedChange={(v) => patchRow(i, { checked: Boolean(v) })}
                            data-testid={`creds-check-${r.emp_id}`}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono-plex font-semibold">{r.emp_id}</td>
                        <td className="px-2 py-1.5 font-semibold">{r.name}</td>
                        <td className="px-2 py-1.5 text-[var(--muted)]">{r.email}</td>
                        <td className="px-2 py-1.5 font-mono-plex">{r.soc_level || "—"}</td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={r.role}
                            onValueChange={(v) => patchRow(i, { role: v })}
                            disabled={!r.checked}
                          >
                            <SelectTrigger
                              className="h-8 rounded-none text-xs"
                              data-testid={`creds-role-${r.emp_id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-none">
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <Input
                              type={showPasswords ? "text" : "password"}
                              value={r.password}
                              onChange={(e) => patchRow(i, { password: e.target.value })}
                              disabled={!r.checked}
                              className="h-8 rounded-none text-xs font-mono-plex focus-visible:ring-0"
                              data-testid={`creds-pwd-${r.emp_id}`}
                            />
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => patchRow(i, { password: genPassword() })}
                              className="rounded-none h-8 w-8 p-0"
                              title="Regenerate password"
                              data-testid={`creds-regen-${r.emp_id}`}
                            >
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {summary && (
          <div className="space-y-3">
            {summary.created.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-primary)]">
                    <BadgeCheck className="w-4 h-4" /> Created {summary.created.length} login(s)
                  </div>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      const lines = summary.created.map((c) => `${c.name}\t${c.email}\t${c.password}\t${c.role}`);
                      navigator.clipboard.writeText(["Name\tEmail\tPassword\tRole", ...lines].join("\n"))
                        .then(() => toast.success("Credentials copied to clipboard"))
                        .catch(() => toast.error("Clipboard copy failed"));
                    }}
                    className="rounded-none h-8 text-xs"
                    data-testid="creds-copy-after-create"
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy list
                  </Button>
                </div>
                <div className="border border-[var(--border)] max-h-72 overflow-auto">
                  <table className="w-full text-[12px]" data-testid="creds-summary-table">
                    <thead className="bg-[var(--surface)] sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase text-[10px]">Emp ID</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase text-[10px]">Name</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase text-[10px]">Email</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase text-[10px]">Password</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase text-[10px]">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.created.map((c) => (
                        <tr key={c.emp_id} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1.5 font-mono-plex font-semibold">{c.emp_id}</td>
                          <td className="px-2 py-1.5 font-semibold">{c.name}</td>
                          <td className="px-2 py-1.5 text-[var(--muted)]">{c.email}</td>
                          <td className="px-2 py-1.5 font-mono-plex text-[var(--brand-primary)] font-bold">{c.password}</td>
                          <td className="px-2 py-1.5 uppercase font-mono-plex text-[10px]">{c.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-[#B71C1C]">
                  These passwords are visible only right now. Copy the list before closing — they cannot be retrieved later.
                </p>
              </>
            )}
            {summary.failed.length > 0 && (
              <>
                <div className="text-sm font-semibold text-[#B71C1C]">{summary.failed.length} failed</div>
                <div className="border border-[#B71C1C]/30 bg-[#B71C1C]/5 max-h-40 overflow-auto">
                  <table className="w-full text-[11px]" data-testid="creds-failed-table">
                    <thead className="bg-[#B71C1C]/10 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Name</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Email</th>
                        <th className="px-2 py-1 text-left font-semibold uppercase">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.failed.map((f, i) => (
                        <tr key={`fail-${f.email || f.name || "x"}-${i}`} className="border-t border-[#B71C1C]/20">
                          <td className="px-2 py-1">{f.name}</td>
                          <td className="px-2 py-1 text-[var(--muted)]">{f.email}</td>
                          <td className="px-2 py-1 text-[#B71C1C]">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {!summary && rows.length > 0 && (
            <Button
              variant="outline"
              onClick={copyAllCreds}
              className="rounded-none mr-auto"
              data-testid="creds-copy-preview"
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              Copy list
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none"
            data-testid="creds-close"
          >
            Close
          </Button>
          {!summary && rows.length > 0 && (
            <Button
              onClick={submit}
              disabled={submitting || rows.filter((r) => r.checked).length === 0}
              className="rounded-none bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-accent)]"
              data-testid="creds-submit"
            >
              {submitting
                ? "Creating…"
                : `Create ${rows.filter((r) => r.checked).length} credential${rows.filter((r) => r.checked).length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BrandingCard() {
  const [logo, setLogo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/settings/login-logo");
      setLogo(data?.data_url || null);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

  const onFile = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml|gif)$/.test(file.type)) {
      toast.error("Only PNG / JPG / WEBP / SVG / GIF images are allowed");
      return;
    }
    if (file.size > 500 * 1024) {
      toast.error("Image is too large — please pick something under 500 KB");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { data } = await api.put("/settings/login-logo", { data_url: dataUrl });
      setLogo(data.data_url);
      toast.success("Logo updated — visible on the sign-in page now");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRemove = async () => {
    if (!window.confirm("Remove the current login-page logo?")) return;
    try {
      await api.delete("/settings/login-logo");
      setLogo(null);
      toast.success("Logo removed");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  return (
    <div
      className="border border-[var(--border)] bg-white p-5 flex flex-col md:flex-row md:items-center gap-5"
      data-testid="branding-card"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 border border-[var(--border)] flex items-center justify-center bg-[var(--surface)]">
          <ImageIcon className="w-4 h-4 text-[var(--brand-primary)]" />
        </div>
        <div>
          <div className="label-eyebrow">Sign-in Page Branding</div>
          <div className="text-xs text-[var(--muted)] max-w-md">
            Upload a logo (PNG / JPG / WEBP / SVG / GIF, ≤ 500 KB). It appears below the
            "Workforce Operations" label on the sign-in page for every visitor.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 md:ml-auto">
        <div
          className="w-24 h-16 border border-[var(--border)] bg-[#0a0a0a] flex items-center justify-center overflow-hidden"
          data-testid="branding-preview"
        >
          {loading ? (
            <span className="text-[10px] text-white/40">…</span>
          ) : logo ? (
            <img src={logo} alt="Current logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[10px] text-white/40 font-mono-plex">NO LOGO</span>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg,.gif,image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
          data-testid="branding-file-input"
        />
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-none h-9 text-xs"
            data-testid="branding-upload-button"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {uploading ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
          </Button>
          {logo && (
            <Button
              variant="ghost"
              onClick={onRemove}
              className="rounded-none h-9 text-xs text-[#B71C1C] hover:bg-[#B71C1C]/10 hover:text-[#B71C1C]"
              data-testid="branding-remove-button"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

