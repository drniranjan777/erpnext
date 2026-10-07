import { Module } from '@nestjs/common';
import { IotModule } from '../iot/iot.module';
import { MesController } from './mes.controller';
import { MesService } from './mes.service';

/** Real-time production: machine states, counts, downtime, OEE and Andon. */
@Module({
  imports: [IotModule],
  controllers: [MesController],
  providers: [MesService],
  exports: [MesService],
})
export class MesModule {}
