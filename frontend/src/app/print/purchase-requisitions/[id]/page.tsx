"use client";

import { DocumentPrintView } from "@/components/documents/print-view";
import { useParams } from "next/navigation";

export default function PrintRequisitionPage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentPrintView endpoint={`/documents/${id}/print`} />;
}
