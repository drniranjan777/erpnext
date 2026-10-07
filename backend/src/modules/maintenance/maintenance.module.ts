import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { AssetsService } from './assets.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceOrdersService } from './orders.service';
import { PmService } from './pm.service';
import { ReliabilityService } from './reliability.service';
import { TpmService } from './tpm.service';

/** Plant maintenance: asset hierarchy, breakdown and preventive orders, PM schedules, spares, AMC, TPM, MTTR / MTBF and OEE. */
@Module({
  imports: [InventoryModule],
  controllers: [MaintenanceController],
  providers: [AssetsService, MaintenanceOrdersService, PmService, TpmService, ReliabilityService],
})
export class MaintenanceModule {}
