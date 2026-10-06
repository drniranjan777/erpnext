# Module spec: Platform & Identity (Phase 1)

| | |
|---|---|
| **Phase** | 1, SaaS Platform Core ([PHASE_PLAN.md](../PHASE_PLAN.md#phase-1--saas-platform-core-m1m3-10-weeks)) |
| **Status** | ✅ Phase 1 complete: sprints 1.1–1.4 done (5 Oct 2026) |
| **Owners** | Product: TBD · Tech lead: TBD |

## 1. Phase 1 sprint plan

| Sprint | Scope | Status |
|---|---|---|
| **1.1 Identity & Access** | Invitations (shareable link), user management (roles, enable/disable), custom roles + permission matrix, audit-trail viewer, my account (profile, password, devices) | ✅ Done |
| **1.2 Document framework** | Number series (company/branch/FY/doc type), status machine, multi-level approval matrix, amendments/revisions, linked documents, attachments, comments & activity timeline, approvals inbox, print view. First document: Purchase Requisition. See [document-framework.md](document-framework.md) | ✅ Done |
| **1.3 Engagement & customisation** | PostgreSQL job queue (ADR-013), notification engine (in-app bell, email, WhatsApp-ready) with per-user preferences and message log, invitation/approval/rejection/comment/security emails, instant session revocation + access cache, custom fields, print-format designer (server-rendered Handlebars), saved list views. See [platform-engagement.md](platform-engagement.md) | ✅ Done |
| **1.4 SaaS & integration** | Plans, limits and feature gates with read-only mode, billing (test checkout + Razorpay-ready) with our own GST invoices, TOTP two-step verification, scoped API keys, signed webhooks, platform super-admin console, DPDP data export and requests, Ctrl+K command palette. See [saas-platform.md](saas-platform.md) | ✅ Done |

## 2. Business objective
Let a workspace owner bring their team onto the system in minutes. Each person should see and do only what their job needs, and every change should be traceable for auditors (Companies Act edit-log rule).

## 3. Personas
- **Workspace owner** (MD / proprietor): created the workspace, has full control, and can't be locked out.
- **Administrator** (IT / office manager): manages users, roles and organisation setup.
- **Employee**: works with the permissions given by their roles.
- **Auditor / CA**: read-only, mainly the audit trail.

## 4. User stories (Sprint 1.1)

| # | Story | Acceptance criteria |
|---|---|---|
| IAM-1 | As an admin I invite a colleague with one or more roles | A link is generated (single use, 7-day expiry) and can be copied or shared via WhatsApp or email. Duplicate pending invites are rejected. |
| IAM-2 | As an invitee I join from the link | A new person sets their name and password (password policy enforced). An existing NextGen user confirms their password instead. They land signed in on the dashboard. A used, expired or withdrawn link shows a clear message. |
| IAM-3 | As an admin I change someone's roles or disable them | Changes take effect on their next request. Disabling signs them out everywhere in this workspace. Admins can't edit their own access or the owner's. Only the owner can grant the Owner role. |
| IAM-4 | As an admin I create custom roles | Roles use a permission matrix grouped by module. Names are unique (case-insensitive). System roles are read-only but can be duplicated. A role in use can't be deleted. |
| IAM-5 | As an auditor I review the audit trail | Entries are filterable by record type and date (IST), expandable to show field-level before/after values, IP and device, and append-only at the database level. |
| IAM-6 | As a user I manage my own account | I can update my name and mobile and change my password (wrong current password → field error). Changing the password signs out my other sessions in all workspaces. I can see my devices and sign them out individually or all at once. |

## 5. Permissions

| Code | Grants |
|---|---|
| `iam.users.read` | View members and pending invitations |
| `iam.users.manage` | Invite, re-issue or withdraw invitations, change roles, enable/disable |
| `iam.roles.read` | View roles and the permission catalog |
| `iam.roles.manage` | Create, edit and delete custom roles |
| `platform.audit.read` | View the audit trail |

The catalog lives in `database/src/permissions.ts`. `npm run db:seed` syncs it to the database and re-syncs system roles in every workspace.

## 6. Data model
`users` (global identity) · `memberships` (user ↔ tenant, `is_owner`, status) · `roles` · `role_permissions` · `membership_roles` · `invitations` (hashed token, role ids, expiry, accepted/revoked) · `auth_sessions` · `audit_logs` (append-only).

Security-definer functions handle the pre-authentication lookups. Each returns only what its flow needs: `auth_find_user_by_email`, `tenant_slug_exists`, `invitation_by_token_hash`, and `revoke_my_sessions` (acts only on `app.user_id`).

## 7. API (all under `/api/v1`)

| Method & path | Permission |
|---|---|
| `GET /iam/users` · `PATCH /iam/users/:membershipId` | users.read · users.manage |
| `GET/POST /iam/invitations` · `POST /iam/invitations/:id/resend` · `DELETE /iam/invitations/:id` | users.read / users.manage |
| `GET /iam/permissions` · `GET/POST /iam/roles` · `PATCH/DELETE /iam/roles/:id` | roles.read / roles.manage |
| `GET /platform/audit-logs` (keyset `cursor`) · `GET /platform/audit-logs/entity-types` | platform.audit.read |
| `GET /auth/invitations/:token` · `POST /auth/invitations/:token/accept` | public |
| `PATCH /account/profile` · `POST /account/password` · `GET /account/sessions` · `DELETE /account/sessions/:id` · `POST /account/sessions/revoke-others` | signed in |

## 8. Known limitations / follow-ups
- Invitation emails are not sent automatically yet; the admin shares the link. Automatic sending arrives in Sprint 1.3.
- ~~Disabled users keep access until token expiry~~: fixed in Sprint 1.3. AuthGuard now checks the session and membership, with a 15 s cache that is invalidated locally right away.
- ~~Permissions loaded from the DB on every request~~: fixed in Sprint 1.3 with a 30 s per-process cache, invalidated on role and membership changes.
- Two browser tabs refreshing at the exact same moment can trip refresh-token reuse detection. Mitigation: cross-tab refresh lock via BroadcastChannel.
