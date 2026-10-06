"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { SC_API, SC_ROUTE, type StockCount } from "@/lib/inventory";
import { useItemGroups, useWarehouses } from "@/lib/masters";

export default function NewStockCountPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const groups = useItemGroups();
  const [warehouseId, setWarehouseId] = useState("");
  const [itemGroupId, setItemGroupId] = useState("");
  const [docDate, setDocDate] = useState(todayIST());
  const [blind, setBlind] = useState(true);
  const [includeZeroStock, setIncludeZero] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const count = await api<StockCount>(SC_API, {
        body: {
          warehouseId,
          itemGroupId: itemGroupId || null,
          docDate,
          blind,
          includeZeroStock,
          notes: notes || null,
        },
      });
      qc.invalidateQueries({ queryKey: [SC_ROUTE] });
      router.push(`${SC_ROUTE}/${count.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New stock count"
        description="The count sheet lists what the books say is in the warehouse right now, by item and batch."
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <form
          className="grid gap-4 px-5 py-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field label="Warehouse" required error={errors.warehouseId}>
            {(p) => (
              <Select
                {...p}
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Choose…</option>
                {(warehouses.data ?? [])
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field
            label="Item group"
            hint="Blank = everything in the warehouse"
            error={errors.itemGroupId}
          >
            {(p) => (
              <Select
                {...p}
                value={itemGroupId}
                onChange={(e) => setItemGroupId(e.target.value)}
              >
                <option value="">All items</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Count date" required>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <Checkbox
              label="Blind count"
              description="Counters don't see book quantities until the count is submitted"
              checked={blind}
              onChange={(e) => setBlind(e.target.checked)}
            />
            <Checkbox
              label="Include items with no stock"
              description="To find stock that was never recorded"
              checked={includeZeroStock}
              onChange={(e) => setIncludeZero(e.target.checked)}
            />
          </div>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => (
              <Input
                {...p}
                value={notes}
                placeholder="e.g. Year-end count, team A: racks 1–12"
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
          <p className="text-xs text-muted sm:col-span-2">
            Serial-numbered items aren&apos;t included: adjust them with a stock
            entry that lists the serial numbers.
          </p>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!warehouseId}>
              Create count sheet
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
