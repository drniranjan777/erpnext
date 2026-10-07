import { Module } from '@nestjs/common';
import { IotModule } from '../iot/iot.module';
import { MesModule } from '../mes/mes.module';
import { PlanningModule } from '../planning/planning.module';
import { TwinController, VisionController, VisionDeviceController } from './twin.controller';
import { TwinService } from './twin.service';
import { VisionService } from './vision.service';

/** Digital twin (live layouts, what-if scheduling) and edge AI vision inspection. */
@Module({
  imports: [IotModule, MesModule, PlanningModule],
  controllers: [TwinController, VisionController, VisionDeviceController],
  providers: [TwinService, VisionService],
})
export class TwinModule {}
