"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

interface Settings { protocol: string; enabled: boolean; issuer: string | null; clientId: string | null; hasClientSecret: boolean; idpEntityId: string | null; idpSsoUrl: string | null; allowedDomains: string[]; autoProvision: boolean; defaultRoleId: string | null; requireSso: boolean }
interface Sso { settings: Settings | null; redirectUri: string; startUrl: string; samlMetadataUrl: string }
interface Token { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; defaultRole: string | null }
interface Role { id: string; name: string }

/** Single sign-on (OIDC) and SCIM provisioning. */
export default function SsoPage() {
  const q = useQuery({ queryKey: ["/platform/sso"], queryFn: () => api<Sso>("/platform/sso") });
  const roles = useQuery({ queryKey: ["/iam/roles"], queryFn: () => api<Role[]>("/iam/roles") });
  if (!q.data || !roles.data) return null;
  return <SsoForm key={q.dataUpdatedAt} sso={q.data} roles={roles.data} />;
}

function SsoForm({ sso, roles }: { sso: Sso; roles: Role[] }) {
  const qc = useQueryClient();
  const s = sso.settings;
  const [f, setF] = useState({ protocol: s?.protocol ?? "oidc", enabled: s?.enabled ?? false, issuer: s?.issuer ?? "", clientId: s?.clientId ?? "", clientSecret: "", idpEntityId: s?.idpEntityId ?? "", idpSsoUrl: s?.idpSsoUrl ?? "", domains: (s?.allowedDomains ?? []).join(", "), autoProvision: s?.autoProvision ?? false, defaultRoleId: s?.defaultRoleId ?? "", requireSso: s?.requireSso ?? false });
  const tokens = useQuery({ queryKey: ["/platform/scim/tokens"], queryFn: () => api<Token[]>("/platform/scim/tokens") });
  const [tok, setTok] = useState({ name: "", roleId: "" });
  const [shown, setShown] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/platform"] });
      return r;
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const save = () => run(() => api("/platform/sso", { method: "PUT", body: { protocol: f.protocol, enabled: f.enabled, issuer: f.issuer || null, clientId: f.clientId || null, clientSecret: f.clientSecret || null, idpEntityId: f.idpEntityId || null, idpSsoUrl: f.idpSsoUrl || null, allowedDomains: f.domains.split(",").map((d) => d.trim()).filter(Boolean), autoProvision: f.autoProvision, defaultRoleId: f.defaultRoleId || null, requireSso: f.requireSso } }), "Saved.");
  const field = (label: string, el: React.ReactNode) => <label className="block space-y-1"><span className="text-xs text-muted">{label}</span>{el}</label>;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Single sign-on" description="People sign in with their company account (Microsoft Entra ID, Google Workspace, Okta…) over OpenID Connect, and your identity provider can create, update and deactivate users through SCIM 2.0." actions={<Button onClick={save}>Save</Button>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Identity provider" description={`Redirect URI to register: ${sso.redirectUri} · sign-in link: ${sso.startUrl}`} />
        <div className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-2">
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Single sign-on is on</label>
          {field("Protocol", <Select value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })}><option value="oidc">OpenID Connect</option><option value="saml">SAML 2.0 (metadata only for now)</option></Select>)}
          {f.protocol === "oidc" ? (
            <>
              {field("Issuer URL", <Input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" />)}
              {field("Client ID", <Input value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />)}
              {field(`Client secret${s?.hasClientSecret ? " (saved; leave blank to keep)" : ""}`, <Input type="password" autoComplete="off" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} />)}
            </>
          ) : (
            <>
              {field("IdP entity ID", <Input value={f.idpEntityId} onChange={(e) => setF({ ...f, idpEntityId: e.target.value })} />)}
              {field("IdP sign-in URL", <Input value={f.idpSsoUrl} onChange={(e) => setF({ ...f, idpSsoUrl: e.target.value })} />)}
              <p className="text-xs text-muted sm:col-span-2">Our service provider metadata: <a className="text-primary hover:underline" href={sso.samlMetadataUrl}>{sso.samlMetadataUrl}</a>. Sign-in itself uses OpenID Connect, which every major identity provider supports.</p>
            </>
          )}
          {field("Allowed email domains", <Input value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="acme.in, acme.com" />)}
          {field("Role for new users", <Select value={f.defaultRoleId} onChange={(e) => setF({ ...f, defaultRoleId: e.target.value })}><option value="">No role</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.autoProvision} onChange={(e) => setF({ ...f, autoProvision: e.target.checked })} /> Create users on their first sign-in</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.requireSso} onChange={(e) => setF({ ...f, requireSso: e.target.checked })} /> Require SSO (owners keep password sign-in)</label>
        </div>
      </Card>
      <Card>
        <CardHeader title="SCIM provisioning" description={`Base URL for your identity provider: ${sso.redirectUri.replace("/auth/sso/callback", "/scim/v2")}`} />
        {shown && <div className="border-t border-border p-4"><Alert tone="warning">Copy this token now; it is not shown again: <code className="break-all">{shown}</code></Alert></div>}
        <ul className="divide-y divide-border border-t border-border text-sm">
          {tokens.data?.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2"><span className="font-medium">{t.name}</span><span className="text-xs text-muted">scim_{t.prefix}_… · {t.defaultRole ?? "no role"} · created {formatDateTime(t.createdAt)}{t.lastUsedAt ? ` · last used ${formatDateTime(t.lastUsedAt)}` : ""}</span>{t.revokedAt ? <Badge tone="danger">revoked</Badge> : <Button size="sm" variant="secondary" className="ml-auto" onClick={() => run(() => api(`/platform/scim/tokens/${t.id}`, { method: "DELETE" }), "Token revoked.")}>Revoke</Button>}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
          <Input className="h-9 w-56" aria-label="Token name" placeholder="Name (e.g. Entra ID)" value={tok.name} onChange={(e) => setTok({ ...tok, name: e.target.value })} />
          <Select className="h-9 w-48" aria-label="Role" value={tok.roleId} onChange={(e) => setTok({ ...tok, roleId: e.target.value })}><option value="">Role for new users…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <Button size="sm" disabled={tok.name.length < 2} onClick={() => run(() => api<{ token: string }>("/platform/scim/tokens", { body: { name: tok.name, defaultRoleId: tok.roleId || null } }), "Token created.").then((r) => r && setShown(r.token))}>Create token</Button>
        </div>
      </Card>
    </div>
  );
}
