"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardPen, Fingerprint, LogOut, Receipt, Target, Wallet } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/documents";
import { HR } from "@/lib/hr";
import { inr, monthLabel } from "@/lib/payroll";

interface Home {
  employee: { id: string; code: string; fullName: string } | null;
  today?: string;
  day?: { status: string; workedMinutes: number } | null;
  punches?: number;
  leave?: { code: string; name: string; balance: number }[];
  mine?: { leave: number; claims: number; regularisations: number };
  team?: { members: number; leave: number; claims: number; regularisations: number; interviews: number; goals: number };
  onLeave?: { fullName: string; typeCode: string; until: string }[];
  payslip?: { id: string; month: string; net: string } | null;
}

const LINKS = [
  { href: `${HR}/punch`, label: "Punch in / out", icon: Fingerprint },
  { href: `${HR}/leave`, label: "Leave", icon: CalendarDays },
  { href: `${HR}/regularisations`, label: "Regularise a day", icon: ClipboardPen },
  { href: `${HR}/claims`, label: "Expense claims", icon: Receipt },
  { href: "/payroll/my", label: "Payslips & tax", icon: Wallet },
  { href: `${HR}/performance`, label: "Goals", icon: Target },
  { href: `${HR}/separations`, label: "Resignation", icon: LogOut },
];

/** Employee and manager self-service home. */
export default function MyHrPage() {
  const q = useQuery({ queryKey: [HR, "home"], queryFn: () => api<Home>(`${HR}/home`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const h = q.data!;
  if (!h.employee) return <div className="mx-auto max-w-3xl space-y-6"><PageHeader title="My HR" /><p className="text-sm text-muted">Your login is not linked to an employee record. Ask HR to link it on your employee profile.</p></div>;
  const t = h.team!;
  const queue = [
    { n: t.leave, label: "leave applications", href: `${HR}/leave` },
    { n: t.regularisations, label: "attendance corrections", href: `${HR}/regularisations` },
    { n: t.claims, label: "expense claims", href: `${HR}/claims` },
    { n: t.goals, label: "goals to rate", href: `${HR}/performance` },
    { n: t.interviews, label: "interviews awaiting your feedback", href: `${HR}/recruitment` },
  ].filter((x) => x.n > 0);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`Hello, ${h.employee.fullName.split(" ")[0]}`} description={`${h.employee.code} · ${formatDate(h.today!)}`} />
      <div className="grid gap-3 sm:grid-cols-4">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium hover:bg-surface-muted"><l.icon className="size-4 text-primary" aria-hidden /> {l.label}</Link>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader title="Today" />
          <p className="border-t border-border px-5 py-4 text-sm">{h.day ? <><Badge>{h.day.status.replace("_", " ")}</Badge> {Math.floor(h.day.workedMinutes / 60)}h {h.day.workedMinutes % 60}m</> : h.punches ? `${h.punches} punch(es) so far` : "Not punched in yet"}</p>
        </Card>
        <Card>
          <CardHeader title="Leave balance" />
          <ul className="space-y-1 border-t border-border px-5 py-3 text-sm">{h.leave!.map((l) => <li key={l.code} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{l.balance}</span></li>)}{!h.leave!.length && <li className="text-muted">No leave types yet.</li>}</ul>
        </Card>
        <Card>
          <CardHeader title="Latest pay" />
          <p className="border-t border-border px-5 py-4 text-sm">{h.payslip ? <Link className="text-primary hover:underline" href={`/print/payslips/${h.payslip.id}`} target="_blank">{monthLabel(h.payslip.month)}: {inr(h.payslip.net)}</Link> : "No payslip yet."}</p>
        </Card>
      </div>
      <Card>
        <CardHeader title="My requests" />
        <p className="border-t border-border px-5 py-3 text-sm text-muted">{h.mine!.leave} leave · {h.mine!.regularisations} attendance corrections · {h.mine!.claims} claims waiting for a decision</p>
      </Card>
      {t.members > 0 && (
        <Card>
          <CardHeader title={`My team (${t.members})`} description={queue.length ? undefined : "Nothing waiting for you."} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {queue.map((x) => <li key={x.label} className="px-5 py-2"><Link className="text-primary hover:underline" href={x.href}>{x.n} {x.label}</Link></li>)}
            {h.onLeave!.length > 0 && <li className="px-5 py-2 text-muted">On leave today: {h.onLeave!.map((o) => `${o.fullName} (${o.typeCode}, till ${formatDate(o.until)})`).join(", ")}</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
