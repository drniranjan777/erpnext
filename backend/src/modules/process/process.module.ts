import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { BlendsService } from './blends.service';
import { FormulasService } from './formulas.service';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';

/** Process manufacturing: formulas and batches (work orders of kind "batch") with dispensing and yield. */
@Module({
  imports: [ManufacturingModule, InventoryModule],
  controllers: [ProcessController],
  providers: [FormulasService, ProcessService, BlendsService],
})
export class ProcessModule {}
