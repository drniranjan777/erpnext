import { index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_columns';
import { tenantId } from './tenancy';

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * Append-only audit trail (Companies Act edit-log requirement).
 * The app role has INSERT/SELECT only - see sql/rls.sql.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: pk(),
    tenantId: tenantId(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    changes: jsonb('changes').$type<FieldChanges>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);
