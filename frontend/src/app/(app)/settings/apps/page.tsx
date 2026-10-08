"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError, apiDownload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { askText } from "@/components/ui/ask";

interface App {
  key: string; name: string; category: string; description: string; webhook?: boolean; local?: boolean;
  fields: { key: string; label: string; secret?: boolean; required?: boolean }[];
  actions: { key: string; label: string; needs?: "deliveryId" | "invoiceId" | "roleId" }[];
  installed: { id: string; mode: string; enabled: boolean; config: Record<string, string>; hasSecrets: boolean; lastRunAt: string | null; lastStatus: string | null; webhookPath: string | null } | null;
}
interface Run { id: string; action: string; status: string; stats: Record<string, number>; log: string[]; hasOutput: boolean; startedAt: string; by: string | null }

const CATEGORY: Record<string, string> = { accounting: "Accounting", commerce: "Online sales", crm: "Leads", logistics: "Shipping", payments: "Payments", productivity: "Directory" };
const TONE: Record<string, "success" | "warning" | "danger"> = { ok: "success", partial: "warning", failed: "danger" };

/** App marketplace: connectors to install, configure and run. */
export default function AppsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("apps.connectors.manage");
  const apps = useQuery({ queryKey: ["/apps"], queryFn: () => api<App[]>("/apps") });
  const [setup, setSetup] = useState<App | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [secretShown, setSecretShown] = useState<{ name: string; secret: string; path: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const opened = apps.data?.find((a) => a.installed?.id === open);
  const runs = useQuery({ queryKey: ["/apps", open, "runs"], queryFn: () => api<Run[]>(`/apps/${open}/runs`), enabled: !!open });
  async function act(a: App, action: App["actions"][number]) {
    setMsg(null);
    let body: Record<string, string> = {};
    if (action.needs) {
      const v = await askText(action.needs === "deliveryId" ? "Delivery note id" : action.needs === "invoiceId" ? "Sales invoice id" : "Role id for the invited users");
      if (!v) return;
      body = { [action.needs]: v.trim() };
    }
    try {
      const r = await api<{ status: string; log: string[]; stats: Record<string, number> }>(`/apps/${a.installed!.id}/actions/${action.key}`, { body });
      setMsg({ tone: r.status === "failed" ? "danger" : "success", text: `${a.name}: ${r.status}. ${r.log.slice(0, 3).join(" · ")}` });
      setOpen(a.installed!.id);
      qc.invalidateQueries({ queryKey: ["/apps"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const groups = Object.keys(CATEGORY).map((c) => [c, apps.data?.filter((a) => a.category === c) ?? []] as const);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="App marketplace" description="Connectors to accounting, online stores and marketplaces, lead sources, couriers, payments and directories. Without network access to an outside service a connector runs in sandbox mode with sample data, so flows can be tried end to end." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {secretShown && <Alert tone="warning">Webhook for {secretShown.name}: POST to <code>{secretShown.path}</code>, signed with the secret <code className="break-all">{secretShown.secret}</code>. It is shown only once.</Alert>}
      {groups.map(([cat, list]) => list.length > 0 && (
        <section key={cat} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">{CATEGORY[cat]}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((a) => (
              <Card key={a.key} className="space-y-2 p-4">
                <p className="flex flex-wrap items-center gap-2 font-medium">{a.name}{a.installed ? <Badge tone={a.installed.enabled ? "success" : "neutral"}>{a.installed.enabled ? (a.installed.mode === "live" ? "live" : "sandbox") : "off"}</Badge> : <Badge>not installed</Badge>}{a.installed?.lastStatus && <Badge tone={TONE[a.installed.lastStatus]}>last run {a.installed.lastStatus} {timeAgo(a.installed.lastRunAt)}</Badge>}</p>
                <p className="text-sm text-muted">{a.description}</p>
                {manage && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setSetup(a)}>{a.installed ? "Settings" : "Install"}</Button>
                    {a.installed?.enabled && a.actions.map((x) => <Button key={x.key} size="sm" onClick={() => act(a, x)}>{x.label}</Button>)}
                    {a.installed && <Button size="sm" variant="secondary" onClick={() => setOpen(open === a.installed!.id ? null : a.installed!.id)}>Runs</Button>}
                    {a.installed && <Button size="sm" variant="secondary" onClick={() => api(`/apps/${a.installed!.id}/enabled`, { body: { enabled: !a.installed!.enabled } }).then(() => qc.invalidateQueries({ queryKey: ["/apps"] }))}>{a.installed.enabled ? "Switch off" : "Switch on"}</Button>}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      ))}
      {opened && (
        <Card>
          <CardHeader title={`${opened.name} runs`} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {runs.data?.map((r) => (
              <li key={r.id} className="space-y-1 px-4 py-2">
                <p className="flex flex-wrap items-center gap-2"><Badge tone={TONE[r.status]}>{r.status}</Badge><span className="font-medium">{r.action.replace("_", " ")}</span><span className="text-xs text-muted">{formatDateTime(r.startedAt)}{r.by ? ` · ${r.by}` : ""} · {Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(", ")}</span>{r.hasOutput && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => apiDownload(`/apps/runs/${r.id}/output`, `${opened.key}-${r.startedAt.slice(0, 10)}.xml`)}>Download file</Button>}</p>
                {r.log.length > 0 && <p className="text-xs text-muted">{r.log.slice(0, 6).join(" · ")}{r.log.length > 6 ? " …" : ""}</p>}
              </li>
            ))}
            {runs.data && !runs.data.length && <li className="px-4 py-4 text-center text-muted">No runs yet.</li>}
          </ul>
        </Card>
      )}
      {setup && <Setup app={setup} onClose={() => setSetup(null)} onDone={(r) => { setSetup(null); if (r.webhookSecret) setSecretShown({ name: setup.name, secret: r.webhookSecret, path: r.webhookPath ?? "" }); qc.invalidateQueries({ queryKey: ["/apps"] }); }} />}
    </div>
  );
}

function Setup({ app, onClose, onDone }: { app: App; onClose: () => void; onDone: (r: { webhookSecret?: string; webhookPath: string | null }) => void }) {
  const [mode, setMode] = useState(app.installed?.mode ?? "sandbox");
  const [config, setConfig] = useState<Record<string, string>>(app.installed?.config ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      onDone(await api<{ webhookSecret?: string; webhookPath: string | null }>("/apps", { body: { connector: app.key, mode, config, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)) } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`${app.name} settings`} footer={<Button onClick={save}>{app.installed ? "Save" : "Install"}</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        {!app.local && <Select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="sandbox">Sandbox (sample data, no outside calls)</option><option value="live">Live (needs credentials and network access)</option></Select>}
        {app.fields.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-xs text-muted">{f.label}{f.required ? " *" : ""}{f.secret && app.installed?.hasSecrets ? " (saved; leave blank to keep)" : ""}</span>
            <Input type={f.secret ? "password" : "text"} autoComplete="off" value={f.secret ? (secrets[f.key] ?? "") : (config[f.key] ?? "")} onChange={(e) => (f.secret ? setSecrets({ ...secrets, [f.key]: e.target.value }) : setConfig({ ...config, [f.key]: e.target.value }))} />
          </label>
        ))}
        {app.webhook && <p className="text-xs text-muted">This connector also accepts pushes: the webhook address and secret are shown once after installing.</p>}
      </div>
    </Dialog>
  );
}
