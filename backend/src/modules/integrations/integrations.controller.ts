import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiKeysService, createApiKeySchema, type CreateApiKeyInput } from './api-keys.service';
import { createWebhookSchema, updateWebhookSchema, WEBHOOK_EVENTS, WebhooksService } from './webhooks.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));

@ApiTags('Integrations')
@ApiBearerAuth()
@RequirePermissions('platform.integrations.manage')
@Controller('platform')
export class IntegrationsController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ---- API keys ----

  @Get('api-keys')
  listKeys(@Auth() auth: AuthContext) {
    return this.keys.list(auth);
  }

  @Post('api-keys')
  @ApiZodBody(createApiKeySchema)
  createKey(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKeyInput, @Req() req: AppRequest) {
    return this.keys.create(auth, body, requestMeta(req));
  }

  @Delete('api-keys/:id')
  @HttpCode(204)
  revokeKey(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.keys.revoke(auth, p.id, requestMeta(req));
  }

  // ---- Webhooks ----

  @Get('webhooks/events')
  events() {
    return Object.entries(WEBHOOK_EVENTS).map(([value, description]) => ({ value, description }));
  }

  @Get('webhooks')
  listWebhooks(@Auth() auth: AuthContext) {
    return this.webhooks.list(auth);
  }

  @Post('webhooks')
  @ApiZodBody(createWebhookSchema)
  createWebhook(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createWebhookSchema)) body: z.infer<typeof createWebhookSchema>, @Req() req: AppRequest) {
    return this.webhooks.create(auth, body, requestMeta(req));
  }

  @Patch('webhooks/:id')
  @ApiZodBody(updateWebhookSchema)
  updateWebhook(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: z.infer<typeof updateWebhookSchema>,
    @Req() req: AppRequest,
  ) {
    return this.webhooks.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  deleteWebhook(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.webhooks.remove(auth, p.id, requestMeta(req));
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  rotate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.webhooks.rotateSecret(auth, p.id, requestMeta(req));
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  test(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.webhooks.test(auth, p.id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.webhooks.deliveries(auth, p.id);
  }

  @Post('webhooks/deliveries/:id/redeliver')
  @HttpCode(200)
  redeliver(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.webhooks.redeliver(auth, p.id);
  }
}
