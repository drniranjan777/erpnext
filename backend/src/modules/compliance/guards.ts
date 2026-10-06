import { ConflictException } from '@nestjs/common';
import { ewayBills, type Transaction } from '@nextgen/database';
import { and, eq } from 'drizzle-orm';

/** A document with a live e-way bill cannot be cancelled: cancel the e-way bill first. */
export async function assertNoActiveEwb(tx: Transaction, documentId: string) {
  const [ewb] = await tx.select({ ewbNo: ewayBills.ewbNo }).from(ewayBills).where(and(eq(ewayBills.documentId, documentId), eq(ewayBills.status, 'active')));
  if (ewb) throw new ConflictException(`Cancel e-way bill ${ewb.ewbNo} first`);
}
