"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Alert, Card } from "@/components/ui/card";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; itemId: string; code: string; name: string; version: number; language: string; status: string; issuedAt: string | null; hazardClass: string | null; unNumber: string | null; signalWord: string | null; pictograms: string[] }

/** Safety data sheets by product. */
export default function SdsListPage() {
  const { can } = useAuth();
  const router = useRouter();
  const list = useQuery({ queryKey: ["/hse/sds"], queryFn: () => api<Row[]>("/hse/sds") });
  const [error, setError] = useState<string | null>(null);
  async function start(itemId: string) {
    setError(null);
    const existing = list.data?.find((r) => r.itemId === itemId);
    if (existing) return router.push(`/hse/sds/${existing.id}`);
    try {
      const r = await api<{ id: string }>("/hse/sds", { body: { itemId } });
      router.push(`/hse/sds/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Safety data sheets" description="SDS in the 16 GHS sections with the classification (pictograms and signal word worked out from the hazard statements), transport data and versions. Customers who received a product get the current version; GHS labels print from the issued SDS." />
      {error && <Alert>{error}</Alert>}
      {can("hse.sds.manage") && <ItemPicker placeholder="Write or open the SDS of a product…" onPick={(i) => start(i.id)} />}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/hse/sds/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={r.status === "issued" ? "success" : "warning"}>v{r.version} {r.status}</Badge>
                <span className="font-medium">{r.code} · {r.name}</span>
                {r.signalWord && <Badge tone={r.signalWord === "Danger" ? "danger" : "warning"}>{r.signalWord}</Badge>}
                <span className="text-xs text-muted">{r.pictograms?.join(" ")}{r.unNumber ? ` · ${r.unNumber} class ${r.hazardClass}` : ""}{r.issuedAt ? ` · issued ${formatDateTime(r.issuedAt)}` : ""}</span>
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No safety data sheets yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
