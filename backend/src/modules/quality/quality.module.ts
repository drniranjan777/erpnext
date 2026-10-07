import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { CapasService } from './capas.service';
import { ComplaintsService } from './complaints.service';
import { ImprovementController } from './improvement.controller';
import { InspectionsService } from './inspections.service';
import { LotsService } from './lots.service';
import { NcrsService } from './ncrs.service';
import { PlansService } from './plans.service';
import { QmsController } from './qms.controller';
import { QualityController } from './quality.controller';
import { SupplierQualityService } from './supplier-quality.service';
import { TraceabilityService } from './traceability.service';

/** Quality: inspection plans with AQL and skip-lot sampling, inspections, lot status and QA release, retain samples, NCRs and cost of poor quality, traceability. */
@Module({
  imports: [InventoryModule, ManufacturingModule],
  controllers: [QualityController, QmsController, ImprovementController],
  providers: [PlansService, InspectionsService, TraceabilityService, LotsService, NcrsService, CapasService, ComplaintsService, SupplierQualityService],
  exports: [CapasService, TraceabilityService],
})
export class QualityModule {}
