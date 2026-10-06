"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { GRN_API, LC_API, LC_ROUTE, type GrnListItem, type LandedCost } from "@/lib/purchase";

const CHARGES = { freight: "Freight", customs_duty: "Customs duty", insurance: "Insurance", clearing: "Clearing & forwarding (CHA)", loading: "Loading / unloading", octroi: "Octroi / entry tax", other: "Other" };

interface Charge {
  key: number;
  chargeType: keyof typeof CHARGES;
  description: string;
  vendor: PickedParty | null;
  billRef: string;
  amount: string;
}

let seq = 0;

export default function NewLandedCostPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const grns = useInfiniteQuery({
    queryKey: ["/purchase/receipts", "list", { status: "approved" }],
    queryFn: ({ pageParam }) => api<{ items: GrnListItem[]; nextCursor: string | null }>(GRN_API, { query: { status: "approved", limit: 100, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<"value" | "qty" | "weight">("value");
  const [docDate, setDocDate] = useState(todayIST());
  const [charges, setCharges] = useState<Charge[]>([{ key: ++seq, chargeType: "freight", description: "", vendor: null, billRef: "", amount: "" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = grns.data?.pages.flatMap((p) => p.items) ?? [];
  const total = charges.reduce((s, c) => s + Number(c.amount || 0), 0);

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const lc = await api<LandedCost>(LC_API, {
        body: {
          docDate,
          method,
          grnIds: [...selected],
          charges: charges.map((c) => ({ chargeType: c.chargeType, description: c.description || null, vendorId: c.vendor?.id ?? null, billRef: c.billRef || null, amount: c.amount })),
        },
      });
      if (andSubmit) await api(`${LC_API}/${lc.id}/submit`, { body: { version: lc.version } });
      qc.invalidateQueries({ queryKey: [LC_ROUTE] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      router.push(`${LC_ROUTE}/${lc.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="New landed cost" description="Charges are before GST (claim their GST on the transporter's or agent's own bill). Only stock still on hand absorbs the cost." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Goods receipts" description="Choose the receipts these charges belong to." />
        {grns.isLoading ? (
          <LoadingBlock />
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border text-sm">
            {rows.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-5 py-2">
                <Checkbox
                  aria-label={`Include ${g.number}`}
                  checked={selected.has(g.id)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(g.id);
                      else n.delete(g.id);
                      return n;
                    })
                  }
                />
                <span className="font-medium">{g.number}</span>
                <span className="text-muted">{formatDate(g.docDate)}</span>
                <span className="min-w-0 flex-1 truncate">{g.vendor.name}</span>
                <span className="tabular-nums">{formatMoney(g.amount)}</span>
              </li>
            ))}
            {!rows.length && <li className="px-5 py-4 text-muted">No posted goods receipts.</li>}
          </ul>
        )}
        {errors.grnIds && <p className="px-5 py-2 text-xs text-danger">{errors.grnIds}</p>}
      </Card>
      <Card>
        <CardHeader title="Charges" />
        <div className="grid gap-4 px-5 pb-2 sm:grid-cols-3">
          <Field label="Split by" error={errors.method}>
            {(p) => (
              <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="value">Value of goods</option>
                <option value="qty">Quantity</option>
                <option value="weight">Weight (item net weight)</option>
              </Select>
            )}
          </Field>
          <Field label="Date">{(p) => <Input {...p} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}</Field>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {charges.map((c, i) => (
            <li key={c.key} className="grid gap-3 px-5 py-3 sm:grid-cols-12">
              <Select className="sm:col-span-3" aria-label={`Charge ${i + 1} type`} value={c.chargeType} onChange={(e) => setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, chargeType: e.target.value as Charge["chargeType"] } : x)))}>
                {Object.entries(CHARGES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <div className="sm:col-span-4">
                <PartyPicker role="vendor" value={c.vendor} onChange={(v) => setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, vendor: v } : x)))} />
              </div>
              <Input className="sm:col-span-2" aria-label={`Charge ${i + 1} bill ref`} placeholder="Bill / LR no." value={c.billRef} onChange={(e) => setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, billRef: e.target.value } : x)))} />
              <Input className="text-right sm:col-span-2" inputMode="decimal" aria-label={`Charge ${i + 1} amount`} placeholder="Amount ₹" value={c.amount} onChange={(e) => setCharges((cs) => cs.map((x) => (x.key === c.key ? { ...x, amount: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove charge ${i + 1}`} disabled={charges.length === 1} onClick={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))}>
                <Trash2 className="size-4 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <Button type="button" size="sm" variant="secondary" onClick={() => setCharges((cs) => [...cs, { key: ++seq, chargeType: "other", description: "", vendor: null, billRef: "", amount: "" }])}>
            <Plus className="size-3.5" aria-hidden /> Add charge
          </Button>
          <span className="text-sm text-muted">
            Total <strong className="ml-1 text-foreground tabular-nums">{formatMoney(total)}</strong>
          </span>
        </div>
        {errors.charges && <p className="px-5 pb-3 text-xs text-danger">{errors.charges}</p>}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button variant="secondary" loading={busy} disabled={!selected.size || total <= 0} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button loading={busy} disabled={!selected.size || total <= 0} onClick={() => save(true)}>
          Save & post
        </Button>
      </div>
    </div>
  );
}
