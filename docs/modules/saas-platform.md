# Module spec: SaaS & integration (Phase 1 · Sprint 1.4)

| | |
|---|---|
| **Status** | Done (5 Oct 2026). Built on default plans and test-mode billing, per product owner. |
| **Code** | `backend/src/modules/{billing,integrations,admin,privacy}`, `backend/src/modules/auth/mfa.service.ts`, `backend/src/common/{totp,crypto.service}.ts`, `database/src/{plans.ts,schema/saas.ts}` |

## 1. Plans (defaults, editable in `database/src/plans.ts`)

| | Trial | Starter | Growth | Enterprise |
|---|---|---|---|---|
| Price / month (ex-GST) | Free, 30 days | ₹1,999 | ₹4,999 | ₹14,999 |
| Price / year (ex-GST) | n/a | ₹19,990 | ₹49,990 | ₹1,49,990 |
| Users / companies | 10 / 2 | 5 / 1 | 25 / 3 | 200 / 20 |
| Storage | 2 GB | 5 GB | 25 GB | 200 GB |
| API keys / webhooks | 2 / 2 | not included | 5 / 5 | 50 / 50 |
| Multi-level approvals, custom fields, print designer, API, webhooks, WhatsApp | ✅ | ❌ | ✅ | ✅ (+ priority support) |

- **Enforcement** (`EntitlementsService`): limits are checked when inviting or re-enabling users, adding companies, uploading files, and creating API keys or webhooks. Feature checks return **402** with an upgrade message. Pending invitations count towards the user limit.
- **Read-only mode** (`SubscriptionGuard`): an expired trial, a lapsed cancelled subscription, or a suspended workspace means all writes return 402. Reads, billing, account, notifications and sign-out keep working.
- **Downgrades** are refused while current usage exceeds the target plan.

## 2. Billing
- `BILLING_PROVIDER=mock` (default): a built-in test checkout ("Simulate successful payment"). No money moves.
- `BILLING_PROVIDER=razorpay`: Razorpay Subscriptions. You need to set:
  1. `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
  2. `RAZORPAY_PLAN_IDS`, e.g. `{"growth:monthly":"plan_xxx",...}`. Create the plans in the Razorpay dashboard first.
  3. A Razorpay webhook pointing to `POST /api/v1/billing/webhooks/razorpay` for the events `subscription.charged`, `subscription.halted`, `subscription.cancelled` and `subscription.completed`.

  Signatures are verified on the raw body, and events are stored idempotently in `billing_events`. **This path is written against Razorpay's documented API but untested until keys are provided.**
- **Our GST invoices** (`saas_invoices`): number series `NGE/26-27/000001` (platform-wide, gapless, ≤16 chars), SAC 998314, CGST+SGST (9%+9%) when the buyer's state matches `SAAS_SELLER_STATE_CODE`, otherwise IGST 18%. Printable as A4. Seller details come from the `SAAS_SELLER_*` env vars.
- Owners get an in-app + email receipt.
- **Not yet built:** proration on mid-cycle plan changes (a change starts a new period), dunning emails, and Razorpay customer-portal links.

## 3. Two-step verification (TOTP)
- RFC 6238 (SHA-1, 6 digits, 30 s) with no third-party dependency. Verified against the RFC test vectors.
- The secret is encrypted at rest with AES-256-GCM (`DATA_ENCRYPTION_KEY`). There are 10 single-use recovery codes, stored hashed. Code replay is blocked (last accepted time-step is stored). Failed codes count towards the account lockout.
- **Sign-in:** password → `mfaRequired` + 5-minute `mfaToken` → `POST /auth/mfa/verify`. Accepting an invitation with an existing MFA account also requires the code.
- Turning MFA off or regenerating recovery codes requires the password and sends a security alert.
- **Future work:** a workspace policy "require MFA for admins".

## 4. API keys
- Format `ngk_<12-hex prefix>_<32 secret>`. The key is shown once; only a SHA-256 hash is stored. It's looked up by prefix through a security-definer function.
- A key acts as its creator, limited to the chosen scopes, and **never exceeds the creator's current permissions**. It stops working if the creator is disabled, the key is revoked or expired, or the plan loses API access.
- Keys can only call **permission-guarded business endpoints**. Account, MFA, session, `/auth/me` and admin routes return 403 for API keys.
- Send as `X-API-Key: …` or `Authorization: Bearer ngk_…`.

## 5. Webhooks
- Events: `document.submitted/approved/rejected/cancelled`, `member.joined` (or `*`). They are emitted inside the business transaction and delivered by the job queue: 8 attempts with exponential backoff, a 10 s timeout, and redirects not followed.
- **Signature:** `X-NextGen-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. Also sent: `X-NextGen-Event` and `X-NextGen-Delivery` (use the delivery header for idempotency).
- The secret is encrypted at rest, shown once, and can be rotated.
- **SSRF guard:** https only in production, and private / loopback / link-local / CGNAT targets are rejected. The check runs at creation and again at every send. `WEBHOOKS_ALLOW_PRIVATE=true` is for development only.
- Delivery log shows status, response code, latency and error, with manual retry and a test ping.

## 6. Platform super-admin
- Access is limited to the emails in `PLATFORM_ADMIN_EMAILS`. Cross-tenant reads and writes go through security-definer functions that also require `app.platform_admin='true'` in the same transaction.
- The console shows: workspaces, plan, trial and subscription state, users, documents, storage, last sign-in, and an MRR estimate.
- Admins can change status (suspend/restore), plan, trial end and per-feature overrides. **A reason is mandatory**, and the change is written to the customer's own audit trail.
- **Future work:** audited impersonation, and an MFA requirement for platform admins in production.

## 7. DPDP Act
- **My account → Download my data:** a JSON export of profile, workspaces, sessions, notification settings, notifications and own activity (the export itself is audited).
- **Requests:** correction, erasure or grievance. The workspace's data protection contact (`platform.privacy.manage`) responds, and the requester is notified.
- **Next steps:** an automated erasure/anonymisation workflow and statutory response timers.

## 8. Command palette
Ctrl/⌘ + K from anywhere. Jump to pages, run quick actions (e.g. new requisition), and search documents by number or title across every type you can read.

## 9. Tests
`backend/test/e2e/saas.e2e.test.ts` (23 tests) covers: GST pricing, test checkout and invoice, cancel/resume, downgrade guard, billing permission, admin console access/reason/audit, plan feature gates, read-only expiry and suspension, MFA enrol / login / replay / recovery / disable, API key scopes / endpoint restrictions / revocation, signed webhook delivery with signature verification, failure + retry, URL/event validation, data export, and a DPDP request round-trip. `backend/test/unit/totp.test.ts` checks the RFC 6238 vectors.
