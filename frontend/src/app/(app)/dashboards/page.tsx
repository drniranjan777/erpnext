"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface WidgetInfo { key: string; title: string; description: string; area: string; size: 1 | 2 | 3 }
interface DashboardList { presets: { key: string; name: string; widgets: number }[]; saved: { id: string; name: string; preset: string | null; shared: boolean; isDefault: boolean; mine: boolean }[] }
interface Saved { id: string | null; name: string; preset: string | null; refreshSeconds: number; shared: boolean; isDefault: boolean; widgets: { key: string; size: 1 | 2 | 3 }[] }

const AREAS: Record<string, string> = { general: "General", sales: "Sales", purchase: "Purchase", stores: "Stores", production: "Production", quality: "Quality", finance: "Finance" };

export default function DashboardsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["dashboards", "list"], queryFn: () => api<DashboardList>("/dashboards") });
  const catalogue = useQuery({ queryKey: ["dashboards", "widgets"], queryFn: () => api<WidgetInfo[]>("/dashboards/widgets") });
  const [editing, setEditing] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dashboards"] });

  async function edit(id: string | null, preset?: string) {
    setError(null);
    try {
      const v = await api<Saved & { widgets: { key: string; size: 1 | 2 | 3 }[] }>("/dashboards/view", { query: id ? { id } : { preset } });
      setEditing({ id, name: id ? v.name : `My ${v.name.toLowerCase()} dashboard`, preset: v.preset, refreshSeconds: v.refreshSeconds, shared: id ? v.shared : false, isDefault: id ? v.isDefault : true, widgets: v.widgets.map((w) => ({ key: w.key, size: w.size })) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  async function remove(id: string) {
    try {
      await api(`/dashboards/${id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Dashboards"
        description="Start from a role preset, choose the widgets you want and save it as your home. Administrators can share dashboards with everyone."
        actions={<Button onClick={() => setEditing({ id: null, name: "My dashboard", preset: null, refreshSeconds: 60, shared: false, isDefault: true, widgets: [] })}><Plus className="size-4" aria-hidden /> New dashboard</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {(list.isLoading || catalogue.isLoading) && <LoadingBlock />}
      {list.error && <ErrorBlock error={list.error} />}
      {list.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Saved" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {list.data.saved.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span>{d.name} {d.shared && <Badge className="ml-1">Shared</Badge>}{d.isDefault && d.mine && <Badge tone="success" className="ml-1">Home</Badge>}</span>
                  <span className="flex gap-1">
                    <Link href={`/dashboards/tv?id=${d.id}`} className="rounded p-2 hover:bg-surface-muted" aria-label={`Show ${d.name} on a TV`}><Monitor className="size-4" aria-hidden /></Link>
                    {(d.mine || (d.shared && can("platform.customization.manage"))) && (
                      <>
                        <Button size="sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => edit(d.id)}><Pencil className="size-4" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => remove(d.id)}><Trash2 className="size-4" aria-hidden /></Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
              {!list.data.saved.length && <li className="px-5 py-3 text-muted">None yet. Start from a preset.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="By role" description="Ready-made layouts. Widgets you cannot see are left out." />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {list.data.presets.map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span>{p.name} <span className="text-xs text-muted">· {p.widgets} widgets</span></span>
                  <span className="flex gap-1">
                    <Link href={`/dashboards/tv?preset=${p.key}`} className="rounded p-2 hover:bg-surface-muted" aria-label={`Show ${p.name} on a TV`}><Monitor className="size-4" aria-hidden /></Link>
                    <Button size="sm" variant="secondary" onClick={() => edit(null, p.key)}>Use as start</Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {editing && catalogue.data && <Editor key={editing.id ?? editing.name} initial={editing} catalogue={catalogue.data} canShare={can("platform.customization.manage")} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function Editor({ initial, catalogue, canShare, onClose, onSaved }: { initial: Saved; catalogue: WidgetInfo[]; canShare: boolean; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = new Set(d.widgets.map((w) => w.key));
  const info = (k: string) => catalogue.find((c) => c.key === k);
  const move = (i: number, by: number) => setD((x) => {
    const w = [...x.widgets];
    const [it] = w.splice(i, 1);
    w.splice(Math.max(0, Math.min(w.length, i + by)), 0, it);
    return { ...x, widgets: w };
  });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name: d.name, preset: d.preset, widgets: d.widgets, shared: d.shared, isDefault: !d.shared && d.isDefault, refreshSeconds: d.refreshSeconds };
      await api(d.id ? `/dashboards/${d.id}` : "/dashboards", { method: d.id ? "PUT" : "POST", body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{d.id ? `Edit ${initial.name}` : "New dashboard"}</h2>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!d.widgets.length}>Save</Button></div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
        <Field label="TV refresh (seconds)">{(p) => <Input {...p} inputMode="numeric" value={String(d.refreshSeconds)} onChange={(e) => setD({ ...d, refreshSeconds: Number(e.target.value) || 60 })} />}</Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          {!d.shared && <Checkbox label="My home dashboard" checked={d.isDefault} onChange={(e) => setD({ ...d, isDefault: e.target.checked })} />}
          {canShare && <Checkbox label="Share with everyone" checked={d.shared} onChange={(e) => setD({ ...d, shared: e.target.checked })} />}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">On this dashboard</p>
          <ul className="space-y-1.5">
            {d.widgets.map((w, i) => (
              <li key={w.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex-1">{info(w.key)?.title ?? w.key}</span>
                <Select className="h-8 w-28" aria-label="Width" value={String(w.size)} onChange={(e) => setD({ ...d, widgets: d.widgets.map((x) => (x.key === w.key ? { ...x, size: Number(e.target.value) as 1 | 2 | 3 } : x)) })}>
                  <option value="1">Small</option><option value="2">Half</option><option value="3">Full</option>
                </Select>
                <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="size-4" aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === d.widgets.length - 1}><ArrowDown className="size-4" aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setD({ ...d, widgets: d.widgets.filter((x) => x.key !== w.key) })}><Trash2 className="size-4" aria-hidden /></Button>
              </li>
            ))}
            {!d.widgets.length && <li className="text-sm text-muted">Add widgets from the list.</li>}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Add widgets</p>
          <div className="max-h-[28rem] space-y-3 overflow-auto pr-1">
            {Object.entries(AREAS).map(([area, label]) => {
              const ws = catalogue.filter((c) => c.area === area && !chosen.has(c.key));
              if (!ws.length) return null;
              return (
                <div key={area}>
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
                  {ws.map((c) => (
                    <button key={c.key} onClick={() => setD({ ...d, widgets: [...d.widgets, { key: c.key, size: c.size }] })} className="mt-1 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted">
                      <Plus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span><span className="font-medium">{c.title}</span><span className="block text-xs text-muted">{c.description}</span></span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
