"use client";

import { useQueryClient } from "@tanstack/react-query";
import { EInvoicePanel as IrnPanel } from "@/components/gst/e-invoice-panel";
import { EwayBillPanel } from "@/components/gst/eway-bill-panel";
import { keys, S, type SalesInvoice } from "@/lib/sales";

/** e-Invoice (IRN) and e-way bill of an approved invoice. */
export function EInvoicePanel({ invoice }: { invoice: SalesInvoice }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.detail(S.invoices, invoice.id) });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <IrnPanel documentId={invoice.id} onChange={refresh} />
      <EwayBillPanel documentId={invoice.id} onChange={refresh} />
    </div>
  );
}
