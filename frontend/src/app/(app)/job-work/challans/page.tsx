"use client";

import { DocList } from "@/components/documents/doc-list";
import { formatDate, formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { JW } from "@/lib/jobwork";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  jobWorker: { name: string };
  process: string;
  totalValue: string;
  pendingQty: string;
  dueBy: string | null;
  daysToDue: number | null;
  ewayBillNo: string | null;
}

export default function ChallansPage() {
  return (
    <DocList<Row>
      title="Job-work challans"
      description="Material sent to job workers for processing. It stays your stock and must come back within 1 year (inputs) or 3 years (capital goods)."
      apiPath={JW.challans}
      route={JW.challans}
      queryKey={JW.challans}
      newHref={`${JW.challans}/new`}
      newLabel="Send material"
      newPermission="jobwork.challans.manage"
      searchPlaceholder="Number, job worker or process"
      empty={{ title: "No challans", description: "Send material to a job worker for plating, machining, painting…" }}
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "open", label: "At job workers", query: { pending: "true" } },
        { value: "draft", label: "Drafts", query: { status: "draft" } },
        { value: "completed", label: "Settled", query: { status: "completed" } },
      ]}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Job worker", render: (r) => r.jobWorker.name },
        { label: "Process", render: (r) => <span className="block max-w-48 truncate">{r.process}</span> },
        { label: "Value", align: "right", render: (r) => formatMoney(r.totalValue) },
        { label: "Still out", align: "right", render: (r) => (Number(r.pendingQty) > 0 ? formatQty(r.pendingQty) : "—") },
        {
          label: "Due back",
          render: (r) =>
            r.dueBy && r.daysToDue !== null ? (
              <span className={r.daysToDue < 30 ? "text-danger" : ""}>
                {formatDate(r.dueBy)}
                <span className="block text-xs text-muted">{r.daysToDue < 0 ? `${-r.daysToDue} days late` : `${r.daysToDue} days left`}</span>
              </span>
            ) : (
              "—"
            ),
        },
      ]}
    />
  );
}
