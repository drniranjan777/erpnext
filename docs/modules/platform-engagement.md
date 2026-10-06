# Module spec: Notifications, jobs & customisation (Phase 1 · Sprint 1.3)

| | |
|---|---|
| **Status** | Done (5 Oct 2026) |
| **Code** | `backend/src/modules/{jobs,notifications,customization}`, `backend/src/common/access-cache.service.ts`, `database/src/schema/platform.ts` |

## 1. Background jobs (ADR-013)
- `jobs` table, enqueued with `JobsService.enqueue(tx, tenantId, queue, payload)` **inside the business transaction** (outbox pattern).
- The worker claims batches via `jobs_claim()` (`FOR UPDATE SKIP LOCKED`, so many workers are safe). It recovers jobs stuck in `running` for over 10 minutes. Each job runs under its own tenant's RLS context.
- Retries use exponential backoff (30 s, 1 m, 2 m…) up to `max_attempts`, then the job is marked `dead`. Throw `PermanentJobError` to skip retries.
- Optional `dedupeKey` gives idempotent enqueue.
- Runs inside the API process (`WORKER_ENABLED=true`). Set it to `false` and run a dedicated worker when we scale.

## 2. Notification engine
| Event | Default channels | Recipients |
|---|---|---|
| `document.approval_requested` | in-app, email, WhatsApp | Everyone eligible for the current approval level (never the submitter) |
| `document.approved` / `document.rejected` | in-app, email (+ WhatsApp on rejection) | Submitter |
| `document.commented` | in-app | Creator / submitter (not the commenter) |
| `iam.invitation` | email (mandatory) | Invitee's email address |
| `account.password_changed` | in-app, email (mandatory) | The user |

- Catalog and templates live in `notifications/events.ts`. Users opt out per event and channel (**My account → Notifications**). Mandatory security events can't be turned off.
- **In-app:** written directly in the transaction (bell with unread count; polls every 30 s).
- **Email:** nodemailer over SMTP (`SMTP_URL`). In dev with no SMTP, emails are written as `.eml` files to `backend/.mail/` and open in any mail client. Uses a branded, table-based HTML layout plus a plain-text part.
- **WhatsApp:** provider interface with a `log` driver. Connecting Meta Cloud API or a BSP (Gupshup, Interakt…) needs approved message templates and a business account, so it's a Sprint 1.4 decision.
- **Message log** (Settings): every outbound message with status (queued / sent / failed), provider and error. Failed messages retry automatically.

## 3. Access checks (closes the Sprint 1.1 limitation)
- AuthGuard verifies the JWT, then checks that the session is not revoked or expired and the membership is active. The result is cached for 15 s per session.
- Permissions are cached for 30 s per membership.
- Any role, membership, session or password change invalidates the cache immediately on this instance (other instances within the TTL).
- Result: signing out a device or disabling a user takes effect on the **next request** (tested).

## 4. Custom fields
- Defined per entity (currently Purchase Requisition) with types text, long text, number, date, dropdown and yes/no, plus flags for required and show-on-print, and a display order.
- Values live in `documents.custom_fields` (jsonb) and are validated server-side against the active definitions. Unknown keys are dropped. Values of deactivated fields are preserved.
- A field's key and type are fixed after creation, so stored data stays valid.

## 5. Print formats (ADR-014)
- Handlebars HTML + CSS per document type. Built-in default per type, with optional tenant formats (one default).
- Rendered server-side with an isolated Handlebars instance and only these helpers: `money` (₹ en-IN), `qty`, `date`, `datetime`, `upper`, `eq`, `inc`. Output is escaped by default.
- The print page shows the result in a sandboxed iframe with **no scripts**. **Print / Save PDF** uses the browser. A format switcher appears when there are several.
- The designer previews live against sample data or any real document.
- Each module provides the template context through `PrintService.registerContext(docType, provider)`.

## 6. Saved views
Personal list filters, optionally shared with the workspace. Only the creator can delete a view. Currently on the Purchase Requisitions list.

## 7. Tests
`backend/test/e2e/notifications.e2e.test.ts` and `customization.e2e.test.ts` cover the worker, delivery, preferences, mandatory events, instant revocation, custom-field validation, print escaping and formats, and saved-view privacy.
