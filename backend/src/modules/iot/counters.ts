import { mesCounters, type Transaction } from '@nextgen/database';
import { eq } from 'drizzle-orm';

/**
 * Increase of a counter signal since its last reading (0 for the first reading; a lower value
 * means the counter was reset and counts from zero). Null for a reading older than the last one,
 * which has already been counted.
 */
export async function counterStep(tx: Transaction, tenantId: string, signalId: string, value: number, ts: Date): Promise<number | null> {
  const [c] = await tx.select().from(mesCounters).where(eq(mesCounters.signalId, signalId));
  if (!c) {
    await tx.insert(mesCounters).values({ tenantId, signalId, lastValue: value, lastAt: ts });
    return 0;
  }
  if (ts <= c.lastAt) return null;
  await tx.update(mesCounters).set({ lastValue: value, lastAt: ts }).where(eq(mesCounters.id, c.id));
  return value >= c.lastValue ? value - c.lastValue : value;
}
