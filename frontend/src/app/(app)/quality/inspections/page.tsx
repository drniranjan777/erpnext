"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatQty, type DocumentStatus } from "@/lib/documents";
import { QA, RESULT, STAGE, type QiResult, type Stage } from "@/lib/quality";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; stage: Stage; result: QiResult; suggestion: "accept" | "reject" | null; lotQty: string; sampleSize: number; batchNo: string | null; item: { code: string; name: string }; source: string | null }

const P = `${QA}/inspections`;

export default function InspectionsPage() {
  return (
    <DocList<Row>
      title="Inspections"
      description="Lots waiting for a decision and past results. Incoming, in-process and final inspections are raised automatically from your plans."
      apiPath={P}
      route={P}
      queryKey={P}
      newHref={`${P}/new`}
      newLabel="New inspection"
      newPermission="quality.inspections.manage"
      searchPlaceholder="Number, item or batch"
      tabs={[
        { value: "pending", label: "To inspect", query: { status: "draft" } },
        { value: "incoming", label: "Incoming", query: { stage: "incoming" } },
        { value: "in_process", label: "In-process", query: { stage: "in_process" } },
        { value: "final", label: "Final", query: { stage: "final" } },
        { value: "rejected", label: "Rejected", query: { result: "rejected" } },
        { value: "all", label: "All", query: {} },
      ]}
      empty={{ title: "No inspections", description: "Add inspection plans to items; lots are raised when goods arrive or are made." }}
      columns={[
        { label: "Item", render: (r) => <><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}{r.batchNo && <span className="block text-xs text-muted">Batch {r.batchNo}</span>}</> },
        { label: "Stage", render: (r) => <>{STAGE[r.stage]}{r.source && <span className="block text-xs text-muted">{r.source}</span>}</> },
        { label: "Lot / sample", align: "right", render: (r) => `${formatQty(r.lotQty)} / ${r.sampleSize}` },
        {
          label: "Result",
          render: (r) => (r.result !== "pending" ? <Badge tone={RESULT[r.result].tone}>{RESULT[r.result].label}</Badge> : r.suggestion ? <Badge tone={r.suggestion === "accept" ? "success" : "danger"}>Readings say {r.suggestion}</Badge> : <span className="text-muted">—</span>),
        },
      ]}
    />
  );
}
