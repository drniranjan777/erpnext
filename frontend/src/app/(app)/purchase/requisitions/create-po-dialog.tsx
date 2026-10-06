"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatQty } from "@/lib/documents";
import { PO_API, PO_ROUTE, type PurchaseOrder, type Requisition } from "@/lib/purchase";

/** Draft PO for one vendor from the requisition's outstanding item lines. */
export function CreatePoDialog({ pr, open, onClose }: { pr: Requisition; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const open_ = pr.lines.filter((l) => Number(l.quantity) - Number(l.orderedQty) > 0);
  const [vendor, setVendor] = useState<PickedParty | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(open_.filter((l) => l.itemId).map((l) => l.id)));

  const create = useMutation({
    mutationFn: () => api<PurchaseOrder>(`${PO_API}/from-requisition`, { body: { requisitionId: pr.id, vendorId: vendor!.id, lineIds: [...selected] } }),
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: [PO_ROUTE] });
      router.push(`${PO_ROUTE}/${po.id}/edit`);
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Create purchase order"
      description="A draft order is created with the outstanding quantities. Review rates and terms before submitting."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!vendor || !selected.size} onClick={() => create.mutate()}>
            Create draft order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : "Could not create the order."}</Alert>}
        <Field label="Vendor" required>
          {(p) => <PartyPicker id={p.id} role="vendor" value={vendor} onChange={setVendor} />}
        </Field>
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {open_.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                aria-label={`Order line ${l.lineNo}`}
                disabled={!l.itemId}
                checked={selected.has(l.id)}
                onChange={(e) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(l.id);
                    else next.delete(l.id);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1">
                {l.description}
                {!l.itemId && <span className="block text-xs text-warning">Free-text line: link it to an item (edit the requisition) to order it here</span>}
              </span>
              <span className="whitespace-nowrap tabular-nums text-muted">
                {formatQty(Number(l.quantity) - Number(l.orderedQty))} {l.uom}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
