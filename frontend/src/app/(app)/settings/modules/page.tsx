"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { INDUSTRIES, industryLabel } from "@/lib/industries";

interface ModuleRow { key: string; label: string; description: string; enabled: boolean; byDefault: boolean }
interface Modules { industry: string | null; modules: ModuleRow[] }

const KEY = ["/workspace/modules"];

/** Which optional modules the workspace uses: its industry decides the starting set. */
export default function ModulesPage() {
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Modules>("/workspace/modules") });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !q.data) return <ErrorBlock error={q.error} />;
  return <Editor key={JSON.stringify(q.data)} saved={q.data} />;
}

function Editor({ saved }: { saved: Modules }) {
  const qc = useQueryClient();
  const { can, refreshMe } = useAuth();
  const manage = can("platform.settings.manage");
  const [industry, setIndustry] = useState(saved.industry ?? "other");
  const [rows, setRows] = useState(saved.modules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = industry !== (saved.industry ?? "other") || rows.some((r, i) => r.enabled !== saved.modules[i].enabled);
  const custom = rows.filter((r) => r.enabled !== r.byDefault).length;

  /** A new industry brings its own recommended set; the user can still adjust before saving. */
  async function changeIndustry(value: string) {
    setIndustry(value);
    setError(null);
    try {
      const preview = await api<Modules>("/workspace/modules", { query: { industry: value } });
      setRows(preview.modules);
    } catch {
      setError("Could not load the modules for that industry.");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<Modules>("/workspace/modules", { method: "PUT", body: { industry, modules: Object.fromEntries(rows.map((r) => [r.key, r.enabled])) } });
      qc.setQueryData(KEY, next);
      await refreshMe();
      toast("Modules updated. The menu now shows what is switched on.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Modules"
        description="Your industry decides which modules you start with. Switch others on when you need them; switching one off hides it and keeps its data."
        actions={
          manage && (
            <>
              <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setIndustry(saved.industry ?? "other"); setRows(saved.modules); }}>
                Discard
              </Button>
              <Button disabled={!dirty} loading={busy} onClick={save}>
                Save changes
              </Button>
            </>
          )
        }
      />
      {error && <Alert>{error}</Alert>}

      <Card>
        <CardHeader title="Industry" description="Changing it selects the modules recommended for that industry." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Industry">
            {(f) => (
              <Select {...f} value={industry} disabled={!manage} onChange={(e) => void changeIndustry(e.target.value)}>
                {INDUSTRIES.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((i) => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <div className="self-end pb-2 text-sm text-muted">
            {rows.filter((r) => r.enabled).length} of {rows.length} optional modules on
            {custom > 0 && <> · {custom} changed from the recommendation</>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Optional modules"
          description="Master data, sales, purchase, inventory, finance, GST and reports are always on."
          action={
            manage && custom > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => setRows(rows.map((r) => ({ ...r, enabled: r.byDefault })))}>
                Use recommended
              </Button>
            ) : undefined
          }
        />
        <ul className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.key}>
              <label className={cn("flex items-start gap-3 px-5 py-3", manage ? "cursor-pointer hover:bg-surface-muted/60" : "opacity-80")}>
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                  checked={r.enabled}
                  disabled={!manage}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.label}
                    {r.byDefault && <Badge tone="primary">Recommended for {industryLabel(industry)}</Badge>}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{r.description}</span>
                </span>
                <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "On" : "Off"}</Badge>
              </label>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
