import { Module } from '@nestjs/common';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { FormulasService } from './formulas.service';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';

/** Process manufacturing: formulas and batches (work orders of kind "batch") with dispensing and yield. */
@Module({
  imports: [ManufacturingModule],
  controllers: [ProcessController],
  providers: [FormulasService, ProcessService],
})
export class ProcessModule {}
