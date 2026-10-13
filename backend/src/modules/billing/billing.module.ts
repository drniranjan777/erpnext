import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { ModulesController } from './modules.controller';
import { BillingProvider } from './providers';

@Global()
@Module({
  controllers: [BillingController, ModulesController],
  providers: [BillingService, EntitlementsService, BillingProvider],
  exports: [EntitlementsService],
})
export class BillingModule {}
