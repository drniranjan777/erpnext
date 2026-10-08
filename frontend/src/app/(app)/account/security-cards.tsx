"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { askConfirm } from "@/components/ui/ask";

// ---------------------------------------------------------------------------
// Two-step verification
// ---------------------------------------------------------------------------

export function MfaCard() {
  const qc = useQueryClient();
  const { refreshMe } = useAuth();
  const status = useQuery({ queryKey: ["account", "mfa"], queryFn: () => api<{ enabled: boolean; recoveryCodesRemaining: number }>("/account/mfa") });
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ["account", "mfa"] });
    await refreshMe();
  };

  const start = useMutation({ mutationFn: () => api<{ secret: string; qrCode: string }>("/account/mfa/setup", { method: "POST" }), onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/account/mfa/enable", { body: { code } }),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode("");
      await done();
    },
  });
  const disable = useMutation({
    mutationFn: () => api("/account/mfa/disable", { body: { password } }),
    onSuccess: async () => {
      setPassword("");
      await done();
    },
  });
  const regen = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/account/mfa/recovery-codes", { body: { password } }),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setPassword("");
      await done();
    },
  });
  const error = start.error ?? enable.error ?? disable.error ?? regen.error;
  const enabled = status.data?.enabled;

  return (
    <Card>
      <CardHeader
        title="Two-step verification"
        description="Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…)."
        action={enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
      />
      <div className="space-y-4 px-5 py-4 text-sm">
        {error && <Alert>{error instanceof ApiError ? error.message : "Something went wrong"}</Alert>}

        {codes && (
          <div className="rounded-lg border border-warning bg-warning-soft p-4">
            <p className="font-medium text-warning">Save these recovery codes now. They won&apos;t be shown again.</p>
            <p className="mt-1 text-xs">Each code works once if you lose your phone.</p>
            <ul className="mt-3 grid grid-cols-2 gap-2 font-mono sm:grid-cols-5">
              {codes.map((c) => (
                <li key={c} className="rounded bg-surface px-2 py-1 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(codes.join("\n"))}>
                <Copy className="size-3.5" aria-hidden /> Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCodes(null)}>
                I&apos;ve saved them
              </Button>
            </div>
          </div>
        )}

        {!enabled && !setup && (
          <Button onClick={() => start.mutate()} loading={start.isPending}>
            <ShieldCheck className="size-4" aria-hidden /> Turn on two-step verification
          </Button>
        )}

        {setup && (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <Image src={setup.qrCode} alt="QR code for your authenticator app" width={176} height={176} unoptimized className="rounded-lg border border-border bg-white p-2" />
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Open your authenticator app and scan the QR code.</li>
                <li>
                  Can&apos;t scan? Enter this key: <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-foreground">{setup.secret}</code>
                </li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  enable.mutate();
                }}
              >
                <Input aria-label="6-digit code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="w-36 text-center font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
                  Verify and turn on
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                  Cancel
                </Button>
              </form>
            </div>
          </div>
        )}

        {enabled && (
          <div className="space-y-3">
            <p className="text-muted">{status.data?.recoveryCodesRemaining} recovery codes left.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Confirm your password to change settings" className="w-64">
                {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
              <Button variant="secondary" disabled={!password} loading={regen.isPending} onClick={() => regen.mutate()}>
                New recovery codes
              </Button>
              <Button variant="danger" disabled={!password} loading={disable.isPending} onClick={async () => await askConfirm("Turn off two-step verification?") && disable.mutate()}>
                Turn off
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Privacy (DPDP Act)
// ---------------------------------------------------------------------------

interface DataRequest {
  id: string;
  type: "correction" | "erasure" | "grievance";
  details: string;
  status: "open" | "completed" | "rejected";
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function PrivacyCard() {
  const qc = useQueryClient();
  const [type, setType] = useState<DataRequest["type"]>("correction");
  const [details, setDetails] = useState("");
  const [downloading, setDownloading] = useState(false);
  const requests = useQuery({ queryKey: ["account", "data-requests"], queryFn: () => api<DataRequest[]>("/account/data-requests") });
  const raise = useMutation({
    mutationFn: () => api("/account/data-requests", { body: { type, details } }),
    onSuccess: () => {
      setDetails("");
      qc.invalidateQueries({ queryKey: ["account", "data-requests"] });
    },
  });

  async function download() {
    setDownloading(true);
    try {
      const data = await api<unknown>("/account/data-export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Your data & privacy" description="Your rights under India's Digital Personal Data Protection Act, 2023." />
      <div className="space-y-5 px-5 py-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted">Download a copy of the personal data we hold about you in this workspace.</p>
          <Button variant="secondary" loading={downloading} onClick={download}>
            <Download className="size-4" aria-hidden /> Download my data
          </Button>
        </div>
        <form
          className="space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            raise.mutate();
          }}
        >
          <p className="font-medium">Make a request</p>
          {raise.error && <Alert>{(raise.error as Error).message}</Alert>}
          {raise.isSuccess && <Alert tone="success">Request sent to your workspace&apos;s data protection contact.</Alert>}
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <Field label="Request type">
              {(p) => (
                <Select {...p} value={type} onChange={(e) => setType(e.target.value as DataRequest["type"])}>
                  <option value="correction">Correct my data</option>
                  <option value="erasure">Erase my data</option>
                  <option value="grievance">Raise a grievance</option>
                </Select>
              )}
            </Field>
            <Field label="Details">
              {(p) => <Input {...p} placeholder="What should change, and why?" value={details} onChange={(e) => setDetails(e.target.value)} />}
            </Field>
          </div>
          <Button type="submit" size="sm" loading={raise.isPending} disabled={details.trim().length < 10}>
            Submit request
          </Button>
        </form>
        {!!requests.data?.length && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {requests.data.map((r) => (
              <li key={r.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{r.type}</span>
                  <Badge tone={r.status === "open" ? "warning" : r.status === "completed" ? "success" : "danger"}>{r.status}</Badge>
                  <span className="ml-auto text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                </div>
                <p className="mt-1 text-muted">{r.details}</p>
                {r.resolution && <p className="mt-1">Response: {r.resolution}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
