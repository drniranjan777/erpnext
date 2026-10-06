import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  auditLogs,
  authSessions,
  dataRequests,
  memberships,
  notificationPreferences,
  notifications,
  tenants,
  users,
} from '@nextgen/database';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AllowWhenReadOnly } from '../billing/subscription.guard';
import { NotificationsService } from '../notifications/notifications.service';

const requestSchema = z.object({
  type: z.enum(['correction', 'erasure', 'grievance']),
  details: z.string().trim().min(10, 'Describe your request').max(2000),
});
const resolveSchema = z.object({
  status: z.enum(['completed', 'rejected']),
  resolution: z.string().trim().min(5, 'Explain the outcome to the person').max(2000),
});

/**
 * DPDP Act 2023: data principals can obtain a copy of their personal data and
 * raise correction / erasure / grievance requests, which the workspace's data
 * protection contact tracks to closure.
 */
@ApiTags('Privacy (DPDP)')
@ApiBearerAuth()
@AllowWhenReadOnly()
@Controller()
export class PrivacyController {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Machine-readable copy of the caller's personal data. */
  @Get('account/data-export')
  async export(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return this.database.run(auth, async (tx) => {
      const [profile] = await tx
        .select({ id: users.id, email: users.email, fullName: users.fullName, mobile: users.mobile, locale: users.locale, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt, mfaEnabled: users.mfaEnabled })
        .from(users)
        .where(eq(users.id, auth.userId));
      const workspaces = await tx
        .select({ workspace: tenants.name, slug: tenants.slug, status: memberships.status, joinedAt: memberships.createdAt })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, auth.userId));
      const sessions = await tx
        .select({ createdAt: authSessions.createdAt, lastUsedAt: authSessions.lastUsedAt, ip: authSessions.ip, userAgent: authSessions.userAgent, revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(eq(authSessions.userId, auth.userId))
        .orderBy(desc(authSessions.createdAt))
        .limit(200);
      const preferences = await tx.select({ event: notificationPreferences.event, channel: notificationPreferences.channel, enabled: notificationPreferences.enabled }).from(notificationPreferences).where(eq(notificationPreferences.userId, auth.userId));
      const inbox = await tx
        .select({ title: notifications.title, body: notifications.body, createdAt: notifications.createdAt, readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.userId, auth.userId))
        .orderBy(desc(notifications.createdAt))
        .limit(500);
      const activity = await tx
        .select({ action: auditLogs.action, entityType: auditLogs.entityType, createdAt: auditLogs.createdAt, ip: auditLogs.ip })
        .from(auditLogs)
        .where(eq(auditLogs.actorUserId, auth.userId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1000);
      const requests = await tx.select().from(dataRequests).where(eq(dataRequests.userId, auth.userId));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'privacy.data_exported', entityType: 'user', entityId: auth.userId, ...requestMeta(req) });
      return {
        generatedAt: new Date().toISOString(),
        notice: 'Personal data held about you by NextGen ERP in this workspace. Business records you created (e.g. requisitions) belong to the workspace and are not included.',
        profile,
        workspaces,
        sessions,
        notificationPreferences: preferences,
        notifications: inbox,
        activity,
        dataRequests: requests.map(({ tenantId: _t, ...r }) => r),
      };
    });
  }

  @Get('account/data-requests')
  myRequests(@Auth() auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(dataRequests).where(eq(dataRequests.userId, auth.userId)).orderBy(desc(dataRequests.createdAt)));
  }

  @Post('account/data-requests')
  @ApiZodBody(requestSchema)
  raise(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(requestSchema)) body: z.infer<typeof requestSchema>, @Req() req: AppRequest) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx.insert(dataRequests).values({ tenantId: auth.tenantId, userId: auth.userId, ...body }).returning();
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'privacy.request.raised', entityType: 'data_request', entityId: row.id, metadata: { type: body.type }, ...requestMeta(req) });
      const owners = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.isOwner, true), eq(memberships.status, 'active')));
      if (owners.length) {
        await this.notifications.notify(tx, auth.tenantId, 'privacy.request_raised', owners, { type: body.type });
      }
      return row;
    });
  }

  // ---- Workspace side (data protection contact) ----

  @Get('platform/data-requests')
  @RequirePermissions('platform.privacy.manage')
  list(@Auth() auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ request: dataRequests, user: { name: users.fullName, email: users.email } })
        .from(dataRequests)
        .leftJoin(users, eq(users.id, dataRequests.userId))
        .orderBy(desc(dataRequests.createdAt)),
    );
  }

  @Patch('platform/data-requests/:id')
  @HttpCode(200)
  @RequirePermissions('platform.privacy.manage')
  @ApiZodBody(resolveSchema)
  resolve(
    @Auth() auth: AuthContext,
    @Param(new ZodValidationPipe(z.object({ id: z.uuid() }))) p: { id: string },
    @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>,
    @Req() req: AppRequest,
  ) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx
        .update(dataRequests)
        .set({ status: body.status, resolution: body.resolution, resolvedBy: auth.userId, resolvedAt: new Date() })
        .where(and(eq(dataRequests.id, p.id), eq(dataRequests.status, 'open')))
        .returning();
      if (!row) throw new NotFoundException('Request not found or already closed');
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'privacy.request.resolved', entityType: 'data_request', entityId: p.id, metadata: body, ...requestMeta(req) });
      await this.notifications.notify(tx, auth.tenantId, 'privacy.request_resolved', [{ userId: row.userId }], { type: row.type, status: body.status, resolution: body.resolution });
      return row;
    });
  }
}
