# Deploying NextGen ERP

Two supported ways, both from the same images:

| | Docker Compose (`deploy/compose.yml`) | Kubernetes (`deploy/helm/nextgen-erp`) |
|---|---|---|
| For | one server, on-premise or a private cloud VM | EKS or any conformant cluster; dedicated or shared |
| Database | the bundled PostgreSQL 18 container | a managed PostgreSQL 18 (RDS / Aurora) with a streaming replica |
| Files | a Docker volume | a ReadWriteMany volume (EFS) |
| Migrations | the `migrate` service runs before the API starts | a Helm pre-install / pre-upgrade hook Job |

## Images

```bash
docker build -f deploy/docker/backend.Dockerfile -t nextgen/backend:1.0.0 .
docker build -f deploy/docker/frontend.Dockerfile --build-arg BACKEND_URL=http://<release>-backend:4000 -t nextgen/frontend:1.0.0 .
```

The backend image serves the API and runs the background job worker in the same process; scale it horizontally (jobs are claimed with `FOR UPDATE SKIP LOCKED`). It also runs migrations (`npx tsx src/migrate.ts` in `/app/database`), which re-apply `database/sql/rls.sql` every time.

## Configuration

Settings are environment variables (see `deploy/.env.example`). In Kubernetes they come from one Secret named by `existingSecret`; the chart never contains secrets. Two database URLs are needed: the owner role for migrations and the application role at runtime, which is always subject to row-level security. `DATABASE_REPLICA_URL` (optional) sends report queries to a replica. Create the two roles once before the first migration: `nextgen_owner` (owns the schema) and `nextgen_app` (login role for the API, no ownership, no BYPASSRLS); the migration grants the app role what it needs.

## Single-tenant (dedicated) deployments and data residency

A release is one installation. For a customer who needs a dedicated installation, deploy a separate release with its own database, storage and domain, in the region they require, and set `dataRegion` so their users see where data is kept. To move a workspace between installations or regions, export it (Settings → Data and sandbox) and import the file on the other installation; users are matched by email.

## Not covered here

- Certificates (SOC 2 Type II, ISO 27001) are organisational audits; this kit supports them with infrastructure as code, but the audits themselves are not code.
- The images and chart were written for this release and have not been built or installed in this development environment (it has no Docker or Kubernetes). Build and install them in a staging cluster first.
- Table partitioning: the highest-volume tables (`iot_readings`, `audit_logs`, `gl_entries`, `stock_ledger`) are indexed by tenant and date; partitioning them by month is planned for when a tenant's volume needs it.
