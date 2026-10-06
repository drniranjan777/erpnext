"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { describeDevice } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import { NotificationPreferences } from "./notification-preferences";
import { MfaCard, PrivacyCard } from "./security-cards";

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="My account" description="Your profile, notifications, security and privacy." />
      <ProfileCard />
      <NotificationPreferences />
      <PasswordCard />
      <MfaCard />
      <SessionsCard />
      <PrivacyCard />
    </div>
  );
}

function ProfileCard() {
  const { me, refreshMe } = useAuth();
  const [fullName, setFullName] = useState(me?.user.fullName ?? "");
  const [mobile, setMobile] = useState(me?.user.mobile ?? "");
  const save = useMutation({
    mutationFn: () => api("/account/profile", { method: "PATCH", body: { fullName, mobile } }),
    onSuccess: () => refreshMe(),
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  return (
    <Card>
      <CardHeader title="Profile" />
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.isSuccess && <Alert tone="success">Profile saved.</Alert>}
        {save.error && !Object.keys(errors).length && <Alert>{(save.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.fullName}>
            {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
          </Field>
          <Field label="Mobile" error={errors.mobile}>
            {(p) => <Input {...p} type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value)} />}
          </Field>
        </div>
        <Field label="Email" hint="Contact your administrator to change your email.">
          {(p) => <Input {...p} value={me?.user.email ?? ""} disabled />}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const qc = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const change = useMutation({
    mutationFn: () => api<{ otherSessionsRevoked: number }>("/account/password", { body: { currentPassword, newPassword } }),
    onSuccess: () => {
      setCurrent("");
      setNew("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["account", "sessions"] });
    },
  });
  const errors = change.error instanceof ApiError ? change.error.fieldErrors : {};
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  return (
    <Card>
      <CardHeader title="Password" description="Changing your password signs you out on all other devices." />
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) change.mutate();
        }}
      >
        {change.isSuccess && (
          <Alert tone="success">
            Password changed.
            {change.data.otherSessionsRevoked > 0 && ` Signed out ${change.data.otherSessionsRevoked} other session(s).`}
          </Alert>
        )}
        {change.error && !Object.keys(errors).length && <Alert>{(change.error as Error).message}</Alert>}
        <Field label="Current password" error={errors.currentPassword}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" error={errors.newPassword} hint="At least 10 characters, with a letter and a number">
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />}
          </Field>
          <Field label="Confirm new password" error={mismatch ? "Passwords don't match" : undefined}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={change.isPending} disabled={!currentPassword || !newPassword || mismatch}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["account", "sessions"], queryFn: () => api<Session[]>("/account/sessions") });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["account", "sessions"] });
  const revoke = useMutation({ mutationFn: (id: string) => api<void>(`/account/sessions/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>("/account/sessions/revoke-others", { method: "POST" }),
    onSuccess: invalidate,
  });
  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Signed-in devices"
        description='Devices signed in to this workspace. “Sign out all others” also ends your sessions in other workspaces.'
        action={
          others > 0 && (
            <Button variant="secondary" size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
              <LogOut className="size-3.5" aria-hidden /> Sign out all others
            </Button>
          )
        }
      />
      {sessions.isLoading && <LoadingBlock />}
      {sessions.error && <div className="p-5"><ErrorBlock error={sessions.error} /></div>}
      <ul className="divide-y divide-border">
        {sessions.data?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-5 py-3">
            <Monitor className="size-5 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {describeDevice(s.userAgent)}
                {s.current && <Badge tone="success">This device</Badge>}
              </div>
              <div className="text-xs text-muted">
                {s.ip ?? "Unknown IP"} · Signed in {formatDateTime(s.createdAt)} · Active {timeAgo(s.lastUsedAt).toLowerCase()}
              </div>
            </div>
            {!s.current && (
              <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
