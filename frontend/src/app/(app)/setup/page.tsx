"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SetupSteps, type Progress } from "@/components/onboarding/setup-steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Template { key: string; label: string; itemGroups: { code: string; name: string }[]; warehouses: { code: string; name: string; type: string }[]; workCenters: { code: string; name: string; kind: string }[] }

export default function SetupPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const progress = useQuery({ queryKey: ["onboarding", "progress"], queryFn: () => api<Progress>("/onboarding/progress") });
  const templates = useQuery({ queryKey: ["onboarding", "templates"], queryFn: () => api<Template[]>("/onboarding/templates") });
  const [industry, setIndustry] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = industry || progress.data?.industry || "other";
  const tpl = templates.data?.find((t) => t.key === chosen);

  async function apply() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ added: { itemGroups: string[]; warehouses: string[]; workCenters: string[] }; skippedWorkCenters: boolean }>("/onboarding/templates/apply", { body: { industry: chosen } });
      const n = r.added.itemGroups.length + r.added.warehouses.length + r.added.workCenters.length;
      setMsg({ tone: "success", text: n ? `Added ${[r.added.itemGroups.length && `${r.added.itemGroups.length} item groups`, r.added.warehouses.length && `${r.added.warehouses.length} stores`, r.added.workCenters.length && `${r.added.workCenters.length} work centres`].filter(Boolean).join(", ")}.${r.skippedWorkCenters ? " Work centres need the engineering permission." : ""}` : "Everything in this template is already set up." });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Set up your workspace" description="The steps that get you from sign-up to your first invoice. Ticks are based on what is actually in your workspace." />
      {progress.isLoading && <LoadingBlock />}
      {progress.error && <ErrorBlock error={progress.error} />}
      {progress.data && (
        <Card>
          <CardHeader title={progress.data.complete ? "All set" : `${progress.data.done} of ${progress.data.total} done`} />
          <div className="mx-5 mb-2 h-2 rounded-full bg-surface-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(progress.data.done / progress.data.total) * 100}%` }} /></div>
          <SetupSteps p={progress.data} />
        </Card>
      )}
      <Card>
        <CardHeader title="Start from your industry" description="Adds the item groups, stores and work centres a business like yours usually needs. Anything you already have is left as it is." />
        <div className="space-y-4 border-t border-border p-5">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Industry" className="w-72">
              {(p) => (
                <Select {...p} value={chosen} onChange={(e) => setIndustry(e.target.value)}>
                  {templates.data?.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </Select>
              )}
            </Field>
            <Button onClick={apply} loading={busy} disabled={!tpl || !can("masters.setup.manage")}>Add to my workspace</Button>
          </div>
          {tpl && (
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              {[
                ["Item groups", tpl.itemGroups.map((g) => `${g.code} · ${g.name}`)],
                ["Stores", tpl.warehouses.map((w) => `${w.code} · ${w.name}`)],
                ["Work centres", tpl.workCenters.map((w) => `${w.code} · ${w.name}`)],
              ].map(([title, list]) => (
                <div key={title as string}>
                  <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title as string}</p>
                  {(list as string[]).length ? <ul className="space-y-0.5">{(list as string[]).map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-muted">None</p>}
                </div>
              ))}
            </div>
          )}
          {!can("masters.setup.manage") && <p className="text-xs text-muted"><Badge>Needs permission</Badge> Ask an administrator to apply a template.</p>}
        </div>
      </Card>
    </div>
  );
}
