"use client";

import { useParams } from "next/navigation";
import { DocumentPrintView } from "@/components/documents/print-view";

export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentPrintView endpoint={`/documents/${id}/print`} />;
}
