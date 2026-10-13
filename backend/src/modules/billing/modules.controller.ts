import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { defaultModules, enabledModules, MODULE_KEYS, MODULES, tenants, type ModuleKey } from '@nextgen/database';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Auth, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AllowWhenReadOnly } from './subscription.guard';
import { EntitlementsService } from './entitlements.service';

const updateSchema = z.object({
  /** Changing the industry changes which modules are on by default. */
  industry: z.string().trim().min(1).max(50).optional(),
  /** The full on/off choice; only differences from the industry's defaults are stored. */
  modules: z.partialRecord(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]), z.boolean()),
});

/** Which optional modules a workspace uses: defaults from its industry, adjusted by its administrator. */
@ApiTags('Workspace')
@Controller('workspace/modules')
export class ModulesController {
  constructor(
    private readonly database: DatabaseService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query('industry') preview?: string) {
    // With ?industry=… : what that industry would start with (for the settings screen).
    if (preview) return this.describe(preview.slice(0, 50), undefined);
    const [t] = await this.database.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) => tx.select({ industry: tenants.industry, settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)));
    return this.describe(t?.industry ?? null, (t?.settings as { modules?: Record<string, boolean> } | undefined)?.modules);
  }

  @Put()
  @AllowWhenReadOnly()
  @RequirePermissions('platform.settings.manage')
  async update(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const result = await this.database.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const [t] = await tx.select({ industry: tenants.industry, settings: tenants.settings }).from(tenants).where(eq(tenants.id, auth.tenantId)).for('update');
      const industry = body.industry ?? t.industry;
      const defaults = new Set(defaultModules(industry));
      const overrides: Record<string, boolean> = {};
      for (const k of MODULE_KEYS) {
        const wanted = body.modules[k] ?? defaults.has(k);
        if (wanted !== defaults.has(k)) overrides[k] = wanted;
      }
      await tx.update(tenants).set({ industry, settings: { ...t.settings, modules: overrides } }).where(eq(tenants.id, auth.tenantId));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workspace.modules.update', entityType: 'tenant', entityId: auth.tenantId, metadata: { industry, modules: enabledModules(industry, overrides) } });
      return this.describe(industry, overrides);
    });
    this.entitlements.invalidate(auth.tenantId);
    return result;
  }

  private describe(industry: string | null, overrides: Record<string, boolean> | undefined) {
    const on = new Set(enabledModules(industry, overrides));
    const defaults = new Set(defaultModules(industry));
    return { industry, modules: MODULE_KEYS.map((key) => ({ key, label: MODULES[key].label, description: MODULES[key].description, enabled: on.has(key), byDefault: defaults.has(key) })) };
  }
}
