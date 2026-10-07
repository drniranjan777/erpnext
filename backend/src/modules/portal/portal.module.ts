import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CrmModule } from '../crm/crm.module';
import { DmsModule } from '../dms/dms.module';
import { SalesModule } from '../sales/sales.module';
import { ServiceModule } from '../service/service.module';
import { PortalAuthService } from './portal-auth.service';
import { PortalAdminController, PortalAuthController, PortalController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

/** Customer and dealer portals with their own logins. */
@Module({
  imports: [AccountingModule, CrmModule, DmsModule, SalesModule, ServiceModule],
  controllers: [PortalAuthController, PortalController, PortalAdminController],
  providers: [PortalAuthService, PortalService, PortalGuard],
})
export class PortalModule {}
