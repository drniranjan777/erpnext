# NextGen AI ERP

AI-first, multi-tenant SaaS ERP for Indian MSME manufacturers.

- Product & delivery plan: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)
- Phase-wise roadmap: [docs/PHASE_PLAN.md](docs/PHASE_PLAN.md)

## Repository layout

| Folder | What | Stack |
|---|---|---|
| [`frontend/`](frontend) | Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query |
| [`backend/`](backend) | API (modular monolith) | NestJS 12 on Fastify, Zod validation, JWT auth, Swagger |
| [`database/`](database) | Schema, migrations, RLS, seeds, local dev cluster | PostgreSQL 18, Drizzle ORM |
| [`docs/`](docs) | Plans, ADRs, module specs | Markdown |

npm workspaces tie the three packages together. `backend` imports the schema and DB helpers from `@nextgen/database`.

## Prerequisites

- Node.js 22+ (24 recommended)
- PostgreSQL **18** binaries installed locally. You don't need a running service: the project runs its own cluster. The default path is `C:/Program Files/PostgreSQL/18/bin`; override it with `PG_BIN` in `database/.env`.

## First-time setup

```bash
npm install
npm run db:init       # creates database/.dev-db cluster on port 5434, roles, DB, and .env files
npm run db:migrate    # applies migrations + RLS policies
npm run db:seed       # permission catalog + demo workspace
npm run build -w database
```

`db:init` generates random local-only passwords into `database/.env` and `backend/.env`. Both files are git-ignored. The demo login is `admin@demo.local`, with the password stored as `SEED_ADMIN_PASSWORD` in `database/.env`.

## Daily development

```bash
npm run db:start        # start the dev database (after a reboot)
npm run dev:backend     # API on http://localhost:4000/api/v1  (docs: /api/docs)
npm run dev:frontend    # web on http://localhost:3000
```

The frontend proxies `/api/v1/*` to the backend, so the browser sees a single origin and the refresh-token cookie stays first-party.

## Database workflow

1. Edit tables in `database/src/schema/*.ts`.
2. `npm run db:generate` creates a SQL migration in `database/migrations/`. Review it.
3. `npm run db:migrate` applies it and re-applies `database/sql/rls.sql`.
4. `npm run build -w database` lets the backend pick up the new types.

### Multi-tenancy rules (non-negotiable)

- Every business table has `tenant_id`. `sql/rls.sql` enables RLS on it automatically.
- The backend connects as `nextgen_app`, which is always subject to RLS. Migrations and seeds use `nextgen_owner`.
- All tenant data access goes through `DatabaseService.run(ctx, tx => ...)`. It sets `app.tenant_id` and `app.user_id` for the transaction.
- `npm run test -w database` runs the tenant-isolation suite. It must stay green.

## Billing, admin & integrations (dev defaults)

- **Billing** runs in test mode (`BILLING_PROVIDER=mock`): Settings → Billing & plan → choose a plan → *Simulate successful payment*. See [docs/modules/saas-platform.md](docs/modules/saas-platform.md) to switch on Razorpay.
- **Platform admin console** (`/admin`, shield icon in the header) is available to emails in `PLATFORM_ADMIN_EMAILS` (the demo admin in dev).
- **Emails** are written to `backend/.mail/*.eml` unless `SMTP_URL` is set.
- **API docs:** http://localhost:4000/api/docs. API keys and webhooks live under Settings → API & webhooks.

## Useful scripts

| Script | Purpose |
|---|---|
| `npm run db:status` / `db:stop` | Dev database control |
| `npm run db:studio` | Drizzle Studio (DB browser) |
| `npm run typecheck` | Type-check all workspaces |
| `npm test` | All tests |
| `npm run build` | Build database → backend → frontend |
