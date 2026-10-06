/**
 * Tenant-isolation tests: run against the real dev database using the
 * RLS-bound app role. These must stay green on every change.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool, withContext, type Database, type Transaction } from '../src/client';
import { provisionTenant, type ProvisionTenantResult } from '../src/provisioning';
import { purgeTenants } from '../src/testing';
import { auditLogs, companies, stockLedger, tenants, users } from '../src/schema';

const ownerPool = createPool(process.env.DATABASE_OWNER_URL!, { max: 2 });
const appPool = createPool(process.env.DATABASE_URL!, { max: 4 });
const owner: Database = createDb(ownerPool);
const app: Database = createDb(appPool);

const run = randomBytes(4).toString('hex');
let a: ProvisionTenantResult;
let b: ProvisionTenantResult;

function provision(label: string) {
  return owner.transaction((tx) =>
    provisionTenant(tx, {
      tenant: { slug: `rls-${label}-${run}`, name: `RLS ${label}` },
      company: { name: `Company ${label.toUpperCase()}` },
      owner: { email: `rls-${label}-${run}@test.local`, fullName: `User ${label}`, passwordHash: 'x' },
    }),
  );
}

beforeAll(async () => {
  a = await provision('a');
  b = await provision('b');
});

afterAll(async () => {
  await purgeTenants(ownerPool, [a?.tenantId, b?.tenantId].filter(Boolean) as string[], [`rls-a-${run}@test.local`, `rls-b-${run}@test.local`]);
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe('row-level security', () => {
  it('returns only the active tenant’s rows', async () => {
    const rows = await withContext(app, { tenantId: a.tenantId, userId: a.userId }, (tx) => tx.select().from(companies));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });

  it('returns nothing without a tenant context', async () => {
    const rows = await withContext(app, {}, (tx) => tx.select().from(companies));
    expect(rows).toHaveLength(0);
  });

  it('cannot read another tenant’s row even by id', async () => {
    const rows = await withContext(app, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
      tx.select().from(companies).where(eq(companies.id, b.companyId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects writes into another tenant', async () => {
    await expect(
      withContext(app, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
        tx.insert(companies).values({ tenantId: b.tenantId, name: 'Intruder Ltd' }),
      ),
    ).rejects.toThrow();
  });

  it('cannot update another tenant’s rows', async () => {
    const updated = await withContext(app, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
      tx.update(companies).set({ name: 'Hacked' }).where(eq(companies.id, b.companyId)).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it('only exposes users who are members of the active tenant', async () => {
    const rows = await withContext(app, { tenantId: a.tenantId, userId: a.userId }, (tx) => tx.select({ id: users.id }).from(users));
    expect(rows.map((r) => r.id)).toContain(a.userId);
    expect(rows.map((r) => r.id)).not.toContain(b.userId);
  });

  it('only lists tenants the user belongs to', async () => {
    const rows = await withContext(app, { userId: a.userId }, (tx) => tx.select({ id: tenants.id }).from(tenants));
    expect(rows.map((r) => r.id)).toEqual([a.tenantId]);
  });

  it('keeps the audit trail append-only', async () => {
    await expect(
      withContext(app, { tenantId: a.tenantId, userId: a.userId }, (tx) =>
        tx.update(auditLogs).set({ action: 'tampered' }).where(eq(auditLogs.tenantId, a.tenantId)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } }); // insufficient_privilege
  });
  it('keeps the stock ledger append-only', async () => {
    for (const stmt of [
      (tx: Transaction) => tx.update(stockLedger).set({ qty: '0' }).where(eq(stockLedger.tenantId, a.tenantId)),
      (tx: Transaction) => tx.delete(stockLedger).where(eq(stockLedger.tenantId, a.tenantId)),
    ]) {
      await expect(withContext(app, { tenantId: a.tenantId, userId: a.userId }, stmt)).rejects.toMatchObject({ cause: { code: '42501' } });
    }
  });
});
