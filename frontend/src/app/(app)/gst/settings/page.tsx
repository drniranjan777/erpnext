"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { GstSettings } from "@/lib/gst";

interface Company { id: string; name: string; gstin: string | null }

export default function GstSettingsPage() {
  const companies = useQuery({ queryKey: ["org", "companies"], queryFn: () => api<Company[]>("/org/companies") });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="GST e-compliance" description="e-Invoicing (IRN) and e-way bill settings per company. Requests go to the GST portals through the configured GSP." />
      {companies.isLoading && <LoadingBlock />}
      {companies.error && <ErrorBlock error={companies.error} />}
      {companies.data?.map((c) => <CompanySettings key={c.id} company={c} />)}
    </div>
  );
}

function CompanySettings({ company }: { company: Company }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const key = ["gst", "settings", company.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<GstSettings>(`/gst/settings/${company.id}`) });
  const [draft, setDraft] = useState<GstSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const v = draft ?? q.data;
  if (!v) return <LoadingBlock />;
  const editable = can("gst.settings.manage");
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/gst/settings/${company.id}`, { method: "PUT", body: v });
      qc.invalidateQueries({ queryKey: key });
      setDraft(null);
      setMsg({ tone: "success", text: "Saved." });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title={company.name} description={company.gstin ? `GSTIN ${company.gstin}` : "No GSTIN yet: add it under Settings → Companies first."} />
      <div className="space-y-4 px-5 pb-5">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Checkbox label="e-Invoicing applies (aggregate turnover above ₹5 crore)" checked={v.einvoice} disabled={!editable} onChange={(e) => setDraft({ ...v, einvoice: e.target.checked, autoIrn: e.target.checked && v.autoIrn })} />
        <Checkbox label="Generate the IRN automatically when an invoice or credit note is approved" checked={v.autoIrn} disabled={!editable || !v.einvoice} onChange={(e) => setDraft({ ...v, autoIrn: e.target.checked })} />
        <Field label="e-Way bill needed above (₹)" hint="₹50,000 in most states; some states set a different limit for intra-state movement" className="max-w-xs">
          {(f) => <Input {...f} inputMode="numeric" disabled={!editable} value={String(v.ewayThreshold)} onChange={(e) => setDraft({ ...v, ewayThreshold: Number(e.target.value.replace(/\D/g, "") || 0) })} />}
        </Field>
        {editable && draft && <Button loading={busy} onClick={save}>Save</Button>}
      </div>
    </Card>
  );
}
