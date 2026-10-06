"use client";

import { useParams } from "next/navigation";
import { DocumentPrintView } from "@/components/documents/print-view";

export default function PrintInvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentPrintView endpoint={`/billing/invoices/${id}/print`} />;
}
