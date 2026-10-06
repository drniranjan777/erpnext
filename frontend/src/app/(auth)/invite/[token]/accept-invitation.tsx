"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface InvitationPreview {
  email: string;
  fullName: string | null;
  workspace: { name: string; slug: string };
  invitedBy: string;
  expiresAt: string;
  existingAccount: boolean;
  mfaRequired: boolean;
}

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const { acceptInvitation } = useAuth();
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<InvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [fullName, setFullName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  if (preview.isLoading) return <LoadingBlock />;

  if (preview.error) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
        <div className="mt-6">
          <Alert>{preview.error instanceof ApiError ? preview.error.message : "Could not load this invitation."}</Alert>
        </div>
        <p className="mt-6 text-sm text-muted">
          Already joined?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  const inv = preview.data!;
  const name = fullName ?? inv.fullName ?? "";
  const isNew = !inv.existingAccount;
  const mismatch = isNew && confirm.length > 0 && confirm !== password;
  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvitation(token, isNew ? { fullName: name, password } : { password, mfaCode: inv.mfaRequired ? mfaCode : undefined });
      router.replace("/dashboard");
    } catch (err) {
      setError(err as Error);
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted">{inv.invitedBy} invited you to join</p>
      <h1 className="mt-1 text-2xl font-semibold">{inv.workspace.name}</h1>

      <form className="mt-8 space-y-4" noValidate onSubmit={submit}>
        {error && !Object.keys(fieldErrors).length && <Alert>{error.message}</Alert>}
        <Field label="Email">{(p) => <Input {...p} value={inv.email} disabled />}</Field>

        {isNew ? (
          <>
            <Field label="Your name" required error={fieldErrors.fullName}>
              {(p) => <Input {...p} autoComplete="name" autoFocus value={name} onChange={(e) => setFullName(e.target.value)} />}
            </Field>
            <Field label="Create a password" required error={fieldErrors.password} hint="At least 10 characters, with a letter and a number">
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Field label="Confirm password" required error={mismatch ? "Passwords don't match" : undefined}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
            </Field>
          </>
        ) : (
          <Field
            label="Your NextGen ERP password"
            required
            error={fieldErrors.password}
            hint="You already have an account. Confirm your password to add this workspace."
          >
            {(p) => <Input {...p} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        )}
        {!isNew && inv.mfaRequired && (
          <Field label="Two-step verification code" required error={fieldErrors.mfaCode} hint="From your authenticator app">
            {(p) => <Input {...p} autoComplete="one-time-code" maxLength={12} className="font-mono" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />}
          </Field>
        )}

        <Button type="submit" className="w-full" size="lg" loading={submitting} disabled={!password || (isNew && (!name || !confirm || mismatch))}>
          Join {inv.workspace.name}
        </Button>
      </form>
    </div>
  );
}
