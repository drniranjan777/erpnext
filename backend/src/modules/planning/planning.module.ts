import { Module } from '@nestjs/common';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { ForecastingService } from './forecasting.service';
import { MrpService } from './mrp.service';
import { PlanningController } from './planning.controller';

/** Demand planning (statistical forecast) and MRP: planned orders, pegging, exception messages. */
@Module({
  imports: [ManufacturingModule, PurchaseModule],
  controllers: [PlanningController],
  providers: [ForecastingService, MrpService],
})
export class PlanningModule {}
