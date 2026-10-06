import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { BillingProvider } from './providers';

@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, EntitlementsService, BillingProvider],
  exports: [EntitlementsService],
})
export class BillingModule {}
