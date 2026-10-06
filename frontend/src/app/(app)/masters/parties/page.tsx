"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GST_REG_TYPES, type PartyListRow } from "@/lib/masters";

type Role = "all" | "customer" | "vendor";

export default function PartiesPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Parties />
    </Suspense>
  );
}

function Parties() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const role = (params.get("role") as Role) ?? "all";
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const filters = { role, q: search || undefined };
  const list = useInfiniteQuery({
    queryKey: ["masters", "parties", filters],
    queryFn: ({ pageParam }) => api<{ items: PartyListRow[]; nextCursor: string | null }>("/masters/parties", { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Customers & vendors"
        description="One record per business. A party can be both a customer and a vendor."
        actions={
          can("masters.parties.manage") && (
            <Link href={`/masters/parties/new${role !== "all" ? `?role=${role}` : ""}`}>
              <Button>
                <Plus className="size-4" aria-hidden /> New {role === "vendor" ? "vendor" : role === "customer" ? "customer" : "party"}
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <Tabs
              tabs={[
                { value: "all" as Role, label: "All" },
                { value: "customer" as Role, label: "Customers" },
                { value: "vendor" as Role, label: "Vendors" },
              ]}
              value={role}
              onChange={(r) => router.replace(r === "all" ? "/masters/parties" : `/masters/parties?role=${r}`)}
            />
          </div>
          <form
            className="relative mb-2 w-full sm:w-72"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input className="pl-9" placeholder="Name, code, GSTIN or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search parties" />
          </form>
        </div>
        {list.isLoading && <LoadingBlock />}
        {list.error && <div className="p-5"><ErrorBlock error={list.error} /></div>}
        {list.data && !rows.length && <EmptyState title="Nobody here yet" description="Add your customers and vendors with their GSTIN, addresses and payment terms." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">GSTIN</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 text-right font-medium">Credit days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/masters/parties/${r.id}`} className="font-mono font-medium text-primary hover:underline">
                        {r.code}
                      </Link>
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="flex flex-wrap gap-1">
                        {r.isCustomer && <Badge tone="primary">Customer</Badge>}
                        {r.isVendor && <Badge tone="success">Vendor</Badge>}
                        {r.msmeCategory && <Badge tone="warning">MSME · {r.msmeCategory}</Badge>}
                        {!r.isActive && <Badge>Inactive</Badge>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {r.gstin ? <span className="font-mono text-xs">{r.gstin}</span> : <span className="text-xs text-muted">{GST_REG_TYPES[r.gstRegistrationType]}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-4 py-3 text-muted">{r.phone ?? r.email ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.creditDays ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
