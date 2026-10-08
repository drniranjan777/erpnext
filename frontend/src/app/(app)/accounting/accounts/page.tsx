"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, drCr, type AccountRow } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";

const NATURE: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };

export default function ChartOfAccountsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`) });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ parent?: AccountRow; account?: AccountRow } | null>(null);
  const rows = q.data ?? [];
  const hidden = new Set<string>();
  for (const r of rows) if (r.parentId && (closed.has(r.parentId) || hidden.has(r.parentId))) hidden.add(r.id);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Chart of accounts" description="Schedule III layout. Accounts marked “auto” are posted by documents (invoices, GRNs, stock…); the rest take journal entries too." />
      <Card>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {rows.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance today</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.filter((r) => !hidden.has(r.id)).map((r) => (
                <tr key={r.id} className={r.isGroup ? "bg-surface-muted/40" : ""}>
                  <td className="px-4 py-2" style={{ paddingLeft: `${16 + r.level * 20}px` }}>
                    {r.isGroup ? (
                      <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                        {closed.has(r.id) ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                        <span className="font-mono text-xs text-muted">{r.code}</span> {r.name}
                      </button>
                    ) : (
                      <Link href={`${ACC}/ledger?accountId=${r.id}`} className="hover:underline">
                        <span className="font-mono text-xs text-muted">{r.code}</span> {r.name}
                      </Link>
                    )}
                    {r.systemKey && <Badge className="ml-2">auto</Badge>}
                  </td>
                  <td className="px-4 py-2 text-muted">{NATURE[r.nature]}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.isGroup ? "font-medium" : ""}`}>{drCr(r.closing)}</td>
                  <td className="px-2 py-1 text-right">
                    {can("accounting.accounts.manage") &&
                      (r.isGroup ? (
                        <Button size="sm" variant="ghost" aria-label={`Add under ${r.name}`} onClick={() => setEditing({ parent: r })}><Plus className="size-4" /></Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ account: r })}>Edit</Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {editing && <AccountDialog {...editing} groups={rows.filter((r) => r.isGroup)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountDialog({ parent, account, groups, onClose }: { parent?: AccountRow; account?: AccountRow; groups: AccountRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: account?.code ?? "", name: account?.name ?? "", parentId: account?.parentId ?? parent?.id ?? "", isGroup: false, accountType: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nature = account?.nature ?? parent?.nature;
  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      if (account) await api(`${ACC}/accounts/${account.id}`, { method: "PUT", body: { code: f.code, name: f.name, parentId: f.parentId } });
      else await api(`${ACC}/accounts`, { body: { parentId: f.parentId, code: f.code, name: f.name, isGroup: f.isGroup, accountType: f.accountType || null } });
      qc.invalidateQueries({ queryKey: [ACC, "accounts"] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setErrors(e.fieldErrors);
      } else setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? `Edit ${account.code} ${account.name}` : `New account under ${parent?.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!f.code || f.name.trim().length < 2} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" required error={errors.code}>{(p) => <Input {...p} className="font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          <Field label="Name" required error={errors.name} className="sm:col-span-2">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        </div>
        <Field label="Under" error={errors.parentId}>
          {(p) => (
            <Select {...p} value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
              {groups.filter((g) => g.nature === nature && g.id !== account?.id).map((g) => <option key={g.id} value={g.id}>{" ".repeat(g.level * 3)}{g.code} {g.name}</option>)}
            </Select>
          )}
        </Field>
        {!account && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind">
              {(p) => (
                <Select {...p} value={f.isGroup ? "group" : f.accountType || "account"} onChange={(e) => setF({ ...f, isGroup: e.target.value === "group", accountType: ["bank", "cash"].includes(e.target.value) ? e.target.value : "" })}>
                  <option value="account">Account</option>
                  <option value="group">Group (holds accounts)</option>
                  {nature === "asset" && <option value="bank">Bank account</option>}
                  {nature === "asset" && <option value="cash">Cash account</option>}
                </Select>
              )}
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
