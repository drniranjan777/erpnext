"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MailPlus, MoreHorizontal, RefreshCw, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { iamKeys, type Invitation, type InvitationLink, type Member, type Role } from "@/lib/iam";
import { askConfirm } from "@/components/ui/ask";

export default function UsersPage() {
  const { can, me } = useAuth();
  const canManage = can("iam.users.manage");
  const users = useQuery({ queryKey: iamKeys.users, queryFn: () => api<Member[]>("/iam/users") });
  const invitations = useQuery({ queryKey: iamKeys.invitations, queryFn: () => api<Invitation[]>("/iam/invitations") });
  const roles = useQuery({ queryKey: iamKeys.roles, queryFn: () => api<Role[]>("/iam/roles"), enabled: can("iam.roles.read") });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<InvitationLink | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Users & access"
        description="Invite your team and control what each person can see and do."
        actions={
          canManage && (
            <Button onClick={() => setInviteOpen(true)}>
              <MailPlus className="size-4" aria-hidden /> Invite user
            </Button>
          )
        }
      />

      <Card>
        <CardHeader title="Members" description={users.data ? `${users.data.length} ${users.data.length === 1 ? "person" : "people"} in this workspace` : undefined} />
        {users.isLoading && <LoadingBlock />}
        {users.error && <div className="p-5"><ErrorBlock error={users.error} /></div>}
        {users.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Roles</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Last sign-in</th>
                  {canManage && <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data.map((m) => {
                  const isMe = m.userId === me?.user.id;
                  return (
                    <tr key={m.membershipId}>
                      <td className="px-5 py-3">
                        <div className="font-medium">
                          {m.fullName} {isMe && <span className="text-xs font-normal text-muted">(you)</span>}
                        </div>
                        <div className="text-xs text-muted">{m.email}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {m.isOwner && <Badge tone="primary">Workspace owner</Badge>}
                          {m.roles.filter((r) => !(m.isOwner && r.name === "Owner")).map((r) => (
                            <Badge key={r.id}>{r.name}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={m.status === "active" ? "success" : "neutral"}>
                          {m.status === "active" ? "Active" : m.status === "disabled" ? "Disabled" : "Invited"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-muted" title={formatDateTime(m.lastLoginAt)}>
                        {timeAgo(m.lastLoginAt)}
                      </td>
                      {canManage && (
                        <td className="px-5 py-3 text-right">
                          {!isMe && !m.isOwner && (
                            <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label={`Manage ${m.fullName}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Pending invitations" description="Invitations expire after 7 days." />
        {invitations.isLoading && <LoadingBlock />}
        {invitations.error && <div className="p-5"><ErrorBlock error={invitations.error} /></div>}
        {invitations.data?.length === 0 && (
          <EmptyState title="No pending invitations" description="People you invite appear here until they accept." />
        )}
        {!!invitations.data?.length && (
          <ul className="divide-y divide-border">
            {invitations.data.map((inv) => (
              <PendingInvitation key={inv.id} invitation={inv} canManage={canManage} onLink={setLink} />
            ))}
          </ul>
        )}
      </Card>

      {inviteOpen && (
        <InviteDialog
          roles={roles.data ?? []}
          onClose={() => setInviteOpen(false)}
          onInvited={(l) => {
            setInviteOpen(false);
            setLink(l);
          }}
        />
      )}
      {link && <InviteLinkDialog link={link} onClose={() => setLink(null)} />}
      {editing && <EditMemberDialog member={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PendingInvitation({
  invitation: inv,
  canManage,
  onLink,
}: {
  invitation: Invitation;
  canManage: boolean;
  onLink: (l: InvitationLink) => void;
}) {
  const qc = useQueryClient();
  const resend = useMutation({
    mutationFn: () => api<InvitationLink>(`/iam/invitations/${inv.id}/resend`, { method: "POST" }),
    onSuccess: (l) => {
      qc.invalidateQueries({ queryKey: iamKeys.invitations });
      onLink(l);
    },
  });
  const revoke = useMutation({
    mutationFn: () => api<void>(`/iam/invitations/${inv.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: iamKeys.invitations }),
  });
  const error = resend.error ?? revoke.error;

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{inv.fullName ? `${inv.fullName} · ${inv.email}` : inv.email}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {inv.roles.map((r) => (
            <Badge key={r.id}>{r.name}</Badge>
          ))}
          <span>
            Invited by {inv.invitedBy ?? "—"} · {timeAgo(inv.createdAt)}
          </span>
          {inv.expired && <Badge tone="warning">Expired</Badge>}
        </div>
        {error && <p className="mt-1 text-xs text-danger">{(error as Error).message}</p>}
      </div>
      {canManage && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" loading={resend.isPending} onClick={() => resend.mutate()}>
            <RefreshCw className="size-3.5" aria-hidden /> New link
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={revoke.isPending}
            onClick={async () => {
              if (await askConfirm(`Withdraw the invitation for ${inv.email}?`)) revoke.mutate();
            }}
            aria-label={`Withdraw invitation for ${inv.email}`}
          >
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      )}
    </li>
  );
}

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="space-y-2.5">
      {roles.map((r) => (
        <Checkbox
          key={r.id}
          label={
            <>
              {r.name} {r.isSystem && <Badge className="ml-1">System</Badge>}
            </>
          }
          description={r.description ?? `${r.permissions.length} permissions`}
          checked={value.includes(r.id)}
          onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((id) => id !== r.id))}
        />
      ))}
    </div>
  );
}

function InviteDialog({ roles, onClose, onInvited }: { roles: Role[]; onClose: () => void; onInvited: (l: InvitationLink) => void }) {
  const qc = useQueryClient();
  const viewer = roles.find((r) => r.isSystem && r.name === "Viewer");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>(viewer ? [viewer.id] : []);
  const invite = useMutation({
    mutationFn: () => api<InvitationLink>("/iam/invitations", { body: { email, fullName, roleIds } }),
    onSuccess: (l) => {
      qc.invalidateQueries({ queryKey: iamKeys.invitations });
      onInvited(l);
    },
  });
  const fieldErrors = invite.error instanceof ApiError ? invite.error.fieldErrors : {};

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite a user"
      description="They'll get a link to set their password and join this workspace."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="invite-form" type="submit" loading={invite.isPending} disabled={!email || !roleIds.length}>
            Create invitation
          </Button>
        </>
      }
    >
      <form
        id="invite-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        {invite.error && !Object.keys(fieldErrors).length && <Alert>{(invite.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" required error={fieldErrors.email}>
            {(p) => <Input {...p} type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Name" error={fieldErrors.fullName}>
            {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            Roles <span className="text-danger">*</span>
          </legend>
          <RolePicker roles={roles} value={roleIds} onChange={setRoleIds} />
          {fieldErrors.roleIds && <p className="mt-1 text-xs text-danger">{fieldErrors.roleIds}</p>}
        </fieldset>
      </form>
    </Dialog>
  );
}

function InviteLinkDialog({ link, onClose }: { link: InvitationLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = `You've been invited to join our workspace on NextGen ERP. Accept here: ${link.inviteUrl}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Invitation ready"
      description={`Share this link with ${link.email}. It works once and expires on ${formatDateTime(link.expiresAt)}.`}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input readOnly value={link.inviteUrl} onFocus={(e) => e.target.select()} className="font-mono text-xs" aria-label="Invitation link" />
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(link.inviteUrl);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Share2 className="size-3.5" aria-hidden /> Share on WhatsApp
          </a>
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"
            href={`mailto:${link.email}?subject=${encodeURIComponent("Join our workspace on NextGen ERP")}&body=${encodeURIComponent(message)}`}
          >
            <MailPlus className="size-3.5" aria-hidden /> Send by email
          </a>
        </div>
        <p className="text-xs text-muted">We&apos;ve also emailed this invitation to {link.email}. Delivery status is in Settings → Message log.</p>
      </div>
    </Dialog>
  );
}

function EditMemberDialog({ member, roles, onClose }: { member: Member; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [roleIds, setRoleIds] = useState(member.roles.map((r) => r.id));
  const update = useMutation({
    mutationFn: (body: { roleIds?: string[]; status?: "active" | "disabled" }) =>
      api<Member>(`/iam/users/${member.membershipId}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: iamKeys.users });
      qc.invalidateQueries({ queryKey: iamKeys.roles });
      onClose();
    },
  });
  const disabled = member.status === "disabled";

  return (
    <Dialog
      open
      onClose={onClose}
      title={member.fullName}
      description={member.email}
      footer={
        <>
          <Button
            variant={disabled ? "secondary" : "danger"}
            className="mr-auto"
            loading={update.isPending && update.variables?.status !== undefined}
            onClick={async () => {
              if (disabled || await askConfirm(`Disable ${member.fullName}? They will be signed out immediately.`)) {
                update.mutate({ status: disabled ? "active" : "disabled" });
              }
            }}
          >
            {disabled ? "Re-enable user" : "Disable user"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={update.isPending && update.variables?.roleIds !== undefined}
            disabled={!roleIds.length}
            onClick={() => update.mutate({ roleIds })}
          >
            Save roles
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {update.error && <Alert>{(update.error as Error).message}</Alert>}
        <RolePicker roles={roles} value={roleIds} onChange={setRoleIds} />
      </div>
    </Dialog>
  );
}
