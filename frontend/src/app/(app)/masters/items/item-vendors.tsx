"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { PartyPicker } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/documents";

interface Row {
  vendorId: string;
  vendorName: string;
  isApproved: boolean;
  isPreferred: boolean;
  vendorItemCode: string | null;
  leadTimeDays: number | null;
  lastRate: string | null;
  lastOrderedAt: string | null;
}

/** Approved vendor list for an item. POs from vendors not on the list show a warning. */
export function ItemVendors({ itemId, readOnly }: { itemId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const key = ["masters", "items", itemId, "vendors"];
  const list = useQuery({ queryKey: key, queryFn: () => api<Row[]>(`/masters/items/${itemId}/vendors`) });
  const [draft, setDraft] = useState<Row[] | null>(null);
  const rows = draft ?? list.data ?? [];
  const save = useMutation({
    mutationFn: () =>
      api(`/masters/items/${itemId}/vendors`, {
        method: "PUT",
        body: { vendors: rows.map((r) => ({ vendorId: r.vendorId, isApproved: r.isApproved, isPreferred: r.isPreferred, vendorItemCode: r.vendorItemCode, leadTimeDays: r.leadTimeDays })) },
      }),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const edit = (vendorId: string, patch: Partial<Row>) => setDraft(rows.map((r) => (r.vendorId === vendorId ? { ...r, ...patch } : patch.isPreferred ? { ...r, isPreferred: false } : r)));

  return (
    <Card>
      <CardHeader
        title="Approved vendors"
        description="Who may supply this item. Orders to other vendors are flagged. The last rate updates from approved POs."
        action={draft && !readOnly ? <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save vendors</Button> : undefined}
      />
      {save.error && (
        <div className="px-5 pb-2">
          <Alert>{save.error instanceof ApiError ? save.error.message : "Could not save."}</Alert>
        </div>
      )}
      {!readOnly && (
        <div className="px-5 pb-3">
          <PartyPicker
            role="vendor"
            value={null}
            onChange={(v) => v && !rows.some((r) => r.vendorId === v.id) && setDraft([...rows, { vendorId: v.id, vendorName: v.name, isApproved: true, isPreferred: rows.length === 0, vendorItemCode: null, leadTimeDays: null, lastRate: null, lastOrderedAt: null }])}
          />
        </div>
      )}
      {rows.length > 0 ? (
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Vendor</th>
              <th className="px-4 py-2 font-medium">Approved</th>
              <th className="px-4 py-2 font-medium">Their code</th>
              <th className="px-4 py-2 font-medium">Lead days</th>
              <th className="px-4 py-2 text-right font-medium">Last rate / base unit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.vendorId}>
                <td className="px-4 py-2">
                  <button type="button" disabled={readOnly} className="mr-2 align-middle" aria-label={r.isPreferred ? "Preferred vendor" : "Make preferred"} onClick={() => edit(r.vendorId, { isPreferred: true })}>
                    <Star className={`size-4 ${r.isPreferred ? "fill-warning text-warning" : "text-muted"}`} />
                  </button>
                  {r.vendorName}
                </td>
                <td className="px-4 py-2">
                  <Checkbox aria-label={`${r.vendorName} approved`} disabled={readOnly} checked={r.isApproved} onChange={(e) => edit(r.vendorId, { isApproved: e.target.checked })} />
                </td>
                <td className="px-4 py-2">
                  <Input className="h-8 w-32" disabled={readOnly} aria-label="Vendor item code" value={r.vendorItemCode ?? ""} onChange={(e) => edit(r.vendorId, { vendorItemCode: e.target.value || null })} />
                </td>
                <td className="px-4 py-2">
                  <Input className="h-8 w-20" inputMode="numeric" disabled={readOnly} aria-label="Lead time days" value={r.leadTimeDays ?? ""} onChange={(e) => edit(r.vendorId, { leadTimeDays: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.lastRate ? formatMoney(r.lastRate) : "—"}
                  {r.lastOrderedAt && <span className="block text-xs text-muted">{formatDate(r.lastOrderedAt)}</span>}
                </td>
                <td className="px-2 py-2">
                  {!readOnly && (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${r.vendorName}`} onClick={() => setDraft(rows.filter((x) => x.vendorId !== r.vendorId))}>
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="border-t border-border px-5 py-4 text-sm text-muted">No vendor list: any vendor can be used.</p>
      )}
    </Card>
  );
}
