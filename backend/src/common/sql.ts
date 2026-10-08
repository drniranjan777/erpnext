import type { Transaction } from '@nextgen/database';
import type { SQL } from 'drizzle-orm';

/** Runs a raw query in the transaction and returns its rows. */
export const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
