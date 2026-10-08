"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { askText } from "@/components/ui/ask";

interface Summary { date: string; today: number; month: number; receivable: number; overdue: number; payable7: number; cashBank: number; posToday: number; approvalsPending: number }
interface Pending { documentId: string; stepNo: number; docType: string; docTypeLabel?: string; number: string | null; title: string | null; amount: string | null; version: number; submittedAt: string | null; submittedBy: string | null; path?: string | null }

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** The owner's phone: today's numbers and approvals, one tap each. Install it from the browser menu ("Add to home screen"). */
export default function OwnerMobilePage() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["/mobile/summary"], queryFn: () => api<Summary>("/mobile/summary"), refetchInterval: 60_000 });
  const inbox = useQuery({ queryKey: ["/documents/approvals/inbox"], queryFn: () => api<Pending[]>("/documents/approvals/inbox") });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function decide(p: Pending, approve: boolean) {
    setMsg(null);
    const comment = approve ? null : await askText("Why are you rejecting it?");
    if (!approve && !comment) return;
    try {
      await api(`/documents/${p.documentId}/${approve ? "approve" : "reject"}`, { body: { version: p.version, ...(comment ? { comment } : {}) } });
      setMsg({ tone: "success", text: `${p.number ?? "Document"} ${approve ? "approved" : "rejected"}.` });
      qc.invalidateQueries({ queryKey: ["/documents/approvals/inbox"] });
      qc.invalidateQueries({ queryKey: ["/mobile/summary"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const d = s.data;
  const tiles: [string, string, string?][] = d
    ? [
        ["Sales today", inr(d.today), d.posToday ? `incl. counter ${inr(d.posToday)}` : undefined],
        ["Sales this month", inr(d.month)],
        ["To collect", inr(d.receivable), d.overdue ? `${inr(d.overdue)} overdue` : undefined],
        ["To pay in 7 days", inr(d.payable7)],
        ["Cash and bank", inr(d.cashBank)],
        ["Approvals waiting", String(d.approvalsPending)],
      ]
    : [];
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-lg font-semibold">Today</h1>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(([label, value, note]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            {note && <p className="text-xs text-warning">{note}</p>}
          </Card>
        ))}
      </div>
      <h2 className="pt-2 text-sm font-semibold">Waiting for you</h2>
      <div className="space-y-2">
        {inbox.data?.map((p) => (
          <Card key={`${p.documentId}-${p.stepNo}`} className="space-y-2 p-3 text-sm">
            <p className="flex items-center gap-2"><Badge>{p.docTypeLabel ?? p.docType}</Badge><span className="font-medium">{p.number ?? "Draft"}</span>{p.amount && <span className="ml-auto tabular-nums">{inr(Number(p.amount))}</span>}</p>
            {p.title && <p className="text-muted">{p.title}</p>}
            <p className="text-xs text-muted">{p.submittedBy ? `${p.submittedBy} · ` : ""}{timeAgo(p.submittedAt)}</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => decide(p, true)}>Approve</Button>
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => decide(p, false)}>Reject</Button>
              {p.path && <Link className="inline-flex h-8 items-center px-2 text-xs text-primary" href={p.path}>Open</Link>}
            </div>
          </Card>
        ))}
        {inbox.data && !inbox.data.length && <Card className="p-4 text-center text-sm text-muted">Nothing waiting. 🎉</Card>}
      </div>
    </div>
  );
}
