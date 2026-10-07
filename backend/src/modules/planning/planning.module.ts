import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { ForecastingService } from './forecasting.service';
import { KanbanService } from './kanban.service';
import { MrpService } from './mrp.service';
import { PlanningController } from './planning.controller';
import { SchedulingService } from './scheduling.service';

/** Demand planning, MRP, capacity, finite scheduling and kanban. */
@Module({
  imports: [ManufacturingModule, PurchaseModule, InventoryModule],
  controllers: [PlanningController],
  providers: [ForecastingService, MrpService, SchedulingService, KanbanService],
})
export class PlanningModule {}
