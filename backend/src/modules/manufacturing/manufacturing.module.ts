import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { BomsService } from './boms.service';
import { ManufacturingController } from './manufacturing.controller';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ResourcesService } from './resources.service';
import { WorkOrdersService } from './work-orders.service';

/** Discrete manufacturing: engineering data, work orders, the shop floor and production costing. */
@Module({
  imports: [InventoryModule],
  controllers: [ManufacturingController, ProductionController],
  providers: [ResourcesService, BomsService, WorkOrdersService, ProductionService],
  exports: [BomsService, WorkOrdersService, ProductionService],
})
export class ManufacturingModule {}
