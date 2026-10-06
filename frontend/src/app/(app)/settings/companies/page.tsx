"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Branch, Company } from "@/lib/types";
import { EditCompanyDialog } from "./edit-company";

export default function CompaniesPage() {
  const { can } = useAuth();
  const companies = useQuery({ queryKey: ["org", "companies"], queryFn: () => api<Company[]>("/org/companies") });
  const branches = useQuery({
    queryKey: ["org", "branches"],
    queryFn: () => api<Branch[]>("/org/branches"),
    enabled: can("org.branches.read"),
  });
  const [editing, setEditing] = useState<Company | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Companies & branches</h1>
        <p className="mt-1 text-sm text-muted">Legal entities and their locations. Each GST registration is a branch.</p>
      </div>

      {companies.isLoading && (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="size-6 animate-spin" aria-label="Loading" />
        </div>
      )}
      {companies.error && (
        <Alert>{companies.error instanceof ApiError ? companies.error.message : "Could not load companies."}</Alert>
      )}

      {companies.data?.map((c) => {
        const own = branches.data?.filter((b) => b.companyId === c.id) ?? [];
        return (
          <Card key={c.id}>
            <CardHeader
              title={c.name}
              description={c.legalName && c.legalName !== c.name ? c.legalName : undefined}
              action={
                can("org.companies.manage") && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                )
              }
            />
            {!c.gstin && <p className="mx-5 rounded-lg bg-warning-soft px-3 py-2 text-sm">Add the GSTIN so purchase orders and invoices get the right GST (CGST + SGST or IGST).</p>}
            <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
              <Item label="GSTIN" value={c.gstin} mono />
              <Item label="PAN" value={c.pan} mono />
              <Item label="State code" value={c.stateCode} />
              <Item label="Financial year starts" value={monthName(c.fyStartMonth)} />
            </dl>
            {own.length > 0 && (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Code</th>
                      <th className="px-5 py-2.5 font-medium">Branch</th>
                      <th className="px-5 py-2.5 font-medium">GSTIN</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {own.map((b) => (
                      <tr key={b.id}>
                        <td className="px-5 py-3 font-mono">{b.code}</td>
                        <td className="px-5 py-3">{b.name}</td>
                        <td className="px-5 py-3 font-mono">{b.gstin ?? "—"}</td>
                        <td className="px-5 py-3">
                          <span
                            className={
                              b.isActive
                                ? "rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success"
                                : "rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted"
                            }
                          >
                            {b.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
      <EditCompanyDialog company={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono" : "mt-0.5"}>{value || "—"}</dd>
    </div>
  );
}

function monthName(m: number) {
  return new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });
}
