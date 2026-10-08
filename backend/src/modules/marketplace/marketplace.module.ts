import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { IamModule } from '../iam/iam.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MastersModule } from '../masters/masters.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SalesModule } from '../sales/sales.module';
import { AutomationService } from './automation.service';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

/** App marketplace (connectors) and workflow automation. */
@Module({
  imports: [SalesModule, MastersModule, CrmModule, IamModule, IntegrationsModule, NotificationsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, AutomationService],
})
export class MarketplaceModule {}
