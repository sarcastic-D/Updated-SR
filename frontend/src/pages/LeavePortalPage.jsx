import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileSignature, Send, CheckCircle2, Clock, XCircle, Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function LeavePortalPage() {
  const { user: me } = useAuth();
  const isUserRole = me?.role === "user";
  const [employees, setEmployees] = useState([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [myRequests, setMyRequests] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/employees");
        setEmployees(data);
      } catch (e) { toast.error(formatApiError(e)); }
    })();
  }, []);

  // Auto-select linked employee for 'user' role
  useEffect(() => {
    if (isUserRole && me?.linked_emp_id) {
      setSelectedEmpId(me.linked_emp_id);
    }
  }, [isUserRole, me]);

  useEffect(() => {
    if (!selectedEmpId) { setMyRequests([]); return; }
    (async () => {
      try {
        const { data } = await api.get(`/leaves?emp_id=${selectedEmpId}`);
        setMyRequests(data);
      } catch (e) { toast.error(formatApiError(e)); }
    })();
  }, [selectedEmpId, submitting]);

  const selectedEmployee = employees.find((e) => e.emp_id === selectedEmpId);

  const submit = async () => {
    if (!selectedEmpId) return toast.error("Select your employee");
    if (!startDate || !endDate) return toast.error("Pick start and end dates");
    if (!reason.trim()) return toast.error("Enter a reason");

    setSubmitting(true);
    try {
      const { data } = await api.post("/leaves", {
        emp_id: selectedEmpId,
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim(),
      });
      toast.success(`Submitted: ${data.request_id}`);
      setReason("");
      setStartDate("");
      setEndDate("");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-6 md:px-10 py-8 max-w-[1200px] mx-auto">
      <div className="mb-8 anim-fade-up">
        <div className="label-eyebrow">03 · Self-Service</div>
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
          Leave Portal
        </h1>
        <p className="text-sm text-[var(--muted)] mt-2 max-w-2xl">
          Submit a leave request. Your manager will assign a replacement on approval and the
          monthly roster will auto-update.
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-8">
        {/* Form */}
        <section className="lg:col-span-3 border border-[var(--border)] bg-white" data-testid="leave-form">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-[var(--brand-primary)]" />
            <span className="text-sm font-semibold uppercase tracking-wider">New Leave Request</span>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <Label className="label-eyebrow">Your Identity</Label>
              <Select value={selectedEmpId} onValueChange={setSelectedEmpId} disabled={isUserRole}>
                <SelectTrigger className="mt-2 h-11 rounded-none disabled:bg-[var(--surface)]" data-testid="leave-employee-select">
                  <SelectValue placeholder="Select employee…" />
                </SelectTrigger>
                <SelectContent className="rounded-none max-h-72">
                  {employees.map((e) => (
                    <SelectItem key={e.emp_id} value={e.emp_id}>
                      {e.name} · {e.emp_id} · {e.is_secops ? "SecOps" : "SOC"}{e.soc_level ? ` · ${e.soc_level}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isUserRole && !me?.linked_emp_id && (
                <div className="mt-2 text-xs text-[#B71C1C]" data-testid="no-linked-employee-warning">
                  Your account is not linked to an employee. Ask an admin to link you.
                </div>
              )}
              {selectedEmployee && (
                <div className="mt-2 text-xs font-mono-plex text-[var(--muted)]">
                  {selectedEmployee.email}
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="label-eyebrow">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-2 h-11 rounded-none focus-visible:ring-0"
                  data-testid="leave-start-date"
                />
              </div>
              <div>
                <Label className="label-eyebrow">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-2 h-11 rounded-none focus-visible:ring-0"
                  data-testid="leave-end-date"
                />
              </div>
            </div>

            <div>
              <Label className="label-eyebrow">Reason</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief reason for leave…"
                rows={4}
                className="mt-2 rounded-none focus-visible:ring-0 resize-none"
                data-testid="leave-reason"
              />
            </div>

            {/* Info banner replacing the old replacement selector */}
            <div className="flex items-start gap-3 p-3 border border-[var(--shift-adj)] bg-[var(--shift-adj)]/30">
              <Info className="w-4 h-4 mt-0.5 text-[#0D47A1] shrink-0" />
              <p className="text-xs text-[#0D47A1] leading-relaxed">
                <span className="font-semibold">Note:</span> Your manager will assign a replacement
                from the available team when reviewing this request. You do not need to nominate one.
              </p>
            </div>

            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full h-11 rounded-none bg-[var(--brand-primary)] hover:bg-[var(--brand-accent)] text-white font-semibold"
              data-testid="leave-submit-button"
            >
              <Send className="w-4 h-4 mr-2" />
              {submitting ? "Submitting…" : "Submit Leave Request"}
            </Button>
          </div>
        </section>

        {/* My requests */}
        <section className="lg:col-span-2 border border-[var(--border)] bg-white" data-testid="my-requests-panel">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
            <span className="text-sm font-semibold uppercase tracking-wider">My Recent Requests</span>
          </div>
          <div className="p-2 max-h-[600px] overflow-y-auto">
            {!selectedEmpId ? (
              <p className="text-xs text-[var(--muted)] p-4 text-center">
                Select your identity to view your requests.
              </p>
            ) : myRequests.length === 0 ? (
              <p className="text-xs text-[var(--muted)] p-4 text-center">
                No requests yet.
              </p>
            ) : (
              myRequests.map((r) => (
                <div
                  key={r.id}
                  className="m-2 border border-[var(--border)] p-3"
                  data-testid={`my-request-${r.request_id}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono-plex text-[10px] text-[var(--muted)]">{r.request_id}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="font-semibold">
                      {r.start_date} → {r.end_date}
                    </div>
                    {r.replacement_name ? (
                      <div className="text-[var(--muted)]">↻ Replacement: {r.replacement_name}</div>
                    ) : (
                      <div className="text-[var(--muted)] italic">Replacement to be assigned by manager</div>
                    )}
                    <div className="text-[var(--muted)] line-clamp-2">{r.reason}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  if (status === "APPROVED")
    return (
      <Badge className="bg-[var(--shift-wd)] text-[#1B5E20] hover:bg-[var(--shift-wd)] rounded-none border border-[#2E7D32]/30 font-mono-plex text-[10px]">
        <CheckCircle2 className="w-3 h-3 mr-1" /> APPROVED
      </Badge>
    );
  if (status === "REJECTED")
    return (
      <Badge className="bg-[var(--shift-l)] text-[#B71C1C] hover:bg-[var(--shift-l)] rounded-none border border-[#B71C1C]/30 font-mono-plex text-[10px]">
        <XCircle className="w-3 h-3 mr-1" /> REJECTED
      </Badge>
    );
  return (
    <Badge className="bg-[var(--shift-wo)] text-[#6D4C00] hover:bg-[var(--shift-wo)] rounded-none border border-[#996d00]/30 font-mono-plex text-[10px]">
      <Clock className="w-3 h-3 mr-1" /> PENDING
    </Badge>
  );
}
