import React, { useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Inbox, Check, X, RefreshCw, UserPlus } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/pages/LeavePortalPage";
import { SOC_SHIFTS } from "@/lib/shifts";

const TABS = [
  { key: "PENDING",  label: "Pending"  },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL",      label: "All"      },
];

export default function ApprovalsPage() {
  const [tab, setTab] = useState("PENDING");
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [approveDialog, setApproveDialog] = useState(null); // {request}
  const [replacementId, setReplacementId] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const q = tab === "ALL" ? "" : `?status=${tab}`;
      const [reqRes, empRes] = await Promise.all([
        api.get(`/leaves${q}`),
        api.get("/employees"),
      ]);
      setRequests(reqRes.data);
      setEmployees(empRes.data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  const openApprove = (req) => {
    setApproveDialog({ request: req });
    setReplacementId("");
  };

  const confirmApprove = async () => {
    if (!approveDialog) return;
    if (!replacementId) {
      toast.error("Please select a replacement employee");
      return;
    }
    const req = approveDialog.request;
    setActingId(req.id);
    try {
      await api.post(`/leaves/${req.id}/approve`, { replacement_emp_id: replacementId });
      toast.success(`Approved ${req.emp_name}'s leave`);
      setApproveDialog(null);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setActingId(null);
    }
  };

  const rejectAction = async (req) => {
    setActingId(req.id);
    try {
      await api.post(`/leaves/${req.id}/reject`);
      toast.success(`Rejected ${req.emp_name}'s request`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setActingId(null);
    }
  };

  const replacementCandidates = useMemo(() => {
    if (!approveDialog) return [];
    const reqEmpId = approveDialog.request.emp_id;
    return employees.filter((e) => e.emp_id !== reqEmpId);
  }, [approveDialog, employees]);

  const counts = {
    PENDING:  requests.filter((r) => r.status === "PENDING").length,
  };

  return (
    <div className="px-6 md:px-10 py-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8 anim-fade-up flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">04 · Manager</div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
            Leave Approvals
          </h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            Pick a replacement and approve. The roster will auto-mark{" "}
            <span className="font-semibold text-[#B71C1C]">L</span> for the employee and{" "}
            <span className="font-semibold text-[#0D47A1]">Adj</span> for the replacement.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={load}
          className="rounded-none h-10 border-[var(--border)] hover:bg-[var(--brand-primary)] hover:text-white"
          data-testid="approvals-refresh"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="flex border border-[var(--border)] mb-6 bg-white" data-testid="approvals-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-testid={`approvals-tab-${t.key.toLowerCase()}`}
            className={`flex-1 px-4 h-11 text-xs font-semibold uppercase tracking-wider transition-colors
              ${tab === t.key ? "bg-[var(--brand-primary)] text-white" : "hover:bg-[var(--surface)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="border border-[var(--border)] p-12 text-center text-xs label-eyebrow">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="border border-[var(--border)] p-16 text-center bg-white" data-testid="approvals-empty">
          <Inbox className="w-10 h-10 mx-auto text-[var(--muted)] mb-3" />
          <p className="text-sm text-[var(--muted)]">No requests in this view.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4" data-testid="approvals-list">
          {requests.map((r) => (
            <article
              key={r.id}
              className="border border-[var(--border)] bg-white p-4 hover:shadow-sm transition-shadow"
              data-testid={`approval-card-${r.request_id}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono-plex text-[10px] text-[var(--muted)]">{r.request_id}</span>
                <StatusBadge status={r.status} />
              </div>

              <div className="mb-3">
                <div className="font-display text-lg font-semibold leading-tight">{r.emp_name}</div>
                <div className="text-xs text-[var(--muted)] font-mono-plex mt-0.5">
                  {r.emp_id} · {r.email}
                </div>
              </div>

              <dl className="text-xs space-y-1.5 mb-4">
                <div className="flex">
                  <dt className="w-24 label-eyebrow">Dates</dt>
                  <dd className="font-semibold">{r.start_date} → {r.end_date}</dd>
                </div>
                <div className="flex">
                  <dt className="w-24 label-eyebrow">Reason</dt>
                  <dd className="flex-1">{r.reason}</dd>
                </div>
                <div className="flex">
                  <dt className="w-24 label-eyebrow">Replacement</dt>
                  <dd className={r.replacement_name ? "font-semibold text-[#0D47A1]" : "italic text-[var(--muted)]"}>
                    {r.replacement_name
                      ? `${r.replacement_name} · ${r.replacement_emp_id}`
                      : "To be assigned"}
                  </dd>
                </div>
                <div className="flex">
                  <dt className="w-24 label-eyebrow">Submitted</dt>
                  <dd className="font-mono-plex text-[var(--muted)]">
                    {(r.submitted_at || "").slice(0, 19).replace("T", " ")}
                  </dd>
                </div>
                {r.approved_at && (
                  <div className="flex">
                    <dt className="w-24 label-eyebrow">{r.status === "APPROVED" ? "Approved" : "Rejected"}</dt>
                    <dd className="font-mono-plex text-[var(--muted)]">
                      {(r.approved_at || "").slice(0, 19).replace("T", " ")} · {r.approved_by}
                    </dd>
                  </div>
                )}
              </dl>

              {r.status === "PENDING" && (
                <div className="flex gap-2 pt-3 border-t border-[var(--border)]">
                  <Button
                    onClick={() => openApprove(r)}
                    disabled={actingId === r.id}
                    className="flex-1 rounded-none h-9 bg-[#2E7D32] hover:bg-[#1B5E20] text-white text-xs font-semibold"
                    data-testid={`approve-${r.request_id}`}
                  >
                    <Check className="w-4 h-4 mr-1.5" />
                    Approve…
                  </Button>
                  <Button
                    onClick={() => rejectAction(r)}
                    disabled={actingId === r.id}
                    variant="outline"
                    className="flex-1 rounded-none h-9 border-[#B71C1C] text-[#B71C1C] hover:bg-[#B71C1C] hover:text-white text-xs font-semibold"
                    data-testid={`reject-${r.request_id}`}
                  >
                    <X className="w-4 h-4 mr-1.5" />
                    Reject
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {tab !== "PENDING" && counts.PENDING > 0 && (
        <div className="mt-6 p-4 bg-[var(--shift-wo)]/40 border border-[var(--shift-wo)] text-xs">
          You still have <span className="font-bold">{counts.PENDING}</span> pending request{counts.PENDING === 1 ? "" : "s"} awaiting your decision.
        </div>
      )}

      {/* Approve dialog with replacement picker */}
      <Dialog open={!!approveDialog} onOpenChange={(o) => !o && setApproveDialog(null)}>
        <DialogContent className="rounded-none" data-testid="approve-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-[var(--brand-primary)]" />
              Assign Replacement & Approve
            </DialogTitle>
            <DialogDescription>
              {approveDialog && (
                <>
                  Pick the employee who will cover{" "}
                  <strong>{approveDialog.request.emp_name}</strong>'s shifts from{" "}
                  <strong>{approveDialog.request.start_date}</strong> to{" "}
                  <strong>{approveDialog.request.end_date}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Label className="label-eyebrow">Replacement</Label>
            <Select value={replacementId} onValueChange={setReplacementId}>
              <SelectTrigger className="mt-2 h-11 rounded-none" data-testid="approve-replacement-select">
                <SelectValue placeholder="Select replacement…" />
              </SelectTrigger>
              <SelectContent className="rounded-none max-h-72">
                {replacementCandidates.map((e) => {
                  const shift = SOC_SHIFTS[e.assigned_shift];
                  return (
                    <SelectItem key={e.emp_id} value={e.emp_id}>
                      {e.name} · {e.emp_id} · {e.is_secops ? "SecOps" : "SOC"}
                      {shift ? ` · ${shift.name}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {replacementId && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                The replacement will be marked{" "}
                <span className="font-semibold text-[#0D47A1]">Adj</span> on those days in the monthly roster.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveDialog(null)}
              className="rounded-none"
              data-testid="approve-cancel-button"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmApprove}
              disabled={!replacementId || actingId}
              className="rounded-none bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-semibold"
              data-testid="approve-confirm-button"
            >
              <Check className="w-4 h-4 mr-1.5" />
              Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
