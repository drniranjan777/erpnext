"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; kind: string; narration: string | null; totalDebit: string; recurrence: string | null }

const J = "/accounting/journals";

export default function JournalsPage() {
  return (
    <DocList<Row>
      title="Journal vouchers"
      description="Manual entries: accruals, provisions, opening balances, corrections. Documents (invoices, GRNs…) post by themselves."
      apiPath={J}
      route={J}
      queryKey={J}
      newHref={`${J}/new`}
      newLabel="New journal"
      newPermission="accounting.journals.manage"
      searchPlaceholder="Number or narration"
      empty={{ title: "No journals", description: "Record accruals, provisions or opening balances." }}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Narration", render: (r) => <span className="block max-w-md truncate">{r.narration ?? "—"}</span> },
        { label: "Kind", render: (r) => <>{r.kind !== "journal" && <Badge>{r.kind === "opening" ? "Opening" : "Reversing"}</Badge>}{r.recurrence && <Badge className="ml-1">Every {r.recurrence.replace("ly", "")}</Badge>}</> },
        { label: "Amount", align: "right", render: (r) => formatMoney(r.totalDebit) },
      ]}
    />
  );
}
