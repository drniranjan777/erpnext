"use client";

import { DocList } from "@/components/documents/doc-list";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";
import { JW } from "@/lib/jobwork";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  jobWorker: { name: string };
  challanNumber: string | null;
  jwChallanNo: string | null;
  jobCharges: string;
  amount: string | null;
}

export default function JobWorkReceiptsPage() {
  return (
    <DocList<Row>
      title="Job-work receipts"
      description="Processed goods and unused material back from job workers. Start one from the challan."
      apiPath={JW.receipts}
      route={JW.receipts}
      queryKey={JW.receipts}
      searchPlaceholder="Number, job worker or their challan"
      empty={{ title: "No receipts", description: "Open a job-work challan and choose “Receive back”." }}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        { label: "Job worker", render: (r) => r.jobWorker.name },
        { label: "Challan", render: (r) => <span className="font-mono">{r.challanNumber}</span> },
        { label: "Their challan", render: (r) => r.jwChallanNo ?? "—" },
        { label: "Job charges", align: "right", render: (r) => formatMoney(r.jobCharges) },
        { label: "Value received", align: "right", render: (r) => (r.amount ? formatMoney(r.amount) : "—") },
      ]}
    />
  );
}
