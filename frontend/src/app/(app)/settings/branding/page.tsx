"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

interface Dns { host: string; type: string; value: string; cname?: { host: string; value: string } }
interface Branding { productName: string | null; logo: string | null; primaryColor: string | null; accentColor: string | null; supportEmail: string | null; emailFromName: string | null; emailFromAddress: string | null; smsSenderId: string | null; smsEntityId: string | null; customDomain: string | null; domainVerifiedAt: string | null; emailDomainVerifiedAt: string | null; emailSenderActive: boolean; dns: { domain: Dns | null; email: Dns | null } }
interface Partner { code: string; name: string; kind: string; certified: boolean; email: string }

/** The workspace's own brand, sender identities, custom domain and implementation partner. */
export default function BrandingPage() {
  const q = useQuery({ queryKey: ["/branding"], queryFn: () => api<Branding>("/branding") });
  const partner = useQuery({ queryKey: ["/branding/partner"], queryFn: () => api<Partner | null>("/branding/partner") });
  if (!q.data) return null;
  return <Form key={q.dataUpdatedAt} b={q.data} partner={partner.data ?? null} />;
}

function Form({ b, partner }: { b: Branding; partner: Partner | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ productName: b.productName ?? "", logo: b.logo, primaryColor: b.primaryColor ?? "", supportEmail: b.supportEmail ?? "", emailFromName: b.emailFromName ?? "", emailFromAddress: b.emailFromAddress ?? "", smsSenderId: b.smsSenderId ?? "", smsEntityId: b.smsEntityId ?? "", customDomain: b.customDomain ?? "" });
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/branding"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const save = () => run(() => api("/branding", { method: "PUT", body: { productName: f.productName || null, logo: f.logo, primaryColor: f.primaryColor || null, supportEmail: f.supportEmail || null, emailFromName: f.emailFromName || null, emailFromAddress: f.emailFromAddress || null, smsSenderId: f.smsSenderId || null, smsEntityId: f.smsEntityId || null, customDomain: f.customDomain || null } }), "Saved.");
  const readLogo = (file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setF((x) => ({ ...x, logo: String(r.result) }));
    r.readAsDataURL(file);
  };
  const dns = (d: Dns | null, verified: string | null, what: "domain" | "email") =>
    d && (
      <div className="space-y-1 rounded-lg border border-border p-3 text-xs">
        {verified ? <Badge tone="success">verified {formatDateTime(verified)}</Badge> : <Badge tone="warning">not verified</Badge>}
        <p>Add a <strong>{d.type}</strong> record on <code>{d.host}</code> with the value <code className="break-all">{d.value}</code>.</p>
        {d.cname && <p>Point <code>{d.cname.host}</code> at <code>{d.cname.value}</code> with a CNAME record.</p>}
        {!verified && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/branding/verify/${what}`, { body: {} }), "Verified.")}>Check DNS now</Button>}
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Branding" description="Your product name, logo and colour in the app and in emails; your own email sender and SMS header; your own web address. Domains are proven with a DNS TXT record before they are used." actions={<Button onClick={save}>Save</Button>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Look" />
        <div className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-muted">Product name</span><Input value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} placeholder="NextGen ERP" /></label>
          <label className="space-y-1"><span className="text-xs text-muted">Primary colour (white text must stay readable on it)</span><span className="flex gap-2"><input type="color" aria-label="Pick colour" value={f.primaryColor || "#1d4ed8"} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} className="h-9 w-12 rounded border border-border" /><Input value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} placeholder="#1d4ed8" /></span></label>
          <label className="space-y-1"><span className="text-xs text-muted">Logo (PNG, JPEG or SVG, up to 200 KB)</span><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => readLogo(e.target.files?.[0])} /></label>
          <div className="flex items-center gap-3">
            {f.logo && (
              // eslint-disable-next-line @next/next/no-img-element -- preview of a data: URL
              <img src={f.logo} alt="Logo preview" className="size-12 rounded border border-border object-contain" />
            )}
            {f.logo && <Button size="sm" variant="secondary" onClick={() => setF({ ...f, logo: null })}>Remove logo</Button>}
            <span className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: f.primaryColor || "#1d4ed8" }}>Button preview</span>
          </div>
          <label className="space-y-1"><span className="text-xs text-muted">Support email shown to users</span><Input type="email" value={f.supportEmail} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} /></label>
        </div>
      </Card>
      <Card>
        <CardHeader title="Email and SMS senders" description={b.emailSenderActive ? "Emails go out from your address." : "Emails go out from our address with your sender name until your domain is verified."} />
        <div className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-muted">Sender name</span><Input value={f.emailFromName} onChange={(e) => setF({ ...f, emailFromName: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted">Sender address</span><Input type="email" value={f.emailFromAddress} onChange={(e) => setF({ ...f, emailFromAddress: e.target.value })} placeholder="erp@yourcompany.in" /></label>
          <div className="sm:col-span-2">{dns(b.dns.email, b.emailDomainVerifiedAt, "email")}</div>
          <label className="space-y-1"><span className="text-xs text-muted">SMS header (DLT, 6 letters)</span><Input value={f.smsSenderId} onChange={(e) => setF({ ...f, smsSenderId: e.target.value.toUpperCase() })} maxLength={6} /></label>
          <label className="space-y-1"><span className="text-xs text-muted">DLT principal entity id</span><Input value={f.smsEntityId} onChange={(e) => setF({ ...f, smsEntityId: e.target.value })} maxLength={19} /></label>
        </div>
      </Card>
      <Card>
        <CardHeader title="Custom web address" />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          <Input aria-label="Custom domain" value={f.customDomain} onChange={(e) => setF({ ...f, customDomain: e.target.value })} placeholder="erp.yourcompany.in" />
          {dns(b.dns.domain, b.domainVerifiedAt, "domain")}
        </div>
      </Card>
      <Card>
        <CardHeader title="Implementation partner" description="The partner who implements or resells the system for you can see your workspace's plan and status in their portal (not your data)." />
        <div className="flex flex-wrap items-center gap-2 border-t border-border p-4 text-sm">
          {partner ? (
            <>
              <span className="font-medium">{partner.name}</span>
              <Badge>{partner.kind}</Badge>
              {partner.certified && <Badge tone="success">certified</Badge>}
              <span className="text-xs text-muted">{partner.email}</span>
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => run(() => api("/branding/partner", { method: "PUT", body: { code: null } }), "Partner removed.").then(() => qc.invalidateQueries({ queryKey: ["/branding/partner"] }))}>Remove</Button>
            </>
          ) : (
            <>
              <Input className="h-9 w-56" aria-label="Partner code" placeholder="Partner code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <Button size="sm" disabled={code.length < 2} onClick={() => run(() => api("/branding/partner", { method: "PUT", body: { code } }), "Partner set.").then(() => qc.invalidateQueries({ queryKey: ["/branding/partner"] }))}>Set partner</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
