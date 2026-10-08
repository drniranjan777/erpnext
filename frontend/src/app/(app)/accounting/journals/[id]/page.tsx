"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC, type Journal } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/documents";

const J = `${ACC}/journals`;

export default function JournalPage() {
  const { id } = useParams<{ id: string }>();
  const key = [J, id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Journal>(`${J}/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: J, label: "Journal vouchers" }}
        badges={<>{d.kind !== "journal" && <Badge>{d.kind === "opening" ? "Opening" : "Reversing"}</Badge>}{d.recurrence && <Badge>Every {d.recurrence.replace("ly", "")}</Badge>}</>}
        subtitle={`${d.narration ?? ""} · ${formatMoney(d.totalDebit)}`}
        actions={<DocumentActions doc={d} apiBase={J} routeBase={J} queryKey={key} hideEdit />}
      />
      <DocStatusAlerts doc={d} approvedNote="Posted to the ledger." />
      {(d.reverseOn || d.recurrence || d.reversalOfId) && (
        <Card>
          <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
            {d.reverseOn && <Info label="Reverses on" value={formatDate(d.reverseOn)} />}
            {d.recurrence && <Info label="Repeats" value={`Every ${d.recurrence.replace("ly", "")}${d.recurUntil ? ` until ${formatDate(d.recurUntil)}` : ""}`} />}
            {d.reversalOfId && <Info label="Reversal of" value={<Link href={`${J}/${d.reversalOfId}`} className="text-primary hover:underline">Original journal</Link>} />}
          </dl>
        </Card>
      )}
      <Card>
        <CardHeader title="Entries" />
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Account</th><th className="px-4 py-2 font-medium">Party / cost centre</th><th className="px-4 py-2 text-right font-medium">Debit</th><th className="px-4 py-2 text-right font-medium">Credit</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2"><Link href={`${ACC}/ledger?accountId=${l.accountId}`} className="hover:underline"><span className="font-mono text-xs text-muted">{l.accountCode}</span> {l.accountName}</Link>{l.narration && <p className="text-xs text-muted">{l.narration}</p>}</td>
                <td className="px-4 py-2 text-muted">{[l.partyName, l.costCenter].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ""}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border font-semibold">
            <tr><td className="px-4 py-2" colSpan={2}>Total</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.totalDebit)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.totalDebit)}</td></tr>
          </tfoot>
        </table></div>
      </Card>
      {d.related.length > 0 && (
        <Card>
          <CardHeader title="Reversals and repeats" />
          <ul className="divide-y divide-border text-sm">
            {d.related.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-2">
                <Link href={`${J}/${r.id}`} className="text-primary hover:underline">{r.number ?? "Draft"}</Link>
                <span className="text-muted">{formatDate(r.docDate)}</span>
                <StatusBadge status={r.status as Journal["status"]} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Activity" />
        <div className="px-5 py-4"><ActivityFeed documentId={d.id} /></div>
      </Card>
    </div>
  );
}
