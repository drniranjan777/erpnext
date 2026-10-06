import { Injectable } from '@nestjs/common';
import { auditLogs, type FieldChanges, type Transaction } from '@nextgen/database';

export interface AuditEntry {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: FieldChanges;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuditService {
  /** Writes inside the caller's transaction so the audit row commits atomically with the change. */
  async log(tx: Transaction, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values(entry);
  }

  /** Field-level diff of two flat records (only keys present in `after`). */
  diff(before: Record<string, unknown>, after: Record<string, unknown>): FieldChanges {
    const changes: FieldChanges = {};
    for (const key of Object.keys(after)) {
      const from = before[key];
      const to = after[key];
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    return changes;
  }
}
