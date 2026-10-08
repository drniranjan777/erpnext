"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PermissionGroup } from "@/lib/iam";
import { askConfirm } from "@/components/ui/ask";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  version: number;
  createdAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

function SecretOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onDone} title={label} description="Copy it now. For security it won't be shown again." footer={<Button onClick={onDone}>Done</Button>}>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={label} />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Dialog>
  );
}

export default function IntegrationsPage() {
  const { me } = useAuth();
  const planBlocked = me && !me.plan.features.includes("api_access");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="API & webhooks" description="Connect NextGen ERP to Tally, e-commerce, BI tools or your own software." />
      {planBlocked && <Alert tone="warning">API keys and webhooks are available on the Growth plan and above. See Settings → Billing.</Alert>}
      <ApiKeysCard />
      <WebhooksCard />
      <Card className="px-5 py-4 text-sm text-muted">
        <p className="font-medium text-foreground">Developer notes</p>
        <p className="mt-1">
          Send the key as <code>X-API-Key: ngk_…</code> (or <code>Authorization: Bearer ngk_…</code>). Full API reference: <code>/api/docs</code>. Webhooks are signed: verify{" "}
          <code>X-NextGen-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code> where <code>v1 = HMAC-SHA256(secret, &quot;t.body&quot;)</code>.
        </p>
      </Card>
    </div>
  );
}

function ApiKeysCard() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["integrations", "keys"], queryFn: () => api<ApiKey[]>("/platform/api-keys") });
  const catalog = useQuery({ queryKey: ["iam", "permissions"], queryFn: () => api<PermissionGroup[]>("/iam/permissions") });
  const { me } = useAuth();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("365");
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ key: string }>("/platform/api-keys", { body: { name, scopes, expiresInDays: expiry ? Number(expiry) : null } }),
    onSuccess: (r) => {
      setCreating(false);
      setName("");
      setScopes([]);
      setSecret(r.key);
      qc.invalidateQueries({ queryKey: ["integrations", "keys"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/platform/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", "keys"] }),
  });
  const grantable = (catalog.data ?? []).map((g) => ({ ...g, permissions: g.permissions.filter((p) => me?.permissions.includes(p.code)) })).filter((g) => g.permissions.length);

  return (
    <Card>
      <CardHeader
        title="API keys"
        description="Each key acts on your behalf with only the permissions you choose."
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden /> New key
          </Button>
        }
      />
      {keys.isLoading && <LoadingBlock />}
      {keys.error && <div className="p-5"><ErrorBlock error={keys.error} /></div>}
      {keys.data?.length === 0 && <EmptyState title="No API keys" />}
      <ul className="divide-y divide-border">
        {keys.data?.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <KeyRound className="size-4 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {k.name}
                {k.revokedAt ? <Badge tone="danger">Revoked</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge tone="warning">Expired</Badge> : <Badge tone="success">Active</Badge>}
              </p>
              <p className="text-xs text-muted">
                <code>ngk_{k.prefix}_…</code> · {k.scopes.length} permissions · by {k.createdBy} · last used {timeAgo(k.lastUsedAt).toLowerCase()}
                {k.expiresAt && ` · expires ${formatDateTime(k.expiresAt)}`}
              </p>
            </div>
            {!k.revokedAt && (
              <Button variant="ghost" size="sm" onClick={async () => await askConfirm(`Revoke "${k.name}"? Integrations using it stop immediately.`) && revoke.mutate(k.id)} aria-label={`Revoke ${k.name}`}>
                <Trash2 className="size-4 text-danger" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {creating && (
        <Dialog
          open
          size="lg"
          onClose={() => setCreating(false)}
          title="New API key"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button loading={create.isPending} disabled={name.trim().length < 2 || !scopes.length} onClick={() => create.mutate()}>
                Create key
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {create.error && <Alert>{(create.error as Error).message}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                {(p) => <Input {...p} placeholder="e.g. Tally sync" value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label="Expires">
                {(p) => (
                  <Select {...p} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                    <option value="30">In 30 days</option>
                    <option value="90">In 90 days</option>
                    <option value="365">In 1 year</option>
                    <option value="">Never</option>
                  </Select>
                )}
              </Field>
            </div>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium">Permissions</legend>
              {grantable.map((g) => (
                <div key={g.module}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.permissions.map((p) => (
                      <Checkbox key={p.code} label={p.description} checked={scopes.includes(p.code)} onChange={(e) => setScopes((s) => (e.target.checked ? [...s, p.code] : s.filter((x) => x !== p.code)))} />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          </div>
        </Dialog>
      )}
      {secret && <SecretOnce label="Your new API key" value={secret} onDone={() => setSecret(null)} />}
    </Card>
  );
}

function WebhooksCard() {
  const qc = useQueryClient();
  const hooks = useQuery({ queryKey: ["integrations", "webhooks"], queryFn: () => api<WebhookEndpoint[]>("/platform/webhooks") });
  const events = useQuery({ queryKey: ["integrations", "events"], queryFn: () => api<{ value: string; description: string }[]>("/platform/webhooks/events") });
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("https://");
  const [selected, setSelected] = useState<string[]>(["*"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });

  const create = useMutation({
    mutationFn: () => api<{ secret: string }>("/platform/webhooks", { body: { url, events: selected } }),
    onSuccess: (r) => {
      setCreating(false);
      setSecret(r.secret);
      setUrl("https://");
      refresh();
    },
  });
  const update = useMutation({ mutationFn: (h: WebhookEndpoint) => api(`/platform/webhooks/${h.id}`, { method: "PATCH", body: { version: h.version, isActive: !h.isActive } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api<void>(`/platform/webhooks/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const rotate = useMutation({ mutationFn: (id: string) => api<{ secret: string }>(`/platform/webhooks/${id}/rotate-secret`, { method: "POST" }), onSuccess: (r) => setSecret(r.secret) });
  const test = useMutation({
    mutationFn: (id: string) => api(`/platform/webhooks/${id}/test`, { method: "POST" }),
    onSuccess: (_r, id) => {
      setOpen(id);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["integrations", "deliveries", id] }), 1500);
    },
  });
  const error = create.error ?? update.error ?? remove.error ?? rotate.error ?? test.error;

  return (
    <Card>
      <CardHeader
        title="Webhooks"
        description="We POST signed JSON to your URL when things happen. Failed deliveries are retried with back-off."
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden /> New webhook
          </Button>
        }
      />
      {error && <div className="px-5 pt-4"><Alert>{(error as Error).message}</Alert></div>}
      {hooks.isLoading && <LoadingBlock />}
      {hooks.data?.length === 0 && <EmptyState title="No webhooks" />}
      <ul className="divide-y divide-border">
        {hooks.data?.map((h) => (
          <li key={h.id} className="px-5 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Webhook className="size-4 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{h.url}</p>
                <p className="text-xs text-muted">{h.events.includes("*") ? "All events" : h.events.join(", ")}</p>
              </div>
              <Badge tone={h.isActive ? "success" : "neutral"}>{h.isActive ? "Active" : "Paused"}</Badge>
              <Button variant="ghost" size="sm" loading={test.isPending && test.variables === h.id} onClick={() => test.mutate(h.id)}>
                <Send className="size-3.5" aria-hidden /> Test
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(open === h.id ? null : h.id)}>
                Deliveries
              </Button>
              <Button variant="ghost" size="sm" onClick={() => update.mutate(h)}>
                {h.isActive ? "Pause" : "Resume"}
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => await askConfirm("Rotate the signing secret? Your receiver must be updated.") && rotate.mutate(h.id)} aria-label="Rotate secret">
                <RefreshCw className="size-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => await askConfirm("Delete this webhook?") && remove.mutate(h.id)} aria-label="Delete webhook">
                <Trash2 className="size-4 text-danger" />
              </Button>
            </div>
            {open === h.id && <Deliveries endpointId={h.id} />}
          </li>
        ))}
      </ul>
      {creating && (
        <Dialog
          open
          onClose={() => setCreating(false)}
          title="New webhook"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button loading={create.isPending} disabled={!url.startsWith("http") || !selected.length} onClick={() => create.mutate()}>
                Create webhook
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : "Failed"}</Alert>}
            <Field label="Endpoint URL" required hint="Must be a public https:// address">
              {(p) => <Input {...p} className="font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} />}
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Events</legend>
              <Checkbox label="All events" checked={selected.includes("*")} onChange={(e) => setSelected(e.target.checked ? ["*"] : [])} />
              {!selected.includes("*") &&
                events.data?.map((ev) => (
                  <Checkbox key={ev.value} label={ev.value} description={ev.description} checked={selected.includes(ev.value)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, ev.value] : s.filter((x) => x !== ev.value)))} />
                ))}
            </fieldset>
          </div>
        </Dialog>
      )}
      {secret && <SecretOnce label="Webhook signing secret" value={secret} onDone={() => setSecret(null)} />}
    </Card>
  );
}

function Deliveries({ endpointId }: { endpointId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["integrations", "deliveries", endpointId], queryFn: () => api<Delivery[]>(`/platform/webhooks/${endpointId}/deliveries`), refetchInterval: 5000 });
  const redeliver = useMutation({
    mutationFn: (id: string) => api(`/platform/webhooks/deliveries/${id}/redeliver`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", "deliveries", endpointId] }),
  });
  if (list.isLoading) return <LoadingBlock />;
  if (!list.data?.length) return <p className="mt-3 text-xs text-muted">No deliveries yet.</p>;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-muted text-left text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {list.data.map((d) => (
            <tr key={d.id}>
              <td className="whitespace-nowrap px-3 py-2">{formatDateTime(d.createdAt)}</td>
              <td className="px-3 py-2 font-mono">{d.event}</td>
              <td className="px-3 py-2">
                <Badge tone={d.status === "succeeded" ? "success" : d.status === "failed" ? "danger" : "warning"}>{d.status}</Badge>{" "}
                {d.responseStatus && <span className="text-muted">HTTP {d.responseStatus}</span>} {d.durationMs !== null && <span className="text-muted">· {d.durationMs} ms</span>}
                {d.error && <p className="text-danger">{d.error}</p>}
              </td>
              <td className="px-3 py-2 text-right">
                {d.status === "failed" && (
                  <Button variant="ghost" size="sm" onClick={() => redeliver.mutate(d.id)}>
                    Retry
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
