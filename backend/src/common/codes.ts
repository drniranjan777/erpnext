import { type Transaction } from '@nextgen/database';
import { sql } from 'drizzle-orm';

/**
 * Next auto code for a master (ITM00001, CUS00001…), from a per-tenant counter
 * row locked until the caller's transaction ends, so codes never collide.
 */
export async function nextCode(tx: Transaction, tenantId: string, key: string, prefix: string, pad = 5): Promise<string> {
  const res = await tx.execute<{ value: number }>(sql`
    insert into tenant_counters (tenant_id, key, value) values (${tenantId}, ${key}, 1)
    on conflict (tenant_id, key) do update set value = tenant_counters.value + 1, updated_at = now()
    returning value`);
  return `${prefix}${String(res.rows[0].value).padStart(pad, '0')}`;
}
