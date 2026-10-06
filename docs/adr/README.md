# Architecture Decision Records

Short records of significant decisions. Append new ones. Supersede rather than edit.

| # | Decision | Status | Date |
|---|---|---|---|
| 001 | Modular monolith (NestJS modules) instead of microservices | Accepted | 2026-10-05 |
| 002 | Shared DB/schema, `tenant_id` + PostgreSQL RLS; app runs as non-owner role `nextgen_app` | Accepted | 2026-10-05 |
| 003 | UUID v7 primary keys via PostgreSQL 18 native `uuidv7()` | Accepted | 2026-10-05 |
| 004 | Immutable stock & GL ledgers; corrections via reversal entries | Accepted | 2026-10-05 |
| 005 | Generic document framework (numbering, status, approvals, print) shared by all transactions | Accepted | 2026-10-05 |
| 006 | Contract-first APIs: Zod schemas drive validation + OpenAPI | Accepted | 2026-10-05 |
| 007 | Provider-agnostic AI gateway | Accepted | 2026-10-05 |
| 008 | AI proposes, user confirms: no direct AI writes | Accepted | 2026-10-05 |
| 009 | India data residency (AWS ap-south-1) | Accepted | 2026-10-05 |
| 010 | **Frontend on Next.js (App Router) + TypeScript** (supersedes the React + Vite choice in PROJECT_PLAN §5). Chosen by product owner. Next.js serves the UI and proxies `/api/v1` to the NestJS API. Business logic stays in the backend; Next server code is limited to rendering and the proxy | Accepted | 2026-10-05 |
| 011 | Drizzle ORM + SQL migrations; RLS policies in idempotent `database/sql/rls.sql`, re-applied on every migrate | Accepted | 2026-10-05 |
| 012 | Auth: 15-min access JWT (memory) + rotating refresh token (httpOnly cookie) bound to `auth_sessions`; refresh-token reuse revokes the session | Accepted | 2026-10-05 |
| 013 | **Background jobs on a PostgreSQL queue** (`jobs` table + `FOR UPDATE SKIP LOCKED`, security-definer claim/complete/fail functions) instead of Redis + BullMQ for V1. Jobs are enqueued in the same transaction as the business change (outbox), so a notification exists iff the approval commits. Worker runs in-process (`WORKER_ENABLED`) and can be split out later. Redis returns when we need shared caching / very high job throughput | Accepted | 2026-10-05 |
| 015 | **Plans as code + entitlements service.** Plan catalog lives in `database/src/plans.ts`; limits/features are enforced server-side (402 Payment Required) and an expired/suspended workspace becomes read-only via a global guard, never deleted. Platform admins can override features per tenant | Accepted | 2026-10-05 |
| 016 | **API keys act as their creator**, scoped to a subset of the creator's permissions, intersected at request time, and limited to permission-guarded business endpoints. Secrets (API keys, MFA seeds, webhook secrets) are hashed or AES-256-GCM encrypted at rest | Accepted | 2026-10-05 |
| 017 | **Platform super-admin by allow-list** (`PLATFORM_ADMIN_EMAILS`), with cross-tenant access only through security-definer functions that also require a per-transaction `app.platform_admin` flag; every change needs a reason and is written to the customer's audit trail | Accepted | 2026-10-05 |
| 014 | **Print formats are tenant-editable Handlebars HTML**, rendered server-side with an isolated helper set (prototype access disabled) and displayed in a script-less sandboxed iframe. Browser print/Save as PDF for now; server-side PDF (headless Chromium in the worker image) comes with deployment infrastructure | Accepted | 2026-10-05 |
