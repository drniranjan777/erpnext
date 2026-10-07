"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatQty, type DocumentStatus } from "@/lib/documents";
import { KIND_LABEL, MFG, STAGE_LABEL, STAGE_TONE, type WorkOrderStage } from "@/lib/manufacturing";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  kind: keyof typeof KIND_LABEL;
  stage: WorkOrderStage;
  item: { code: string; name: string };
  qty: string;
  producedQty: string;
  rejectedQty: string;
  plannedEnd: string | null;
  priority: number;
  salesOrder: string | null;
}

const W = `${MFG}/work-orders`;

export default function WorkOrdersPage() {
  return (
    <DocList<Row>
      title="Work orders"
      description="What the shop floor is making. Releasing an order checks and reserves its materials."
      apiPath={W}
      route={W}
      queryKey={W}
      newHref={`${W}/new`}
      newLabel="New work order"
      newPermission="manufacturing.production.manage"
      searchPlaceholder="Number, item code or name"
      tabs={[
        { value: "all", label: "All", query: {} },
        { value: "planned", label: "Planned", query: { stage: "planned" } },
        { value: "released", label: "Released", query: { stage: "released" } },
        {
          value: "in_progress",
          label: "In progress",
          query: { stage: "in_progress" },
        },
        {
          value: "completed",
          label: "Completed",
          query: { stage: "completed" },
        },
        { value: "closed", label: "Closed", query: { stage: "closed" } },
        { value: "batch", label: "Process batches", query: { kind: "batch" } },
      ]}
      empty={{
        title: "No work orders",
        description: "Plan production from a BOM, or make to order from a sales order.",
      }}
      columns={[
        {
          label: "Item",
          render: (r) => (
            <>
              <span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}
            </>
          ),
        },
        {
          label: "Type",
          render: (r) => (
            <>
              {KIND_LABEL[r.kind]}
              {r.salesOrder && <span className="block text-xs text-muted">{r.salesOrder}</span>}
            </>
          ),
        },
        {
          label: "Made / ordered",
          align: "right",
          render: (r) => (
            <>
              {formatQty(r.producedQty)} / {formatQty(r.qty)}
              {Number(r.rejectedQty) > 0 && <span className="block text-xs text-danger">{formatQty(r.rejectedQty)} rejected</span>}
            </>
          ),
        },
        {
          label: "Due",
          render: (r) => (r.plannedEnd ? formatDate(r.plannedEnd) : "—"),
        },
        {
          label: "Stage",
          render: (r) => <Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Badge>,
        },
      ]}
    />
  );
}
