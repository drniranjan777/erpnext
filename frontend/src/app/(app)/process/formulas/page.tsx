"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { PROC } from "@/lib/process";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; item: { code: string; name: string }; formulaVersion: number; kind: string; batchSize: string; yieldPct: string; isDefault: boolean; unitCost: string }

const F = `${PROC}/formulas`;

export default function FormulasPage() {
  return (
    <DocList<Row>
      title="Formulas"
      description="Master formulas and recipes: ingredients by percent, quantity or potency, stages and in-process checks. Approved versions are frozen."
      apiPath={F}
      route={F}
      queryKey={F}
      newHref={`${F}/new`}
      newLabel="New formula"
      newPermission="manufacturing.engineering.manage"
      searchPlaceholder="Product code or name"
      empty={{ title: "No formulas", description: "Write the recipe of a product to make batches of it." }}
      columns={[
        { label: "Product", render: (r) => <><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}</> },
        { label: "Version", render: (r) => <>v{r.formulaVersion}{r.isDefault && r.status === "approved" && <Badge tone="success" className="ml-1">Default</Badge>}{r.kind === "packing" && <Badge className="ml-1">Packing</Badge>}</> },
        { label: "Batch", align: "right", render: (r) => formatQty(r.batchSize) },
        { label: "Yield", align: "right", render: (r) => `${Number(r.yieldPct)}%` },
        { label: "Unit cost", align: "right", render: (r) => (Number(r.unitCost) ? formatMoney(r.unitCost) : "—") },
      ]}
    />
  );
}
