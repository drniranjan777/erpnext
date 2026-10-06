"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, type AccountRow } from "@/lib/accounting";
import type { Asset, AssetCategory } from "@/lib/assets";
import { todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";

export default function NewAssetPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["assets", "categories"], queryFn: () => api<AssetCategory[]>("/assets/categories") });
  const accounts = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`) });
  const warehouses = useWarehouses();
  const [f, setF] = useState({ name: "", categoryId: "", purchaseDate: todayIST(), capitalisedOn: todayIST(), cost: "", residualValue: "", locationId: "", custodian: "", serialNo: "", capitaliseFromAccountId: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cat = cats.data?.find((c) => c.id === (f.categoryId || cats.data?.[0]?.id));
  const sources = (accounts.data ?? []).filter((a) => !a.isGroup && (a.systemKey === "cwip" || a.nature === "expense" || a.systemKey === "purchase_expenses"));
  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const a = await api<Asset>("/assets", {
        body: { ...f, categoryId: f.categoryId || cat?.id, residualValue: f.residualValue || null, locationId: f.locationId || null, capitaliseFromAccountId: f.capitaliseFromAccountId || null, custodian: f.custodian || null, serialNo: f.serialNo || null, notes: f.notes || null },
      });
      qc.invalidateQueries({ queryKey: ["assets"] });
      router.push(`/assets/${a.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Add fixed asset" description="Depreciation starts from the date it is put to use." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Category" hint={cat ? `${cat.method.toUpperCase()} over ${Number(cat.usefulLifeYears)} years, ${Number(cat.residualPct)}% residual; IT block ${Number(cat.itRatePct)}%` : undefined}>
            {(p) => <Select {...p} value={f.categoryId || cat?.id || ""} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          </Field>
          <Field label="Cost (₹, excluding GST credit)" required error={errors.cost}>{(p) => <Input {...p} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}</Field>
          <Field label="Purchase date">{(p) => <Input {...p} type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} />}</Field>
          <Field label="Put to use on" error={errors.capitalisedOn}>{(p) => <Input {...p} type="date" value={f.capitalisedOn} onChange={(e) => setF({ ...f, capitalisedOn: e.target.value })} />}</Field>
          <Field label="Residual value" hint="Blank = category default" error={errors.residualValue}>{(p) => <Input {...p} inputMode="decimal" value={f.residualValue} onChange={(e) => setF({ ...f, residualValue: e.target.value })} />}</Field>
          <Field label="Move cost from" hint="CWIP, or where the bill was booked. Blank if the bill already went to the asset account.">
            {(p) => <Select {...p} value={f.capitaliseFromAccountId} onChange={(e) => setF({ ...f, capitaliseFromAccountId: e.target.value })}><option value="">Already in the asset account</option>{sources.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>}
          </Field>
          <Field label="Location">{(p) => <Select {...p} value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">—</option>{(warehouses.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select>}</Field>
          <Field label="Custodian">{(p) => <Input {...p} value={f.custodian} onChange={(e) => setF({ ...f, custodian: e.target.value })} />}</Field>
          <Field label="Serial no.">{(p) => <Input {...p} value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} />}</Field>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button loading={busy} disabled={!f.name || !f.cost} onClick={save}>Add asset</Button>
      </div>
    </div>
  );
}
