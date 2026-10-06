import { Global, Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { IntegrationsController } from './integrations.controller';
import { WebhooksService } from './webhooks.service';

@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [ApiKeysService, WebhooksService],
  exports: [ApiKeysService, WebhooksService],
})
export class IntegrationsModule {}
