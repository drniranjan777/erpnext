import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the root db or a transaction. */
export type DbExecutor = Database | Transaction;

export function createPool(connectionString: string, options: Omit<PoolConfig, 'connectionString'> = {}): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, ...options });
}

export function createDb(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}

/** Identity of the caller. Drives PostgreSQL row-level security. */
export interface DbContext {
  tenantId?: string | null;
  userId?: string | null;
}

/**
 * Runs `fn` in a transaction with `app.tenant_id` / `app.user_id` set
 * (transaction-local). Every tenant-scoped query MUST go through this so
 * RLS policies (sql/rls.sql) can isolate tenants.
 */
export async function withContext<T>(db: Database, ctx: DbContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
