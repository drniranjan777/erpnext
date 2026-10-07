import { Module } from '@nestjs/common';
import { BuilderController, SchedulesController } from './builder/builder.controller';
import { BuilderService } from './builder/builder.service';
import { SchedulesService } from './builder/schedules.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Standard reports, the report builder and scheduled delivery by email. */
@Module({
  controllers: [ReportsController, BuilderController, SchedulesController],
  providers: [ReportsService, BuilderService, SchedulesService],
  exports: [ReportsService, BuilderService],
})
export class ReportsModule {}
