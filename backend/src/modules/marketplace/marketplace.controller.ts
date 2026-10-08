import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { automationSchema, AutomationService, testSchema } from './automation.service';
import { installSchema, MarketplaceService, runSchema } from './marketplace.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'apps.connectors.read';
const M = 'apps.connectors.manage';

@ApiTags('Marketplace')
@ApiBearerAuth()
@Controller()
export class MarketplaceController {
  constructor(
    private readonly market: MarketplaceService,
    private readonly automation: AutomationService,
  ) {}

  @Get('apps')
  @RequirePermissions(R)
  catalogue(@Auth() auth: AuthContext) {
    return this.market.catalogue(auth);
  }

  @Post('apps')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(installSchema)
  install(@Auth() auth: AuthContext, @Body(body(installSchema)) b: z.infer<typeof installSchema>) {
    return this.market.install(auth, b);
  }

  @Post('apps/:id/enabled')
  @HttpCode(200)
  @RequirePermissions(M)
  enabled(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ enabled: z.boolean() }))) b: { enabled: boolean }) {
    return this.market.setEnabled(auth, p.id, b.enabled);
  }

  @Post('apps/:id/actions/:action')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(runSchema)
  run(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ id: z.uuid(), action: z.string().regex(/^[a-z_]{2,40}$/) }))) p: { id: string; action: string }, @Body(body(runSchema)) b: z.infer<typeof runSchema>) {
    return this.market.run(auth, p.id, p.action, b);
  }

  @Get('apps/:id/runs')
  @RequirePermissions(R)
  runs(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.market.runs(auth, p.id);
  }

  @Get('apps/runs/:id/output')
  @RequirePermissions(R)
  @Header('content-type', 'application/xml; charset=utf-8')
  output(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.market.output(auth, p.id);
  }

  @Get('apps/records/:connector')
  @RequirePermissions(R)
  records(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ connector: z.string().regex(/^[a-z_0-9]{2,40}$/) }))) p: { connector: string }) {
    return this.market.records(auth, p.connector);
  }

  /** Inbound pushes from Shopify, IndiaMART and the like; verified by the installation's webhook secret. */
  @Public()
  @Post('public/connectors/:id/webhook')
  @HttpCode(200)
  webhook(@Param(idPipe) p: { id: string }, @Req() req: RawBodyRequest<FastifyRequest>) {
    if (!req.rawBody) throw new BadRequestException('Missing body');
    return this.market.webhook(p.id, req.rawBody, req.headers);
  }

  // ---- automations -------------------------------------------------------------------------------

  @Get('automations')
  @RequirePermissions('automation.rules.manage')
  automations(@Auth() auth: AuthContext) {
    return this.automation.list(auth);
  }

  @Post('automations')
  @RequirePermissions('automation.rules.manage')
  @ApiZodBody(automationSchema)
  create(@Auth() auth: AuthContext, @Body(body(automationSchema)) b: z.infer<typeof automationSchema>) {
    return this.automation.save(auth, null, b);
  }

  @Put('automations/:id')
  @RequirePermissions('automation.rules.manage')
  @ApiZodBody(automationSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(automationSchema)) b: z.infer<typeof automationSchema>) {
    return this.automation.save(auth, p.id, b);
  }

  @Delete('automations/:id')
  @RequirePermissions('automation.rules.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.automation.remove(auth, p.id);
  }

  @Get('automations/:id/runs')
  @RequirePermissions('automation.rules.manage')
  automationRuns(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.automation.runs(auth, p.id);
  }

  @Post('automations/:id/test')
  @HttpCode(200)
  @RequirePermissions('automation.rules.manage')
  @ApiZodBody(testSchema)
  test(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(testSchema)) b: z.infer<typeof testSchema>) {
    return this.automation.test(auth, p.id, b.payload);
  }
}
