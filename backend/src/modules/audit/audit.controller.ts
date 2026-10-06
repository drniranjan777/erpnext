import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { auditLogs, users } from '@nextgen/database';
import { and, asc, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DatabaseService } from '../../database/database.service';

const listSchema = z.object({
  entityType: z.string().max(50).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});
type ListQuery = z.infer<typeof listSchema>;

/**
 * Keyset pagination on id: ids are UUID v7 (time-ordered), so "id < cursor"
 * walks backwards in time without timestamp-precision issues.
 */
@ApiTags('Audit trail')
@ApiBearerAuth()
@Controller('platform/audit-logs')
export class AuditController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @RequirePermissions('platform.audit.read')
  @ApiZodQuery(listSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listSchema)) q: ListQuery) {
    const filters: (SQL | undefined)[] = [
      q.entityType ? eq(auditLogs.entityType, q.entityType) : undefined,
      q.entityId ? eq(auditLogs.entityId, q.entityId) : undefined,
      q.actorUserId ? eq(auditLogs.actorUserId, q.actorUserId) : undefined,
      q.action ? sql`${auditLogs.action} like ${q.action.replace(/[%_]/g, '') + '%'}` : undefined,
      q.from ? gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00+05:30`)) : undefined,
      q.to ? lte(auditLogs.createdAt, new Date(`${q.to}T23:59:59.999+05:30`)) : undefined,
    ];
    if (q.cursor) filters.push(lt(auditLogs.id, q.cursor));

    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          changes: auditLogs.changes,
          metadata: auditLogs.metadata,
          ip: auditLogs.ip,
          userAgent: auditLogs.userAgent,
          requestId: auditLogs.requestId,
          createdAt: auditLogs.createdAt,
          actor: { id: auditLogs.actorUserId, fullName: users.fullName, email: users.email },
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(and(...filters))
        .orderBy(desc(auditLogs.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      const last = items[items.length - 1];
      return { items, nextCursor: hasMore && last ? last.id : null };
    });
  }

  /** Distinct entity types, for the filter dropdown. */
  @Get('entity-types')
  @RequirePermissions('platform.audit.read')
  entityTypes(@Auth() auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .selectDistinct({ entityType: auditLogs.entityType })
        .from(auditLogs)
        .orderBy(asc(auditLogs.entityType));
      return rows.map((r) => r.entityType);
    });
  }
}
