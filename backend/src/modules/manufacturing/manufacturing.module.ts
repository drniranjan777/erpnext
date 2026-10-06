import { Module } from '@nestjs/common';
import { BomsService } from './boms.service';
import { ManufacturingController } from './manufacturing.controller';
import { ResourcesService } from './resources.service';

/** Discrete manufacturing: engineering data (work centres, machines, tools, BOMs and routings). */
@Module({
  controllers: [ManufacturingController],
  providers: [ResourcesService, BomsService],
  exports: [BomsService],
})
export class ManufacturingModule {}
