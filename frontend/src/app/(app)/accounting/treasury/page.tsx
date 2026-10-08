"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { DataTable } from "@/components/ui/data-table";

interface Row { no: number; date: string; opening: number; interest: number; principal: number; payment: number; closing: number }
interface Item { id: string; companyId: string; kind: string; number: string; bank: string; principal: number; ratePct: number; startDate: string; endDate: string; method: string | null; facilityId: string | null; marginPct: number; beneficiary: string | null; status: string; outstanding?: number; next?: Row | null; value?: number; maturityValue?: number; use?: { used: number; available: number; pct: number | null; margin: number; expiring: { number: string; endDate: string; overdue: boolean }[] }; margin?: number; daysToExpiry?: number }
interface Treasury { items: Item[]; summary: { borrowings: number; deposits: number; lcBg: number; maturing30: { id: string; kind: string; number: string; endDate: string }[] } }
interface Company { id: string; name: string }

const KIND: Record<string, string> = { loan: "Term loan", fd: "Fixed deposit", facility: "Bank facility", lc: "Letter of credit", bg: "Bank guarantee" };
const inr = (n: number | undefined) => (n === undefined ? "–" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

/** Loans, deposits, facilities, LCs and BGs. */
export default function TreasuryPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("finance.treasury.manage");
  const t = useQuery({ queryKey: ["/finance/treasury"], queryFn: () => api<Treasury>("/finance/treasury") });
  const companies = useQuery({ queryKey: ["/finance/companies"], queryFn: () => api<Company[]>("/finance/companies") });
  const [open, setOpen] = useState<string | null>(null);
  const sched = useQuery({ queryKey: ["/finance/treasury", open, "schedule"], queryFn: () => api<Row[]>(`/finance/treasury/${open}/schedule`), enabled: !!open });
  const [f, setF] = useState({ companyId: "", kind: "loan", number: "", bank: "", principal: "", ratePct: "", startDate: "", endDate: "", method: "", facilityId: "", marginPct: "", beneficiary: "" });
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: done(r) });
      qc.invalidateQueries({ queryKey: ["/finance/treasury"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const s = t.data?.summary;
  const companyId = f.companyId || companies.data?.[0]?.id || "";
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Treasury" description="Term loans with their EMI schedules, fixed deposits, non-fund facilities with the letters of credit and bank guarantees drawn on them, and the monthly interest posted to the books." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {s && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[["Borrowings outstanding", inr(s.borrowings)], ["Deposits (value today)", inr(s.deposits)], ["LC / BG outstanding", inr(s.lcBg)], ["Maturing in 30 days", String(s.maturing30.length)]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></Card>)}
        </div>
      )}
      {s && s.maturing30.length > 0 && <Alert tone="warning">Maturing soon: {s.maturing30.map((m) => `${KIND[m.kind]} ${m.number} on ${formatDate(m.endDate)}`).join("; ")}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {t.data?.items.map((i) => (
            <li key={i.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted" onClick={() => setOpen(i.kind === "loan" && open !== i.id ? i.id : null)}>
                <Badge tone={i.status === "active" ? "primary" : "neutral"}>{KIND[i.kind]}</Badge>
                <span className="font-medium">{i.number}</span>
                <span>{i.bank}</span>
                <span className="tabular-nums">{inr(i.principal)}{i.ratePct ? ` @ ${i.ratePct} %` : ""}</span>
                <span className="text-xs text-muted">
                  {formatDate(i.startDate)} → {formatDate(i.endDate)}
                  {i.kind === "loan" && ` · outstanding ${inr(i.outstanding)}${i.next ? ` · next ${inr(i.next.payment)} on ${formatDate(i.next.date)}` : ""}`}
                  {i.kind === "fd" && ` · value ${inr(i.value)} · at maturity ${inr(i.maturityValue)}`}
                  {i.kind === "facility" && i.use && ` · used ${inr(i.use.used)} (${i.use.pct ?? 0} %) · available ${inr(i.use.available)} · margin ${inr(i.use.margin)}`}
                  {(i.kind === "lc" || i.kind === "bg") && ` · margin ${inr(i.margin)}${i.beneficiary ? ` · ${i.beneficiary}` : ""} · ${i.daysToExpiry} days to expiry`}
                </span>
                {i.status !== "active" && <Badge>{i.status}</Badge>}
              </button>
              {open === i.id && sched.data && (
                <DataTable
                  rows={sched.data}
                  rowKey={(r) => String(r.no)}
                  exportName="accounting-treasury"
                  storageKey="accounting-treasury-0"
                  columns={[
                    { key: "col0", label: "#", locked: true, className: "whitespace-normal", render: (r) => <>{r.no}</> },
                    { key: "date", label: "Date", className: "whitespace-normal", render: (r) => <>{formatDate(r.date)}</> },
                    { key: "opening", label: "Opening", align: "right", render: (r) => <>{inr(r.opening)}</> },
                    { key: "interest", label: "Interest", align: "right", render: (r) => <>{inr(r.interest)}</> },
                    { key: "principal", label: "Principal", align: "right", render: (r) => <>{inr(r.principal)}</> },
                    { key: "payment", label: "Payment", align: "right", render: (r) => <>{inr(r.payment)}</> },
                    { key: "closing", label: "Closing", align: "right", render: (r) => <>{inr(r.closing)}</> },
                  ]}
                />
              )}
            </li>
          ))}
          {t.data && !t.data.items.length && <li className="px-4 py-6 text-center text-muted">Nothing recorded.</li>}
        </ul>
      </Card>
      {manage && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader title="Record an instrument" />
            <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-3">
              <Select aria-label="Company" value={companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              <Select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, method: "" })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Input aria-label="Number" placeholder="Number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
              <Input aria-label="Bank" placeholder="Bank" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} />
              <Input aria-label="Amount" type="number" min={0} placeholder={f.kind === "facility" ? "Limit ₹" : "Amount ₹"} value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} />
              {(f.kind === "loan" || f.kind === "fd") && <Input aria-label="Rate" type="number" step="0.01" placeholder="Rate % a year" value={f.ratePct} onChange={(e) => setF({ ...f, ratePct: e.target.value })} />}
              <label className="text-xs text-muted">Start<Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
              <label className="text-xs text-muted">{f.kind === "lc" || f.kind === "bg" ? "Expiry" : "End / maturity"}<Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
              {f.kind === "loan" && <Select aria-label="Repayment" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">EMI</option><option value="bullet">Bullet (interest monthly)</option></Select>}
              {f.kind === "fd" && <Select aria-label="Interest" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">Compounded quarterly</option><option value="monthly">Compounded monthly</option><option value="simple">Simple interest</option></Select>}
              {(f.kind === "lc" || f.kind === "bg") && (
                <>
                  <Select aria-label="Facility" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">No facility</option>{t.data?.items.filter((x) => x.kind === "facility" && x.status === "active").map((x) => <option key={x.id} value={x.id}>{x.number} · {x.bank}</option>)}</Select>
                  <Input aria-label="Margin" type="number" placeholder="Margin %" value={f.marginPct} onChange={(e) => setF({ ...f, marginPct: e.target.value })} />
                  <Input aria-label="Beneficiary" placeholder="Beneficiary" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} />
                </>
              )}
              <Button disabled={!companyId || !f.number || !f.bank || !Number(f.principal) || !f.startDate || !f.endDate} onClick={() => run(() => api("/finance/treasury", { body: { companyId, kind: f.kind, number: f.number, bank: f.bank, principal: Number(f.principal), ratePct: Number(f.ratePct || 0), startDate: f.startDate, endDate: f.endDate, method: f.method || null, facilityId: f.facilityId || null, marginPct: Number(f.marginPct || 0), beneficiary: f.beneficiary || null } }), () => "Recorded.")}>Record</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Post interest" description="Loan interest (expense, accrued) and deposit interest (accrued, income) for a month; each instrument once." />
            <div className="flex gap-2 border-t border-border p-4">
              <Input className="h-9" type="month" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              <Button disabled={!companyId} onClick={() => run(() => api<{ posted: { number: string; instrument: string; interest: number }[] }>("/finance/treasury/accrue", { body: { companyId, period } }), (r) => (r.posted.length ? `Posted ${r.posted.map((p) => `${p.instrument} ${inr(p.interest)} (${p.number})`).join(", ")}.` : "Nothing to post for this month."))}>Post</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
