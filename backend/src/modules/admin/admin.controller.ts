import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { auditLogs, FEATURES, isPlanCode, PLANS, users } from '@nextgen/database';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AllowWhenReadOnly } from '../billing/subscription.guard';
import { EntitlementsService } from '../billing/entitlements.service';

/** Only emails listed in PLATFORM_ADMIN_EMAILS may use the super-admin console. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly admins: string[];

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.admins = config.get('PLATFORM_ADMIN_EMAILS', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.auth || req.auth.sessionId.startsWith('apikey:')) throw new ForbiddenException();
    const [me] = await this.database.run({ userId: req.auth.userId }, (tx) => tx.select({ email: users.email }).from(users).where(eq(users.id, req.auth!.userId)));
    if (!me || !this.admins.includes(me.email.toLowerCase())) throw new ForbiddenException('Platform administrators only');
    return true;
  }
}

const updateTenantSchema = z.object({
  status: z.enum(['trial', 'active', 'suspended', 'archived']).optional(),
  planCode: z.string().refine(isPlanCode, 'Unknown plan').optional(),
  trialEndsAt: z.iso.datetime().optional(),
  featureOverrides: z.record(z.string().refine((f) => f in FEATURES, 'Unknown feature'), z.boolean()).optional(),
  reason: z.string().trim().min(3, 'Record why you are changing this workspace').max(500),
});

/**
 * Platform operator console (cross-tenant). Uses security-definer functions that
 * only run when app.platform_admin = 'true' is set in the same transaction.
 */
@ApiTags('Platform admin')
@ApiBearerAuth()
@AllowWhenReadOnly()
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly database: DatabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('tenants')
  async tenants(@Auth() auth: AuthContext) {
    const rows = await this.database.run({ userId: auth.userId }, async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      const res = await tx.execute(sql`select * from admin_tenants()`);
      return res.rows as Record<string, unknown>[];
    });
    const now = Date.now();
    return {
      tenants: rows,
      stats: {
        total: rows.length,
        trialing: rows.filter((r) => r.subscription_status === 'trialing' && (!r.trial_ends_at || new Date(String(r.trial_ends_at)).getTime() > now)).length,
        paying: rows.filter((r) => r.subscription_status === 'active').length,
        suspended: rows.filter((r) => r.status === 'suspended').length,
        mrr: rows
          .filter((r) => r.subscription_status === 'active')
          .reduce((sum, r) => sum + (isPlanCode(String(r.plan_code)) ? PLANS[String(r.plan_code) as keyof typeof PLANS].priceMonthly : 0), 0),
      },
      plans: Object.entries(PLANS).map(([code, p]) => ({ code, name: p.name })),
      features: Object.entries(FEATURES).map(([code, label]) => ({ code, label })),
    };
  }

  @Patch('tenants/:id')
  @ApiZodBody(updateTenantSchema)
  async updateTenant(
    @Auth() auth: AuthContext,
    @Param(new ZodValidationPipe(z.object({ id: z.uuid() }))) p: { id: string },
    @Body(new ZodValidationPipe(updateTenantSchema)) body: z.infer<typeof updateTenantSchema>,
    @Req() req: AppRequest,
  ) {
    await this.database.run({ userId: auth.userId }, async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await tx.execute(
        sql`select admin_update_tenant(${p.id}::uuid, ${body.status ?? null}::tenant_status, ${body.planCode ?? null}, ${body.trialEndsAt ?? null}::timestamptz, ${body.featureOverrides ? JSON.stringify(body.featureOverrides) : null}::jsonb)`,
      );
    });
    // Record the change in the affected workspace's own audit trail.
    await this.database.run({ tenantId: p.id, userId: auth.userId }, (tx) =>
      tx.insert(auditLogs).values({
        tenantId: p.id,
        actorUserId: auth.userId,
        action: 'platform_admin.tenant.updated',
        entityType: 'tenant',
        entityId: p.id,
        metadata: { ...body, by: 'platform-admin' },
        ...requestMeta(req),
      }),
    );
    this.entitlements.invalidate(p.id);
    return { ok: true };
  }
}
