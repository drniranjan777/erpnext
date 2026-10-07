import { Module } from '@nestjs/common';
import { IotModule } from '../iot/iot.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { PlantController } from './plant.controller';
import { PlantService } from './plant.service';

/** Plant monitoring: energy and demand, condition monitoring, cold chain. */
@Module({
  imports: [IotModule, MaintenanceModule],
  controllers: [PlantController],
  providers: [PlantService],
})
export class PlantModule {}
