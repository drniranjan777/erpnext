"use client";

import Link from "next/link";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { useWarehouseParam } from "@/lib/wms";

/** Warehouse switcher for WMS pages; tells the user to switch bins on when no warehouse runs with them. */
export function WarehouseSelect() {
  const { wh, set, enabled } = useWarehouseParam();
  if (enabled.length < 2) return null;
  return (
    <Select className="h-9 w-56" aria-label="Warehouse" value={wh ?? ""} onChange={(e) => set(e.target.value)}>
      {enabled.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
    </Select>
  );
}

export function NoWmsWarehouse() {
  return <EmptyState title="No warehouse runs with bins yet" description="Switch bins on for a warehouse first." action={<Link className="text-sm text-primary hover:underline" href="/wms">Warehouses</Link>} />;
}
