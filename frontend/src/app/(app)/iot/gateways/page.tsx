"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Gateway } from "@/lib/iot";

/** Edge gateways: register one, copy its token into the agent, watch its health. */
export default function GatewaysPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("iot.devices.manage");
  const list = useQuery({ queryKey: ["/iot/gateways"], queryFn: () => api<Gateway[]>("/iot/gateways"), refetchInterval: 15000 });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", location: "" });
  const [token, setToken] = useState<{ code: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ code: string; token?: string } | unknown>) {
    setError(null);
    setBusy(true);
    try {
      const r = (await fn()) as { code: string; token?: string };
      if (r?.token) setToken({ code: r.code, token: r.token });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/iot/gateways"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Edge gateways"
        description="An edge gateway is a small industrial PC or container on the plant network running the NextGen edge agent. It reads the machines and sends readings here, keeping them on disk while the network is down."
        actions={manage && <Button onClick={() => { setForm({ code: "", name: "", location: "" }); setOpen(true); }}><Plus className="size-4" aria-hidden /> Register gateway</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {token && (
        <Alert tone="success">
          <p className="font-medium">Token for {token.code} — copy it now, it is not shown again.</p>
          <code className="mt-1 block break-all rounded bg-surface px-2 py-1 font-mono text-xs">{token.token}</code>
          <p className="mt-1 text-xs">Put it in the agent&apos;s edge.config.json as &quot;token&quot; (or set NEXTGEN_DEVICE_TOKEN), with &quot;server&quot; set to this ERP&apos;s API address.</p>
        </Alert>
      )}
      <Card>
        <CardHeader title="Gateways" />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Gateway</th><th className="px-4 py-2 font-medium">Health</th><th className="px-4 py-2 text-right font-medium">Signals</th><th className="px-4 py-2 font-medium">Agent</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.data?.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-2"><p className="font-medium">{g.code} · {g.name}</p><p className="text-xs text-muted">{g.location ?? ""} {g.tokenHint ? `· token …${g.tokenHint}` : ""}</p></td>
                <td className="px-4 py-2">
                  {g.status === "disabled" ? <Badge tone="neutral">disabled</Badge> : g.online ? <Badge tone="success">online</Badge> : <Badge tone="danger">{g.lastSeenAt ? `offline, seen ${timeAgo(g.lastSeenAt)}` : "never connected"}</Badge>}
                  {g.buffered > 0 && <Badge tone="warning" className="ml-1">{g.buffered} buffered</Badge>}
                  <p className="text-xs text-muted">{g.batchesLastHour} batches in the last hour{g.lastIp ? ` · ${g.lastIp}` : ""}</p>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{g.signals}</td>
                <td className="px-4 py-2 text-xs">{g.agentVersion ?? "–"}</td>
                <td className="px-4 py-2 text-right">
                  {manage && (
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => api(`/iot/gateways/${g.id}/token`, { body: {} }))}>New token</Button>
                      <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => api(`/iot/gateways/${g.id}/status`, { body: { status: g.status === "disabled" ? "active" : "disabled" } }))}>{g.status === "disabled" ? "Enable" : "Disable"}</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No gateways yet.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title="Running the agent" />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          <p>The agent is in the <code className="font-mono text-xs">edge/</code> folder of the release: Node.js 20 or later, no other software needed. Run <code className="font-mono text-xs">node agent.mjs edge.config.json</code>, or the Docker image with a volume for its buffer.</p>
          <p className="text-muted">It reads Modbus TCP registers, MQTT topics (plain values or JSON), HTTP JSON endpoints (for SCADA systems that publish REST) and a simulator for testing. Other systems can send readings straight to <code className="font-mono text-xs">POST /iot/device/ingest</code> with the gateway token.</p>
        </div>
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Register a gateway"
        footer={<Button loading={busy} disabled={!form.code || form.name.length < 2} onClick={() => run(() => api("/iot/gateways", { body: { ...form, location: form.location || null } }))}>Register</Button>}
      >
        <div className="space-y-3">
          <Field label="Code" required>{(p) => <Input {...p} value={form.code} placeholder="GW-PLANT1" onChange={(e) => setForm({ ...form, code: e.target.value })} />}</Field>
          <Field label="Name" required>{(p) => <Input {...p} value={form.name} placeholder="Moulding shop edge PC" onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Location">{(p) => <Input {...p} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </div>
  );
}
