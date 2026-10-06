"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { INDUSTRIES } from "@/lib/industries";

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Mirrors backend/src/modules/auth/auth.schemas.ts (server is the source of truth).
const schema = z.object({
  companyName: z.string().trim().min(2, "Enter your company name"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || GSTIN.test(v), "Enter a valid 15-character GSTIN"),
  industry: z.string().min(1, "Select your industry"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, "Use 3–32 lowercase letters, numbers or hyphens"),
  fullName: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email address"),
  mobile: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[6-9][0-9]{9}$/.test(v), "Enter a valid 10-digit mobile number"),
  password: z
    .string()
    .min(10, "At least 10 characters")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number"),
});
type Values = z.infer<typeof schema>;

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/(pvt|private|ltd|limited|llp|inc)\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export function SignupForm() {
  const router = useRouter();
  const { signup } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { companyName: "", gstin: "", industry: "", slug: "", fullName: "", email: "", mobile: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const companyField = form.register("companyName", {
    onChange: (e) => {
      if (!slugTouched) form.setValue("slug", toSlug(e.target.value));
    },
  });

  async function onSubmit(v: Values) {
    setError(null);
    try {
      await signup({
        workspaceName: v.companyName,
        companyName: v.companyName,
        slug: v.slug,
        industry: v.industry,
        gstin: v.gstin || undefined,
        fullName: v.fullName,
        email: v.email,
        mobile: v.mobile || undefined,
        password: v.password,
      });
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [path, message] of Object.entries(err.fieldErrors)) {
          if (path in schema.shape) form.setError(path as keyof Values, { message });
        }
        setError(err.message);
      } else {
        setError("Could not reach the server. Please try again.");
      }
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Start your free trial</h1>
      <p className="mt-1 text-sm text-muted">30 days, full access. No card needed.</p>

      <form className="mt-8 space-y-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        {error && <Alert>{error}</Alert>}

        <fieldset className="space-y-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your business</legend>
          <Field label="Company name" required error={errors.companyName?.message}>
            {(p) => <Input {...p} autoComplete="organization" autoFocus {...companyField} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN" hint="Optional, you can add it later" error={errors.gstin?.message}>
              {(p) => <Input {...p} maxLength={15} className="uppercase" {...form.register("gstin")} />}
            </Field>
            <Field label="Industry" required error={errors.industry?.message}>
              {(p) => (
                <Select {...p} {...form.register("industry")}>
                  <option value="">Select…</option>
                  {INDUSTRIES.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((i) => (
                        <option key={i.value} value={i.value}>
                          {i.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Workspace URL" required error={errors.slug?.message} hint="Used to sign in to your workspace">
            {(p) => (
              <div className="flex items-center rounded-lg border border-border bg-surface-muted focus-within:ring-2 focus-within:ring-ring">
                <Input
                  {...p}
                  className="border-0 focus:ring-0"
                  {...form.register("slug", { onChange: () => setSlugTouched(true) })}
                />
                <span className="shrink-0 px-3 text-sm text-muted">.nextgenerp.in</span>
              </div>
            )}
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your account</legend>
          <Field label="Full name" required error={errors.fullName?.message}>
            {(p) => <Input {...p} autoComplete="name" {...form.register("fullName")} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work email" required error={errors.email?.message}>
              {(p) => <Input {...p} type="email" autoComplete="email" {...form.register("email")} />}
            </Field>
            <Field label="Mobile" error={errors.mobile?.message}>
              {(p) => <Input {...p} type="tel" inputMode="numeric" maxLength={10} autoComplete="tel-national" {...form.register("mobile")} />}
            </Field>
          </div>
          <Field label="Password" required error={errors.password?.message} hint="At least 10 characters, with a letter and a number">
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("password")} />}
          </Field>
        </fieldset>

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Create workspace
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
