"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { useAuth, type TenantOption } from "@/lib/auth";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const { login, verifyMfa, status } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[] | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function submit(values: Values, tenantSlug?: string) {
    setError(null);
    try {
      const step = await login(values.email, values.password, tenantSlug);
      if (step.kind === "tenants") setTenants(step.tenants);
      if (step.kind === "mfa") {
        setTenants(null);
        setMfaToken(step.mfaToken);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Please try again.");
    }
  }

  if (mfaToken) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Two-step verification</h1>
        <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        <form
          className="mt-8 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setVerifying(true);
            try {
              await verifyMfa(mfaToken, code);
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : "Could not reach the server. Please try again.";
              setError(msg);
              if (err instanceof ApiError && /timed out/i.test(err.message)) setMfaToken(null);
              setVerifying(false);
            }
          }}
        >
          {error && <Alert>{error}</Alert>}
          <Field label="Verification code">
            {(p) => (
              <Input
                {...p}
                autoFocus
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={12}
                className="text-center font-mono text-lg tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={verifying} disabled={code.trim().length < 6}>
            Verify and sign in
          </Button>
        </form>
        <button type="button" className="mt-4 text-sm text-primary" onClick={() => { setMfaToken(null); setCode(""); setError(null); }}>
          ← Back to sign in
        </button>
      </div>
    );
  }

  if (tenants) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Choose a workspace</h1>
        <p className="mt-1 text-sm text-muted">Your account has access to more than one workspace.</p>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <ul className="mt-6 space-y-2">
          {tenants.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => submit(form.getValues(), t.slug)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-primary"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted">{t.slug}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="mt-4 text-sm text-primary" onClick={() => setTenants(null)}>
          ← Use a different account
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back. Enter your details to continue.</p>

      <form className="mt-8 space-y-4" noValidate onSubmit={form.handleSubmit((v) => submit(v))}>
        {error && <Alert>{error}</Alert>}
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus {...form.register("email")} />}
        </Field>
        <Field label="Password" error={errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register("password")} />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New to NextGen ERP?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Start a free trial
        </Link>
      </p>
    </div>
  );
}
