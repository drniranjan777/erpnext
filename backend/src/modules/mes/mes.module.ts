import { Module } from '@nestjs/common';
import { IotModule } from '../iot/iot.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { MesExecutionController } from './execution.controller';
import { MesExecutionService } from './execution.service';
import { MesController } from './mes.controller';
import { MesService } from './mes.service';

/** Real-time production (states, counts, downtime, OEE, Andon) and MES execution at the machine. */
@Module({
  imports: [IotModule, ManufacturingModule],
  controllers: [MesController, MesExecutionController],
  providers: [MesService, MesExecutionService],
  exports: [MesService],
})
export class MesModule {}
