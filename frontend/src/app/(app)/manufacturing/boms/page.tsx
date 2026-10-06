"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { MFG } from "@/lib/manufacturing";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; item: { code: string; name: string }; bomVersion: number; quantity: string; isDefault: boolean; effectiveFrom: string | null; effectiveTo: string | null; unitCost: string }

const B = `${MFG}/boms`;

export default function BomsPage() {
  return (
    <DocList<Row>
      title="Bills of materials"
      description="What goes into each item and how it is made. Approved BOMs are frozen; changes go into a new version."
      apiPath={B}
      route={B}
      queryKey={B}
      newHref={`${B}/new`}
      newLabel="New BOM"
      newPermission="manufacturing.engineering.manage"
      searchPlaceholder="Item code or name"
      empty={{ title: "No BOMs", description: "Define the components and routing of what you make." }}
      columns={[
        { label: "Item", render: (r) => <><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}</> },
        { label: "Version", render: (r) => <>v{r.bomVersion}{r.isDefault && r.status === "approved" && <Badge tone="success" className="ml-1">Default</Badge>}</> },
        { label: "Per", align: "right", render: (r) => formatQty(r.quantity) },
        { label: "Effective", render: (r) => (r.effectiveFrom ? `${formatDate(r.effectiveFrom)}${r.effectiveTo ? ` – ${formatDate(r.effectiveTo)}` : ""}` : "—") },
        { label: "Unit cost", align: "right", render: (r) => (Number(r.unitCost) ? formatMoney(r.unitCost) : "—") },
      ]}
    />
  );
}
