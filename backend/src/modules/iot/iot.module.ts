import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { IotController, IotDeviceController } from './iot.controller';
import { IotService } from './iot.service';

/** IoT platform: edge gateways, signals, readings, live values and alarms. */
@Module({
  imports: [MaintenanceModule],
  controllers: [IotController, IotDeviceController],
  providers: [IotService],
  exports: [IotService],
})
export class IotModule {}
