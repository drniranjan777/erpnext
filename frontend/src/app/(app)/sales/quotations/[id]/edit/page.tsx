"use client";

import { S, type Quotation } from "@/lib/sales";
import { EditDocPage } from "../../../_components/parts";
import { SellingForm } from "../../../_components/selling-form";

export default function EditQuotationPage() {
  return <EditDocPage<Quotation> apiBase={S.quotations} title="quotation" render={(q) => <SellingForm mode="quotation" api={S.quotations} existing={q} />} />;
}
