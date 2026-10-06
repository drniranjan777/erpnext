import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { InspectionsService } from './inspections.service';
import { PlansService } from './plans.service';
import { QualityController } from './quality.controller';
import { TraceabilityService } from './traceability.service';

/** Quality: inspection plans with AQL sampling, incoming / in-process / final inspection, lot and serial traceability. */
@Module({
  imports: [InventoryModule, ManufacturingModule],
  controllers: [QualityController],
  providers: [PlansService, InspectionsService, TraceabilityService],
})
export class QualityModule {}
